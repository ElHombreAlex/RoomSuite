import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import T from '../cliproom/public/timeline.js';
import { inputPath, outputPath, saveDownload, saveResponse } from './files.mjs';

const configuredUrl = process.env.ROOMSUITE_MCP_URL || 'http://127.0.0.1:8090';
const requestedTimeout = Number(process.env.ROOMSUITE_MCP_TIMEOUT_MS || 600000);
const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 600000;
const mimeByExt = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.vectorroom':'application/json', '.wav':'audio/wav', '.mp4':'video/mp4', '.webm':'video/webm' };

export function serverUrl() {
  const url = new URL(configuredUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('ROOMSUITE_MCP_URL must be the HTTP(S) origin of the RoomSuite server.');
  return url.origin;
}
function outputWithExtension(requested, ext) {
  const existing = path.extname(requested).toLowerCase();
  if (!existing) return requested + ext;
  if (existing !== ext) throw new Error('This browser will export ' + ext + '. Use that extension or omit the extension from output.');
  return requested;
}
export async function withRoom(room, expectedTitle, signal, callback) {
  let browser;
  let abort;
  try {
    if (signal?.aborted) throw new Error('The request was cancelled.');
    const options = { headless:true };
    if (process.env.ROOMSUITE_BROWSER_PATH) options.executablePath = process.env.ROOMSUITE_BROWSER_PATH;
    browser = await chromium.launch(options);
    if (signal?.aborted) throw new Error('The request was cancelled.');
    abort = () => { void browser.close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once:true });
    const context = await browser.newContext({ acceptDownloads:true, viewport:{ width:1440, height:1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(Math.min(timeoutMs, 60000));
    const origin = serverUrl();
    // Editors are local-first. Do not let an imported file cause an unrelated
    // external request from the automation browser.
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || url.startsWith('data:') || url.startsWith('blob:')) await route.continue();
      else await route.abort();
    });
    let response;
    try { response = await page.goto(origin + room, { waitUntil:'load', timeout:30000 }); }
    catch { throw new Error('Cannot open RoomSuite at ' + origin + '. Start the suite server with node server.js.'); }
    if (!response?.ok() || !(await page.title()).includes(expectedTitle)) throw new Error('The configured server did not serve ' + expectedTitle + '. Start the RoomSuite server and check ROOMSUITE_MCP_URL.');
    return await callback(page);
  } catch (error) {
    if (signal?.aborted) throw new Error('The request was cancelled.');
    if (!browser && /executable|browser.*install/i.test(error.message)) throw new Error('Chromium is unavailable. Run npx playwright install chromium in the mcp directory, or set ROOMSUITE_BROWSER_PATH.');
    throw error;
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
    if (browser) await browser.close().catch(() => {});
  }
}
async function setField(page, selector, value) {
  await page.locator(selector).evaluate((element, next) => {
    element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles:true }));
    element.dispatchEvent(new Event('change', { bubbles:true }));
  }, value);
}
async function waitForToast(page, text, milliseconds = 30000) {
  try { await page.waitForFunction(expected => document.querySelector('#toast')?.textContent.includes(expected), text, { timeout:milliseconds }); }
  catch { const message = await page.locator('#toast').textContent().catch(() => ''); throw new Error(message || 'The editor did not finish the operation.'); }
}

export async function inspectMedia(args, signal) {
  const file = await inputPath(args.input);
  return withRoom('/cliproom/', 'Cliproom', signal, async page => {
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'roomsuiteProbe'; document.body.append(input); });
    await page.locator('#roomsuiteProbe').setInputFiles(file);
    return page.evaluate(async () => {
      const file = document.querySelector('#roomsuiteProbe').files[0], type = file.type;
      const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : null;
      if (!kind) throw new Error('The browser cannot identify this as an image, video, or audio file.');
      const url = URL.createObjectURL(file);
      try {
        const media = kind === 'image' ? new Image() : document.createElement(kind);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Timed out reading media metadata.')), 20000);
          media.onerror = () => { clearTimeout(timer); reject(new Error('The browser could not read this media.')); };
          const loaded = () => { clearTimeout(timer); resolve(); };
          if (kind === 'image') media.onload = loaded; else { media.preload = 'metadata'; media.onloadedmetadata = loaded; }
          media.src = url;
        });
        return { name:file.name, bytes:file.size, mime_type:type, kind,
          width:kind === 'image' ? media.naturalWidth : kind === 'video' ? media.videoWidth : null,
          height:kind === 'image' ? media.naturalHeight : kind === 'video' ? media.videoHeight : null,
          duration_seconds:kind !== 'image' && Number.isFinite(media.duration) ? media.duration : null };
      } finally { URL.revokeObjectURL(url); }
    });
  });
}

export async function importCliproomMedia(args, signal) {
  const file = await inputPath(args.input);
  return withRoom('/cliproom/', 'Cliproom', signal, async page => {
    const asset = await uploadCliproomMedia(page, file);
    return { asset, note:'The media is stored in the Cliproom server library. No project was saved.' };
  });
}
async function uploadCliproomMedia(page, file) {
  const handle = await page.evaluateHandle(() => { const input = document.createElement('input'); input.type = 'file'; document.body.append(input); return input; });
  try {
    await handle.asElement().setInputFiles(file);
    return await handle.evaluate(async input => {
      const file = input.files[0], extensions = { mp4:'video/mp4',m4v:'video/x-m4v',mov:'video/quicktime',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif' };
      const type = (file.type || extensions[file.name.split('.').pop().toLowerCase()] || '').toLowerCase().split(';')[0];
      const kind = type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : type.startsWith('video/') ? 'video' : null;
      if (!kind || type === 'image/svg+xml') throw new Error('Choose a supported video, audio file, or photo.');
      if (!file.size || file.size > 2 * 1024 * 1024 * 1024) throw new Error('Media must be nonempty and at most 2 GB.');
      const url = URL.createObjectURL(file); let info;
      try {
        const media = kind === 'image' ? new Image() : document.createElement(kind);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Reading media metadata timed out.')), 20000);
          const loaded = () => { clearTimeout(timer); resolve(); }, failed = () => { clearTimeout(timer); reject(new Error('The browser cannot decode this media.')); };
          if (kind === 'image') media.onload = loaded; else { media.preload = 'metadata'; media.onloadedmetadata = loaded; }
          media.onerror = failed; media.src = url;
        });
        if (kind !== 'image' && (!Number.isFinite(media.duration) || media.duration <= 0)) throw new Error('The file has no readable duration.');
        info = { duration:kind === 'image' ? 5 : media.duration, width:kind === 'image' ? media.naturalWidth : media.videoWidth || 0, height:kind === 'image' ? media.naturalHeight : media.videoHeight || 0 };
      } finally { URL.revokeObjectURL(url); }
      const response = await fetch('/api/assets', { method:'POST', headers:{ 'Content-Type':'application/octet-stream', 'X-Cliproom-Request':'1', 'X-File-Type':type, 'X-File-Name':encodeURIComponent(file.name) }, body:file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not upload media (' + response.status + ').');
      return { ...data, ...info, kind };
    });
  } finally { await handle.evaluate(input => input.remove()).catch(() => {}); await handle.dispose(); }
}
async function preflightVideoOutput(requested, mode) {
  const extension = path.extname(requested).toLowerCase();
  if (mode === 'offline') {
    if (extension && extension !== '.webm') throw new Error('Offline rendering outputs WebM. Use a .webm filename or omit the extension.');
    await outputPath(outputWithExtension(requested, '.webm'), ['.webm']);
  } else if (extension) {
    await outputPath(requested, ['.mp4', '.webm']);
  }
}
async function downloadTo(page, button, output, mime) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout:timeoutMs }), page.locator(button).click()]);
  return saveDownload(download, output, mime);
}

export async function editImage(args, signal) {
  const input = await inputPath(args.input), ext = path.extname(args.output).toLowerCase();
  const out = await outputPath(args.output, ['.png','.jpg','.jpeg','.webp']);
  return withRoom('/pixelroom/', 'Pixelroom', signal, async page => {
    await page.waitForSelector('#layersList [data-layer]');
    await page.locator('#imageInput').setInputFiles(input);
    await waitForToast(page, 'Photo opened.');
    for (const key of ['brightness','contrast','saturation']) if (args[key] !== undefined) await setField(page, '#' + key, args[key]);
    if (args.remove_background) {
      await page.locator('[data-tab="isolate"]').click(); await page.locator('#removeBgBtn').click();
      await page.waitForFunction(() => !document.querySelector('#subjectThreshold').disabled || document.querySelector('#maskHint').textContent.includes('unavailable'), null, { timeout:timeoutMs });
      if (await page.locator('#subjectThreshold').isDisabled()) throw new Error('PixelRoom could not run its local subject model.');
      await page.locator('#applyMaskBtn').click(); await waitForToast(page, 'Background cutout applied.');
    }
    if (args.crop) {
      const dimensions = await page.locator('#editorCanvas').evaluate(canvas => ({ width:canvas.width, height:canvas.height }));
      const c = args.crop;
      if (c.x + c.width > dimensions.width || c.y + c.height > dimensions.height) throw new Error('Crop must fit inside the input image.');
      await page.locator('[data-tab="crop"]').click(); await page.locator('#startCropBtn').click();
      const box = await page.locator('#editorCanvas').boundingBox();
      const x = value => box.x + value / dimensions.width * box.width, y = value => box.y + value / dimensions.height * box.height;
      await page.mouse.move(x(c.x), y(c.y)); await page.mouse.down(); await page.mouse.move(x(c.x + c.width), y(c.y + c.height), { steps:8 }); await page.mouse.up();
      await page.locator('#applyCropBtn').click();
    }
    await page.locator('#exportBtn').click(); await page.locator('#exportFormat').selectOption(mimeByExt[ext]);
    const result = await downloadTo(page, '#downloadBtn', out, mimeByExt[ext]);
    return { ...result, room:'PixelRoom', operation:'edit_image' };
  });
}

export async function editAudio(args, signal) {
  const input = await inputPath(args.input), out = await outputPath(args.output, ['.wav']);
  return withRoom('/soundroom/', 'SoundRoom', signal, async page => {
    await page.locator('#audioFile').setInputFiles(input);
    await page.waitForFunction(() => !document.querySelector('#export').disabled || document.querySelector('#status').classList.contains('error'), null, { timeout:timeoutMs });
    if (await page.locator('#export').isDisabled()) throw new Error(await page.locator('#status').textContent() || 'Could not decode the audio.');
    const duration = await page.locator('#playhead').evaluate(element => Number(element.max));
    if (args.trim) {
      if (args.trim.end > duration || args.trim.start >= args.trim.end) throw new Error('Trim range must fit inside the audio and end after its start.');
      // SoundRoom commits each selection field on change.
      await setField(page, '#selectionEnd', args.trim.end); await setField(page, '#selectionStart', args.trim.start);
      if (await page.locator('#trim').isDisabled()) throw new Error('The trim range is too short.');
      await page.locator('#trim').click();
    }
    if (args.normalize) {
      await page.locator('#normalize').click();
      if (await page.locator('#status').evaluate(el => el.classList.contains('error'))) throw new Error(await page.locator('#status').textContent());
    }
    if (args.gain_percent !== undefined) await setField(page, '#gain', args.gain_percent);
    if (args.fade_in !== undefined) await setField(page, '#fadeIn', args.fade_in);
    if (args.fade_out !== undefined) await setField(page, '#fadeOut', args.fade_out);
    const result = await downloadTo(page, '#export', out, 'audio/wav');
    const outputDuration = await page.locator('#playhead').evaluate(element => Number(element.max));
    return { ...result, room:'SoundRoom', operation:'edit_audio', duration_seconds:outputDuration };
  });
}

function vectorObject(element) {
  const item = { type:element.type, fillMode:element.fill_mode || (element.type === 'line' || element.type === 'path' ? 'none' : 'solid'), fill:element.fill || '#a895e9', fill2:element.fill2 || '#f7bcb5', stroke:element.stroke || '#302a3e', strokeWidth:element.stroke_width ?? (element.type === 'text' ? 0 : 2) };
  if (element.type === 'path') {
    item.points = element.points.map(p => ({ x:p.x, y:p.y, inX:p.in_x ?? p.x, inY:p.in_y ?? p.y, outX:p.out_x ?? p.x, outY:p.out_y ?? p.y })); item.closed = !!element.closed;
  } else {
    item.x = element.x; item.y = element.y;
    if (element.type === 'rect' || element.type === 'ellipse') { item.width = element.width; item.height = element.height; }
    if (element.type === 'line') { item.x2 = element.x2; item.y2 = element.y2; }
    if (element.type === 'text') { item.text = element.text; item.fontSize = element.font_size || 56; item.font = element.font || 'sans-serif'; }
  }
  return item;
}
export async function createVector(args, signal) {
  const ext = path.extname(args.output).toLowerCase(), out = await outputPath(args.output, ['.svg','.png','.vectorroom']);
  return withRoom('/vectorroom/', 'VectorRoom', signal, async page => {
    const project = { format:'vectorroom', version:1, objects:args.elements.map(vectorObject) };
    await page.locator('#openProject').setInputFiles({ name:'agent.vectorroom', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(() => document.querySelector('#status').textContent.length > 0, null, { timeout:30000 });
    if (await page.locator('#status').evaluate(el => el.classList.contains('error'))) throw new Error(await page.locator('#status').textContent());
    const button = ext === '.svg' ? '#exportSvg' : ext === '.png' ? '#exportPng' : '#save';
    const result = await downloadTo(page, button, out, mimeByExt[ext]);
    return { ...result, room:'VectorRoom', operation:'create_vector', width:1000, height:700 };
  });
}

export async function recordScene(args, signal, progress) {
  if (!args.image && !args.text) throw new Error('Provide an image or text for the scene.');
  const image = args.image ? await inputPath(args.image) : null;
  return withRoom('/captureroom/', 'CaptureRoom', signal, async page => {
    if (image) {
      await page.locator('#imageFile').setInputFiles(image);
      await page.waitForFunction(() => [...document.querySelectorAll('#sources .item-main')].some(item => item.textContent), null, { timeout:30000 });
    }
    if (args.text) {
      await page.locator('#addText').click(); await setField(page, '#text', args.text);
      if (args.font_size !== undefined) await setField(page, '#fontSize', args.font_size);
      if (args.color) await setField(page, '#color', args.color);
    }
    const ext = await page.evaluate(() => {
      const choices = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
      const mime = choices.find(type => MediaRecorder.isTypeSupported(type));
      return mime?.startsWith('video/mp4') ? '.mp4' : '.webm';
    });
    const out = await outputPath(outputWithExtension(args.output, ext), [ext]);
    await page.locator('#record').click();
    await page.waitForFunction(() => document.querySelector('#recordState').textContent === 'RECORDING' || document.querySelector('#status').classList.contains('error'));
    if (await page.locator('#status').evaluate(el => el.classList.contains('error'))) throw new Error(await page.locator('#status').textContent());
    const started = Date.now();
    while (true) {
      const elapsed = (Date.now() - started) / 1000, remaining = args.duration - elapsed;
      if (remaining <= 0) break;
      await delay(Math.min(remaining, 5) * 1000, undefined, { signal });
      const percentage = Math.min(90, 5 + Math.floor((Date.now() - started) / 1000 / args.duration * 85));
      await progress?.(percentage, 100, 'Recording the prepared scene…');
    }
    await page.locator('#record').click();
    await page.waitForFunction(() => !document.querySelector('#result').classList.contains('hidden') || document.querySelector('#status').classList.contains('error'), null, { timeout:30000 });
    if (await page.locator('#status').evaluate(el => el.classList.contains('error'))) throw new Error(await page.locator('#status').textContent());
    const result = await downloadTo(page, '#download', out, mimeByExt[ext]);
    return { ...result, room:'CaptureRoom', operation:'record_scene', requested_duration_seconds:args.duration };
  });
}

export async function renderVideo(args, signal, progress) {
  await preflightVideoOutput(args.output, args.render_mode);
  for (const entry of args.media) for (const frame of entry.keyframes || []) {
    if (['time','source_time','timeline_time'].filter(key => frame[key] !== undefined).length !== 1) throw new Error('Each keyframe must specify exactly one of timeline_time, source_time, or time.');
    if (!Object.keys(frame).some(key => !['time','source_time','timeline_time'].includes(key))) throw new Error('A keyframe must set at least one property.');
  }
  const files = await Promise.all(args.media.map(entry => inputPath(entry.input)));
  const imported = await withRoom('/cliproom/', 'Cliproom', signal, async page => {
    const imported = [];
    for (let i = 0; i < files.length; i++) {
      try { imported.push(await uploadCliproomMedia(page, files[i])); }
      catch (error) { throw new Error('Could not import ' + args.media[i].input + ': ' + error.message); }
    }
    return imported;
  });
  const uid = () => crypto.randomUUID(), state = T.empty(uid), cursors = new Map();
  state.assets = imported;
  state.name = args.name || 'RoomSuite agent video'; state.aspect = args.aspect || '16:9'; state.quality = args.quality || '720p';
  args.media.forEach((entry, i) => {
    const asset = state.assets[i], isAudio = asset.kind === 'audio';
    const clips = isAudio ? state.audioClips : state.clips;
    const item = isAudio ? { id:uid(), assetId:asset.id, rate:1, volume:.7, fadeIn:0, fadeOut:0 } :
      { id:uid(), assetId:asset.id, rate:1, volume:1, fit:'contain', opacity:1, scale:1, x:50, y:50, brightness:100, contrast:100, saturation:100, rotation:0, flipX:false, fadeIn:0, fadeOut:0 };
    clips.push(item);
    const tracks = isAudio ? state.audioTracks : state.videoTracks, index = (entry.track || 1) - 1;
    while (tracks.length <= index) tracks.push(isAudio ? { id:uid(), name:'Audio ' + (tracks.length + 1), muted:false } : { id:uid(), name:'Video ' + (tracks.length + 1), muted:false, hidden:false });
    item.trackId = tracks[index].id;
    item.in = entry.source_in ?? 0;
    item.out = asset.kind === 'image' ? (entry.duration ?? 5) : (entry.source_out ?? asset.duration);
    item.rate = entry.speed ?? 1;
    if (item.in < 0 || item.out <= item.in || (asset.kind !== 'image' && item.out > asset.duration + .001)) throw new Error('Invalid source range for ' + asset.name + '.');
    const key = (isAudio ? 'audio' : 'video') + index;
    item.start = entry.start ?? (cursors.get(key) || 0);
    cursors.set(key, Math.max(cursors.get(key) || 0, item.start + (item.out - item.in) / item.rate));
    if (entry.volume !== undefined) item.volume = entry.volume;
    if (!isAudio && entry.fit) item.fit = entry.fit;
    if (!isAudio) for (const key of ['scale','x','y','opacity','rotation','brightness','contrast','saturation']) if (entry[key] !== undefined) item[key] = entry[key];
    if (entry.keyframes) {
      const times = new Set();
      item.keyframes = entry.keyframes.map(frame => {
        const { timeline_time, source_time, time:legacyTime, ...values } = frame;
        if (timeline_time !== undefined && (timeline_time < item.start - 1e-9 || timeline_time > T.end(item) + 1e-9)) throw new Error('Keyframe timeline_time must fall within the clip for ' + asset.name + '.');
        const time = timeline_time === undefined ? (source_time ?? legacyTime) : Math.max(item.in, Math.min(item.out, item.in + (timeline_time - item.start) * T.rate(item)));
        const timeKey = Math.round(time * 1e9);
        if (times.has(timeKey)) throw new Error('Keyframe times must be unique for ' + asset.name + '.');
        times.add(timeKey);
        return { id:uid(), time, ...values };
      }).sort((a,b) => a.time - b.time);
    }
    item.fadeIn = entry.fade_in || 0; item.fadeOut = entry.fade_out || 0;
  });
  for (const title of args.titles || []) {
    if (title.end <= title.start || title.end > T.duration(state) + .001) throw new Error('Title timing must fit within the timeline.');
    state.titles.push({ id:uid(), text:title.text, start:title.start, end:title.end, position:'custom', x:title.x ?? 50, y:title.y ?? 50, width:84, rotation:0, font:'sans-serif', bold:true, italic:false, size:title.size ?? 6, color:title.color || '#ffffff' });
  }
  const assembled = { state, duration:T.duration(state) };
  if (!assembled.duration) throw new Error('The timeline is empty.');
  let project = null;
  if (args.save_project) {
    const origin = serverUrl(), id = crypto.randomUUID();
    const response = await fetch(origin + '/api/projects/' + id, { method:'PUT', signal,
      headers:{ 'Content-Type':'application/json', 'Origin':origin, 'X-Cliproom-Request':'1' },
      body:JSON.stringify({ baseRevision:0, state:assembled.state }) });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(saved.error || 'Could not save the Cliproom project (' + response.status + ').');
    project = { id:saved.id, revision:saved.revision };
  }
  await progress?.(5, 100, 'Project assembled; rendering on the Cliproom server…');
  const body = project ? { project_id:project.id } : { project:assembled.state };
  if (args.render_mode) body.render_mode = args.render_mode;
  const result = await renderProjectRequest(body, args.output, signal);
  const warnings = args.media.some(entry => entry.keyframes?.some(frame => frame.time !== undefined)) ?
    ['Legacy keyframe time means source-media seconds, not timeline seconds. Prefer timeline_time or source_time.'] : [];
  return { ...result, operation:'render_video', duration_seconds:assembled.duration, project, warnings, note:'Imported media remains in the Cliproom server library.' };
}

export async function renderSavedProject(args, signal) {
  if (!!args.project_id === !!args.project_path) throw new Error('Provide either project_id or project_path.');
  await preflightVideoOutput(args.output, args.render_mode);
  let body;
  if (args.project_id) body = { project_id:args.project_id };
  else {
    const file = await inputPath(args.project_path), stat = await fs.stat(file);
    if (stat.size > 2 * 1024 * 1024) throw new Error('Project JSON is too large.');
    try { body = { project:JSON.parse(await fs.readFile(file, 'utf8')) }; }
    catch { throw new Error('Project file is not valid JSON.'); }
  }
  if (args.render_mode) body.render_mode = args.render_mode;
  return renderProjectRequest(body, args.output, signal);
}

async function renderProjectRequest(body, requestedOutput, signal) {
  const controller = new AbortController(), cancel = () => controller.abort();
  if (signal?.aborted) throw new Error('The request was cancelled.');
  signal?.addEventListener('abort', cancel, { once:true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const origin = serverUrl();
    const response = await fetch(origin + '/api/render', {
      method:'POST', headers:{ 'Content-Type':'application/json', 'Origin':origin, 'X-Cliproom-Request':'1' },
      body:JSON.stringify(body), signal:controller.signal
    });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Render failed (' + response.status + ').'); }
    const actualMode = response.headers.get('x-cliproom-render-mode') || 'realtime';
    if (body.render_mode === 'offline' && actualMode !== 'offline') { await response.body?.cancel(); throw new Error('The RoomSuite server does not support offline rendering. Update and restart the server.'); }
    const type = (response.headers.get('content-type') || '').split(';')[0];
    const ext = type === 'video/mp4' ? '.mp4' : type === 'video/webm' ? '.webm' : null;
    if (!ext) { await response.body?.cancel(); throw new Error('The renderer returned an unsupported video format.'); }
    let output;
    try { output = await outputPath(outputWithExtension(requestedOutput, ext), [ext]); }
    catch (error) { await response.body?.cancel(); throw error; }
    const saved = await saveResponse(response, output, type, controller.signal);
    return { ...saved, room:'Cliproom', operation:'render_project', project_id:body.project_id || null, render_mode:actualMode };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? 'The request was cancelled.' : 'The render timed out.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
