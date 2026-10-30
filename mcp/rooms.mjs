import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import T from '../cliproom/public/timeline.js';
import { inputPath, outputPath, saveDownload, saveResponse } from './files.mjs';
import { attachPreview, previewOnPage } from './preview.mjs';

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
        const duration=kind==='image'?null:await readableDuration(media).catch(()=>null);
        return { name:file.name, bytes:file.size, mime_type:type, kind,
          width:kind === 'image' ? media.naturalWidth : kind === 'video' ? media.videoWidth : null,
          height:kind === 'image' ? media.naturalHeight : kind === 'video' ? media.videoHeight : null,
          duration_seconds:duration };
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
        const duration=kind==='image'?5:await readableDuration(media);
        info = { duration, width:kind === 'image' ? media.naturalWidth : media.videoWidth || 0, height:kind === 'image' ? media.naturalHeight : media.videoHeight || 0 };
      } finally { URL.revokeObjectURL(url); }
      const response = await fetch('/api/assets', { method:'POST', headers:{ 'Content-Type':'application/octet-stream', 'X-Cliproom-Request':'1', 'X-File-Type':type, 'X-File-Name':encodeURIComponent(file.name) }, body:file });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not upload media (' + response.status + ').');
      return { ...data, ...info, kind };
    });
  } finally { await handle.evaluate(input => input.remove()).catch(() => {}); await handle.dispose(); }
}
async function reuseCliproomMedia(page,id){return page.evaluate(async id=>{
  const response=await fetch('/api/assets/'+id+'/metadata');if(!response.ok)throw new Error('Cliproom asset not found: '+id);const meta=await response.json(),kind=meta.type.startsWith('image/')?'image':meta.type.startsWith('audio/')?'audio':meta.type.startsWith('video/')?'video':null;if(!kind)throw new Error('Unsupported Cliproom asset: '+id);
  const media=kind==='image'?new Image():document.createElement(kind);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Reading asset metadata timed out.')),20000),loaded=()=>{clearTimeout(timer);resolve();},failed=()=>{clearTimeout(timer);reject(new Error('The browser cannot decode asset '+id+'.'));};if(kind==='image')media.onload=loaded;else{media.preload='metadata';media.onloadedmetadata=loaded;}media.onerror=failed;media.src='/api/assets/'+id;});
  return {...meta,kind,duration:kind==='image'?5:await readableDuration(media),width:kind==='image'?media.naturalWidth:media.videoWidth||0,height:kind==='image'?media.naturalHeight:media.videoHeight||0};
},id);}
async function preflightVideoOutput(requested, mode) {
  const extension = path.extname(requested).toLowerCase();
  if (mode === 'offline') {
    if (extension && extension !== '.webm') throw new Error('Offline rendering outputs WebM. Use a .webm filename or omit the extension.');
    await outputPath(outputWithExtension(requested, '.webm'), ['.webm']);
  } else if (extension) {
    await outputPath(requested, ['.mp4', '.webm']);
  }
}
function validateMediaFields(entry,kind){
  if(kind!=='image'&&entry.duration!==undefined)throw Object.assign(new Error('The duration field applies only to still images. For audio or video, use source_in and source_out to choose the source range.'),{status:400});
  if(kind==='image'&&entry.source_out!==undefined)throw Object.assign(new Error('For a still image, use duration rather than source_out.'),{status:400});
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
    if (args.rotation !== undefined) await setField(page, '[data-prop="rotation"]', args.rotation);
    await page.locator('#exportBtn').click(); await page.locator('#exportFormat').selectOption(mimeByExt[ext]);
    const result = await downloadTo(page, '#downloadBtn', out, mimeByExt[ext]);
    return { ...result, room:'PixelRoom', operation:'edit_image' };
  });
}

export async function inpaintImage(args,signal){
  const input=await inputPath(args.input),mask=await inputPath(args.mask),out=await outputPath(args.output,['.png']);
  for(const file of [input,mask])if((await fs.stat(file)).size>20*1024*1024)throw new Error('Images and masks must be 20 MB or smaller.');
  return withRoom('/pixelroom/','Pixelroom',signal,async page=>{
    await page.evaluate(()=>{for(const id of ['inpaintInput','inpaintMask']){const input=document.createElement('input');input.type='file';input.id=id;document.body.append(input);}});
    await page.locator('#inpaintInput').setInputFiles(input);await page.locator('#inpaintMask').setInputFiles(mask);
    await page.evaluate(async()=>{
      const [source,mask]=await Promise.all(['inpaintInput','inpaintMask'].map(async id=>{const file=document.getElementById(id).files[0];try{return await createImageBitmap(file);}catch{throw new Error('The input and mask must be supported image files.');}}));
      if(source.width!==mask.width||source.height!==mask.height)throw new Error('The mask must have the same dimensions as the input image.');
      if(source.width*source.height>16000000)throw new Error('The image must be 16 megapixels or smaller for cleanup.');
      const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;},src=canvas(source.width,source.height),selection=canvas(source.width,source.height),sc=src.getContext('2d'),mc=selection.getContext('2d',{willReadFrequently:true});sc.drawImage(source,0,0);mc.drawImage(mask,0,0);source.close();mask.close();
      const pixels=mc.getImageData(0,0,selection.width,selection.height);let any=false;for(let i=0;i<pixels.data.length;i+=4){const d=pixels.data,level=Math.round((d[i]+d[i+1]+d[i+2])/3*d[i+3]/255);d[i]=d[i+1]=d[i+2]=255;d[i+3]=level;if(level>32)any=true;}if(!any)throw new Error('The mask contains no selected pixels.');mc.putImageData(pixels,0,0);window.roomsuiteInpaint={src,selection};
    });
    const [download]=await Promise.all([page.waitForEvent('download',{timeout:timeoutMs}),page.evaluate(async options=>{
      const {src,selection}=window.roomsuiteInpaint,result=await PixelVision.inpaint(src,selection,{x:0,y:0,w:src.width,h:src.height},()=>{},options),blob=await new Promise((resolve,reject)=>result.toBlob(value=>value?resolve(value):reject(new Error('PNG export failed.')),'image/png'));const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='cleanup.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    },{padding:args.padding??4,feather:args.feather??2})]);
    const result=await saveDownload(download,out,'image/png');return {...result,room:'PixelRoom',operation:'inpaint'};
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
    if (args.normalize || args.normalize_peak_dbfs !== undefined) {
      if(args.normalize_peak_dbfs!==undefined)await setField(page,'#normalizeTarget',args.normalize_peak_dbfs);
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
  const fillMode = element.fill_mode || (element.type === 'line' || element.type === 'path' ? 'none' : 'solid');
  const defaultWidth = element.type === 'text' || (['rect','ellipse'].includes(element.type) && fillMode !== 'none' && !element.stroke) ? 0 : 2;
  const item = { type:element.type, fillMode, fill:element.fill || '#a895e9', fill2:element.fill2 || '#f7bcb5', stroke:element.stroke || '#302a3e', strokeWidth:element.stroke_width ?? defaultWidth, opacity:element.opacity ?? 1 };
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
async function loadVectorElements(page,elements){
  const project={format:'vectorroom',version:1,objects:elements.map(vectorObject)};
  await page.locator('#openProject').setInputFiles({name:'agent.vectorroom',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await page.waitForFunction(()=>document.querySelector('#status').textContent.length>0,null,{timeout:30000});
  if(await page.locator('#status').evaluate(el=>el.classList.contains('error')))throw new Error(await page.locator('#status').textContent());
}
export async function previewVector(args,signal){return withRoom('/vectorroom/','VectorRoom',signal,async page=>{await loadVectorElements(page,args.elements);return attachPreview({room:'VectorRoom',operation:'preview_vector'},await previewOnPage(page,{kind:'vector',maxDimension:args.max_dimension}));});}
export async function createVector(args, signal) {
  const ext = path.extname(args.output).toLowerCase(), out = await outputPath(args.output, ['.svg','.png','.vectorroom']);
  return withRoom('/vectorroom/', 'VectorRoom', signal, async page => {
    await loadVectorElements(page,args.elements);
    const button = ext === '.svg' ? '#exportSvg' : ext === '.png' ? '#exportPng' : '#save';
    const result = await downloadTo(page, button, out, mimeByExt[ext]);
    const output={ ...result, room:'VectorRoom', operation:'create_vector', width:1000, height:700 };
    if(!args.include_preview)return output;
    try{return attachPreview(output,await previewOnPage(page,{kind:'vector',maxDimension:args.preview_max_dimension}));}
    catch(error){return {...output,preview_error:'The file was saved, but preview failed: '+error.message};}
  });
}

export async function recordScene(args, signal, progress) {
  if (!args.image && !args.text) throw new Error('Provide an image or text for the scene.');
  const image = args.image ? await inputPath(args.image) : null;
  return withRoom('/captureroom/', 'CaptureRoom', signal, async page => {
    let bounds={x:80,y:80,width:1120,height:560};
    if (image) {
      await page.locator('#imageFile').setInputFiles(image);
      await page.waitForFunction(() => [...document.querySelectorAll('#sources .item-main')].some(item => item.textContent), null, { timeout:30000 });
      if(args.image_fit==='cover')await page.locator('#fillFrame').click();
      if(args.image_box)for(const [key,value] of Object.entries(args.image_box))await setField(page,'#'+key,value);
      bounds=await page.evaluate(()=>{const item=source(),left=Math.max(0,item.x),top=Math.max(0,item.y),right=Math.min(output.width,item.x+item.width),bottom=Math.min(output.height,item.y+item.height),width=Math.max(1,right-left),height=Math.max(1,bottom-top),pad=Math.min(48,width*.05,height*.05);return {x:left+pad,y:top+pad,width:Math.max(1,width-2*pad),height:Math.max(1,height-2*pad)};});
    }
    if (args.text) {
      await page.locator('#addText').click(); await setField(page, '#text', args.text);
      for(const [key,value] of Object.entries(args.text_box||bounds))await setField(page,'#'+key,value);
      if (args.font_size !== undefined) await setField(page, '#fontSize', args.font_size);
      if (args.color) await setField(page, '#color', args.color);
      await page.locator('#textBackdrop').setChecked(args.text_backdrop!==false);
      if(args.text_fit!==false){const fits=await page.evaluate(()=>{const item=source();while(item.fontSize>8){outputCtx.font='700 '+item.fontSize+'px system-ui, sans-serif';if(wrapText(outputCtx,item.text,item.width).length*item.fontSize*1.2<=item.height)break;item.fontSize=Math.max(8,item.fontSize-1);}outputCtx.font='700 '+item.fontSize+'px system-ui, sans-serif';renderUi();return wrapText(outputCtx,item.text,item.width).length*item.fontSize*1.2<=item.height;});if(!fits)throw new Error('Text does not fit inside the text box. Use a larger box or less text.');}
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
  const entries=[...(args.media||[])],sequence=args.frame_sequence;
  if(!entries.length&&!sequence)throw new Error('Provide media or a frame_sequence.');
  if(sequence){if(!!sequence.frames===!!sequence.frame_asset_ids)throw new Error('Provide either frame_sequence.frames or frame_asset_ids.');const frames=sequence.frames||sequence.frame_asset_ids,count=Math.ceil(sequence.duration*sequence.fps-1e-9),start=sequence.start||0;if(count+entries.length>10000)throw new Error('Frame sequence exceeds the 10,000-clip project limit.');
    for(let i=0;i<count;i++){const at=start+i/sequence.fps,end=Math.min(start+sequence.duration,start+(i+1)/sequence.fps);entries.push({...(sequence.frames?{input:frames[i%frames.length]}:{asset_id:frames[i%frames.length]}),start:at,duration:end-at,track:sequence.track,fit:sequence.fit,scale:sequence.scale,x:sequence.x,y:sequence.y,_frame:true});}}
  for(const entry of entries)if(!!entry.input===!!entry.asset_id)throw new Error('Each media item needs exactly one input or asset_id.');
  for (const entry of entries) for (const frame of entry.keyframes || []) {
    if (['time','source_time','timeline_time'].filter(key => frame[key] !== undefined).length !== 1) throw new Error('Each keyframe must specify exactly one of timeline_time, source_time, or time.');
    if (!Object.keys(frame).some(key => !['time','source_time','timeline_time'].includes(key))) throw new Error('A keyframe must set at least one property.');
  }
  const requested=[...new Set(entries.map(entry=>entry.input).filter(Boolean))],resolved=await Promise.all(requested.map(inputPath)),fileFor=new Map(requested.map((name,i)=>[name,resolved[i]])),files=[...new Set(resolved)],existingIds=[...new Set(entries.map(entry=>entry.asset_id).filter(Boolean))];
  const inputKinds={'.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.gif':'image','.avif':'image','.mp3':'audio','.m4a':'audio','.wav':'audio','.ogg':'audio','.flac':'audio','.mp4':'video','.m4v':'video','.mov':'video','.webm':'video'};
  for(const entry of entries)if(entry.input){const kind=inputKinds[path.extname(entry.input).toLowerCase()];if(kind)validateMediaFields(entry,kind);}
  const {imported,existing} = await withRoom('/cliproom/', 'Cliproom', signal, async page => {
    const imported = [],existing=[];
    for(const id of existingIds)existing.push(await reuseCliproomMedia(page,id));
    for(const entry of entries)if(entry.asset_id)validateMediaFields(entry,existing.find(asset=>asset.id===entry.asset_id).kind);
    for (let i = 0; i < files.length; i++) {
      try { imported.push(await uploadCliproomMedia(page, files[i])); }
      catch (error) { throw new Error('Could not import ' + files[i] + ': ' + error.message); }
    }
    return {imported,existing};
  });
  const uid = () => crypto.randomUUID(), state = T.empty(uid), cursors = new Map(), assetFor=new Map(files.map((file,i)=>[file,imported[i]])),existingFor=new Map(existing.map(asset=>[asset.id,asset]));
  state.assets = [...imported,...existing];
  state.name = args.name || 'RoomSuite agent video'; state.aspect = args.aspect || '16:9'; state.quality = args.quality || '720p';if(args.background)state.background=args.background;
  entries.forEach(entry => {
    const asset = entry.asset_id?existingFor.get(entry.asset_id):assetFor.get(fileFor.get(entry.input)), isAudio = asset.kind === 'audio';
    if(entry._frame&&asset.kind!=='image')throw new Error('Frame sequences require still-image files or assets: '+(entry.input||entry.asset_id));
    validateMediaFields(entry,asset.kind);
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
  const warnings = entries.some(entry => entry.keyframes?.some(frame => frame.time !== undefined)) ?
    ['Legacy keyframe time means source-media seconds, not timeline seconds. Prefer timeline_time or source_time.'] : [];
  return { ...result, operation:'render_video', duration_seconds:assembled.duration, project, warnings, assets:[...requested.map(input=>({input,asset_id:assetFor.get(fileFor.get(input)).id})),...existing.map(asset=>({asset_id:asset.id,reused:true}))], note:'Imported media remains in the Cliproom server library.' };
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
