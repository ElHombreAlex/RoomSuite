import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { inputPath, outputPath, saveDownload } from './files.mjs';

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
async function withRoom(room, expectedTitle, signal, callback) {
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
  const files = await Promise.all(args.media.map(entry => inputPath(entry.input)));
  return withRoom('/cliproom/', 'Cliproom', signal, async page => {
    const format = await page.evaluate(() => formatSupport());
    if (!format) throw new Error('Cliproom cannot export video in this browser.');
    const ext = '.' + format.extension, out = await outputPath(outputWithExtension(args.output, ext), [ext]);
    for (let i = 0; i < files.length; i++) {
      await page.locator('#fileInput').setInputFiles(files[i]);
      try { await page.waitForFunction(expected => Number(document.querySelector('#assetCount').textContent) === expected && !document.querySelector('#importBtn').disabled, i + 1, { timeout:Math.min(timeoutMs, 60000) }); }
      catch { throw new Error('Could not import ' + args.media[i].input + ': ' + (await page.locator('#toast').textContent())); }
    }
    const configured = await page.evaluate(config => {
      const cursors = new Map();
      change(() => {
        state.name = config.name || 'RoomSuite agent video'; state.aspect = config.aspect || '16:9'; state.quality = config.quality || '720p';
        config.media.forEach((entry, i) => {
          const asset = state.assets[i], isAudio = asset.kind === 'audio';
          const clips = isAudio ? state.audioClips : state.clips;
          const item = clips.find(clip => clip.assetId === asset.id);
          if (!item) throw new Error('Imported media was not added to the timeline.');
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
          if (!isAudio && entry.opacity !== undefined) item.opacity = entry.opacity;
          item.fadeIn = entry.fade_in || 0; item.fadeOut = entry.fade_out || 0;
        });
        for (const title of config.titles || []) {
          if (title.end <= title.start || title.end > T.duration(state) + .001) throw new Error('Title timing must fit within the timeline.');
          state.titles.push({ id:uid(), text:title.text, start:title.start, end:title.end, position:'custom', x:title.x ?? 50, y:title.y ?? 50, width:84, rotation:0, font:'sans-serif', bold:true, italic:false, size:title.size ?? 6, color:title.color || '#ffffff' });
        }
        selected = null;
      });
      return { duration:T.duration(state) };
    }, args);
    if (!configured.duration) throw new Error('The timeline is empty.');
    let project = null;
    if (args.save_project) {
      project = await page.evaluate(async () => { await saveProject(); return revision ? { id:projectId, revision } : null; });
      if (!project) throw new Error('Cliproom could not save the project: ' + await page.locator('#toast').textContent());
    }
    await page.locator('#exportBtn').click();
    if (await page.locator('#startExportBtn').isDisabled()) throw new Error('Cliproom cannot export video in this browser.');
    let timer, progressBusy = false, lastProgress = 0;
    if (progress) timer = setInterval(async () => {
      if (progressBusy) return;
      progressBusy = true;
      try {
        const current = await page.evaluate(() => currentTime);
        const next = Math.min(95, Math.max(lastProgress, 5 + Math.floor(current / configured.duration * 90)));
        if (next > lastProgress) { lastProgress = next; await progress(next, 100, 'Rendering the Cliproom timeline…'); }
      } catch {} finally { progressBusy = false; }
    }, 5000);
    let result;
    try { result = await downloadTo(page, '#startExportBtn', out, mimeByExt[ext]); }
    finally { if (timer) clearInterval(timer); }
    return { ...result, room:'Cliproom', operation:'render_video', duration_seconds:configured.duration, project, note:'Imported media remains in the Cliproom server library.' };
  });
}
