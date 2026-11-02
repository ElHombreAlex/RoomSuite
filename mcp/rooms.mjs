import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import T from '../cliproom/public/timeline.js';
import Grade from '../cliproom/public/color-grade.js';
import ClipLookFrames from '../cliproom/public/look-keyframes.js';
import SoundSession from '../SoundRoom/session.js';
import CaptureTemplate from '../CaptureRoom/template.js';
import { requestedGrade, requestedLook } from './color-grade.mjs';
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
export async function recognizePixelText(args,signal){
  const input=await inputPath(args.input),stat=await fs.stat(input);if(stat.size>20*1024*1024)throw new Error('OCR images must be 20 MiB or smaller.');
  return withRoom('/pixelroom/','Pixelroom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='agentOcrInput';document.body.append(input);});await page.locator('#agentOcrInput').setInputFiles(input);return page.evaluate(async({language,mode})=>{const file=document.querySelector('#agentOcrInput').files[0];if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');const image=await createImageBitmap(file);try{if(image.width*image.height>40000000)throw new Error('OCR images must be 40 megapixels or smaller.');const scale=Math.min(1,1800/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const result=await PixelRoomOCR.recognize(canvas,language,mode),sx=image.width/canvas.width,sy=image.height/canvas.height;return {...result,source_width:image.width,source_height:image.height,sample_width:canvas.width,sample_height:canvas.height,lines:result.lines.map(line=>({...line,box:line.box?{x:line.box.x*sx,y:line.box.y*sy,width:line.box.width*sx,height:line.box.height*sy}:null})),note:'OCR runs locally and may misread text; review the result. Line boxes are approximate source-image pixels.'};}finally{image.close();}},{language:args.language||'eng',mode:args.mode||'block'});});
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
async function preflightVideoOutput(requested, mode, requestedFormat) {
  const extension = path.extname(requested).toLowerCase();
  if (extension && !['.mp4','.webm'].includes(extension)) throw new Error('Video output must use .mp4 or .webm.');
  const format=requestedFormat && requestedFormat!=='auto' ? requestedFormat : (extension ? extension.slice(1) : 'auto');
  if(extension && format!=='auto' && extension!=='.'+format)throw new Error('The output filename extension does not match output_format.');
  if (mode === 'offline') {
    if (format === 'mp4') throw new Error('Offline rendering outputs WebM. Use realtime mode for MP4/H.264.');
    await outputPath(outputWithExtension(requested, '.webm'), ['.webm']);
  } else if (format !== 'auto') {
    await outputPath(outputWithExtension(requested, '.'+format), ['.'+format]);
  } else if (extension) {
    await outputPath(requested, ['.mp4', '.webm']);
  }
  return format;
}
function validateMediaFields(entry,kind){
  if(kind==='audio'&&(entry.preset_path||entry.color_adjustments||entry.color_look||entry.lut_path||entry.remove_lut||entry.grade_strength!==undefined||entry.grade_enabled!==undefined))throw Object.assign(new Error('Color grading applies only to picture clips.'),{status:400});
  if(kind==='audio'&&entry.keyframes?.some(frame=>frame.creative_look!==undefined||[...Grade.advanced,...Object.keys(Grade.Look.effectSpecs)].some(key=>frame[key]!==undefined)))throw Object.assign(new Error('Color keyframes apply only to picture clips.'),{status:400});
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
  const requested = await requestedGrade(args);
  return withRoom('/pixelroom/', 'Pixelroom', signal, async page => {
    await page.waitForSelector('#layersList [data-layer]');
    await page.locator('#imageInput').setInputFiles(input);
    await waitForToast(page, 'Photo opened.');
    for (const key of ['brightness','contrast','saturation']) if (args[key] !== undefined) await setField(page, '#' + key, args[key]);
    if(requested||args.grade_strength!==undefined||args.grade_enabled!==undefined){
      const current=await page.evaluate(()=>window.PixelRoomGrade.get()),values=requested?.adjustments||current.adjustments,look=requestedLook(current,requested);
      for(const key of Grade.basic)if(args[key]!==undefined)values[key]=args[key];
      await page.evaluate(({values,strength,enabled,look})=>window.PixelRoomGrade.apply(values,strength,enabled,look),{values,strength:args.grade_strength??current.strength,enabled:args.grade_enabled??(requested?true:current.enabled),look});
    }
    if (args.remove_background) {
      await page.locator('[data-tab="isolate"]').click(); await page.locator('#removeBgBtn').click();
      await page.waitForFunction(() => !document.querySelector('#subjectThreshold').disabled || document.querySelector('#maskHint').textContent.includes('unavailable'), null, { timeout:timeoutMs });
      if (await page.locator('#subjectThreshold').isDisabled()) throw new Error('PixelRoom could not run its local subject model.');
      await page.locator('#applyMaskBtn').click(); await waitForToast(page, 'Editable background cutout applied.');
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

export async function inspectAudioSession(args){const file=await inputPath(args.input),stat=await fs.stat(file);if(stat.size>SoundSession.maxBytes)throw new Error('Session files must be 32 MiB or smaller.');const bytes=await fs.readFile(file);if(bytes.length>SoundSession.maxBytes)throw new Error('Session files must be 32 MiB or smaller.');const session=SoundSession.decode(bytes.toString('utf8'));return {revision:crypto.createHash('sha256').update(bytes).digest('hex'),title:session.title,duration_seconds:session.frames/session.sampleRate,sample_rate:session.sampleRate,channels:session.channels,processing:session.processing,cursor:session.cursor,selection:session.selection,markers:session.markers};}
async function soundInput(args,requireRevision){
  const input=await inputPath(args.input);
  const isSession=path.extname(input).toLowerCase()==='.soundroom';let sessionBytes;
  if(isSession){if(requireRevision&&!args.base_revision)throw new Error('Inspect the session and supply its base_revision before editing.');const stat=await fs.stat(input);if(stat.size>SoundSession.maxBytes)throw new Error('Session files must be 32 MiB or smaller.');sessionBytes=await fs.readFile(input);if(sessionBytes.length>SoundSession.maxBytes)throw new Error('Session files must be 32 MiB or smaller.');if(args.base_revision&&crypto.createHash('sha256').update(sessionBytes).digest('hex')!==args.base_revision)throw Object.assign(new Error('The SoundRoom session changed. Inspect it again.'),{status:409});SoundSession.decode(sessionBytes.toString('utf8'));}else if(args.base_revision)throw new Error('base_revision applies only to .soundroom input.');
  return {input,isSession,sessionBytes};
}
async function prepareSound(page,source,args){
    const {input,isSession,sessionBytes}=source;
    if(isSession)await page.locator('#projectFile').setInputFiles({name:path.basename(input),mimeType:'application/json',buffer:sessionBytes});else await page.locator('#audioFile').setInputFiles(input);
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
    for(const [key,id] of [['eq_low_db','eqLow'],['eq_mid_db','eqMid'],['eq_high_db','eqHigh']])if(args[key]!==undefined)await setField(page,'#'+id,args[key]);
    if(args.compressor){if(args.compressor.threshold_dbfs!==undefined)await setField(page,'#threshold',args.compressor.threshold_dbfs);if(args.compressor.ratio!==undefined)await setField(page,'#ratio',args.compressor.ratio);await page.locator('#compressor').evaluate((node,enabled)=>{node.checked=enabled;node.dispatchEvent(new Event('change',{bubbles:true}));},args.compressor.enabled);}
    if(args.noise_gate){if(args.noise_gate.threshold_dbfs!==undefined)await setField(page,'#noiseThreshold',args.noise_gate.threshold_dbfs);if(args.noise_gate.reduction_db!==undefined)await setField(page,'#noiseReduction',args.noise_gate.reduction_db);await page.locator('#noiseGate').evaluate((node,enabled)=>{node.checked=enabled;node.dispatchEvent(new Event('change',{bubbles:true}));},args.noise_gate.enabled);}
    if(args.limiter){if(args.limiter.ceiling_dbfs!==undefined)await setField(page,'#ceiling',args.limiter.ceiling_dbfs);await page.locator('#limiter').evaluate((node,enabled)=>{node.checked=enabled;node.dispatchEvent(new Event('change',{bubbles:true}));},args.limiter.enabled);}
}
async function downloadSound(page,selector,output,type){const failed=page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'),null,{timeout:timeoutMs}).then(()=>null).catch(()=>null),wait=page.waitForEvent('download',{timeout:timeoutMs});const [result]=await Promise.all([Promise.race([wait,failed]),page.locator(selector).click()]);if(!result)throw new Error(await page.locator('#status').textContent()||'SoundRoom could not prepare the output.');return saveDownload(result,output,type);}
export async function analyzeAudioLoudness(args,signal){const source=await soundInput(args,false);if(!source.isSession&&(await fs.stat(source.input)).size>20*1024*1024)throw new Error('Audio files must be 20 MiB or smaller for loudness analysis.');return withRoom('/soundroom/','SoundRoom',signal,async page=>{await prepareSound(page,source,args);return page.evaluate(()=>measureLoudness());});}
export async function editAudio(args, signal) {
  const ext=path.extname(args.output).toLowerCase(),out = await outputPath(args.output, ['.wav','.soundroom']),source=await soundInput(args,true);
  return withRoom('/soundroom/', 'SoundRoom', signal, async page => {
    await prepareSound(page,source,args);
    if(ext==='.soundroom'&&await page.evaluate(()=>buffer.length*buffer.numberOfChannels*4>SoundSession.maxPcmBytes))throw new Error('This audio is too large for a self-contained session. Export a WAV or use a shorter clip.');
    const result = await downloadSound(page, ext==='.wav'?'#export':'#saveProject', out, ext==='.wav'?'audio/wav':'application/json');
    const outputDuration = await page.locator('#playhead').evaluate(element => Number(element.max));
    return { ...result, room:'SoundRoom', operation:'edit_audio', duration_seconds:outputDuration,...(ext==='.soundroom'?{revision:crypto.createHash('sha256').update(await fs.readFile(out)).digest('hex')}:{}) };
  });
}
function handoffUuid(id,label){const bytes=crypto.createHash('sha256').update('roomsuite-sound-handoff-v1:'+label+':'+id.toLowerCase()).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}
export async function handoffSound(args,signal){
  const source=await soundInput(args,true),ids={sourceId:handoffUuid(args.handoff_id,'source'),processedId:handoffUuid(args.handoff_id,'processed')},targetProject=handoffUuid(args.handoff_id,'project'),origin=serverUrl();
  return withRoom('/soundroom/','SoundRoom',signal,async page=>{await prepareSound(page,source,args);await page.evaluate(value=>{window.SoundRoomHandoffIds=value;},ids);await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#openCliproom').classList.contains('hidden')||document.querySelector('#status').classList.contains('error'),null,{timeout:timeoutMs});if(await page.locator('#status').evaluate(node=>node.classList.contains('error')))throw new Error(await page.locator('#status').textContent());const href=await page.locator('#openCliproom').getAttribute('href'),url=new URL(href,origin);if(url.origin!==origin||url.pathname!=='/cliproom/'||url.searchParams.get('asset')!==ids.processedId||url.searchParams.get('source_asset')!==ids.sourceId)throw new Error('SoundRoom returned an invalid handoff.');const processing=JSON.parse(url.searchParams.get('processing')),result={handoff_id:args.handoff_id,source_asset_id:ids.sourceId,processed_asset_id:ids.processedId,url:url.href,processing,note:'Cliproom plays the processed copy. Reopen its linked source in SoundRoom to edit settings and send a new clip.'};if(args.create_project===false)return result;
    async function existingProject(){const response=await fetch(origin+'/api/projects/'+targetProject,{signal});if(response.status===404)return null;if(!response.ok)throw new Error('Could not check the handoff project.');const project=await response.json(),match=project.state?.audioClips?.find(clip=>clip.assetId===ids.processedId&&clip.soundroom?.sourceAssetId===ids.sourceId);if(!match)throw new Error('The handoff project ID is already in use. Use a new handoff ID.');return project;}
    let existing=await existingProject();if(existing)return {...result,project_id:targetProject,revision:existing.revision,already_exists:true};await page.goto(url.href);await page.waitForFunction(()=>!mediaBusy&&state.audioClips.some(clip=>clip.soundroom)||document.querySelector('#toast').textContent.startsWith('Could not open the media'),null,{timeout:60000});if(!await page.evaluate(()=>state.audioClips.some(clip=>clip.soundroom)))throw new Error(await page.locator('#toast').textContent());await page.evaluate(id=>{projectId=id;},targetProject);await page.locator('#saveBtn').click();await page.waitForFunction(()=>revision>0||document.querySelector('#conflictDialog').open||document.querySelector('#toast').textContent.startsWith('The server could not'),null,{timeout:60000});if(await page.evaluate(()=>revision>0))return {...result,project_id:targetProject,revision:await page.evaluate(()=>revision),already_exists:false};existing=await existingProject();if(existing)return {...result,project_id:targetProject,revision:existing.revision,already_exists:true};throw new Error('The handoff project could not be saved.');
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
    if (element.type === 'text') { item.text = element.text; item.fontSize = element.font_size || 56; item.font = element.font || 'sans-serif'; for(const [source,target] of [['font_weight','fontWeight'],['font_style','fontStyle'],['text_align','textAlign'],['line_height','lineHeight'],['letter_spacing','letterSpacing']])if(element[source]!==undefined)item[target]=element[source]; }
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
async function readVectorProject(requested){const file=await inputPath(requested);if(path.extname(file).toLowerCase()!=='.vectorroom')throw new Error('Choose a .vectorroom project.');const stat=await fs.stat(file);if(stat.size>32*1024*1024)throw new Error('VectorRoom projects must be 32 MiB or smaller.');const bytes=await fs.readFile(file);if(bytes.length>32*1024*1024)throw new Error('VectorRoom projects must be 32 MiB or smaller.');let doc;try{doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('VectorRoom project must be valid UTF-8 JSON.');}const ids=[],collect=(item,depth=0)=>{ids.push(item?.id);if(depth===0&&item?.type==='boolean'&&Array.isArray(item.children))for(const child of item.children)collect(child,1);};if(Array.isArray(doc?.objects))for(const item of doc.objects)collect(item);const idsStable=ids.length>0&&ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id))&&new Set(ids).size===ids.length;return {bytes,revision:crypto.createHash('sha256').update(bytes).digest('hex'),idsStable};}
async function loadVectorProject(page,bytes){await page.locator('#openProject').setInputFiles({name:'project.vectorroom',mimeType:'application/json',buffer:bytes});await page.waitForFunction(()=>document.querySelector('#status').textContent==='Project opened.'||document.querySelector('#status').classList.contains('error'),null,{timeout:30000});if(await page.locator('#status').evaluate(node=>node.classList.contains('error')))throw new Error(await page.locator('#status').textContent());}
export async function inspectVectorProject(args,signal){const source=await readVectorProject(args.input);if(args.object_id&&!source.idsStable)throw new Error('This project lacks stable object IDs. Inspect by index instead.');return withRoom('/vectorroom/','VectorRoom',signal,async page=>{await loadVectorProject(page,source.bytes);return {revision:source.revision,ids_stable:source.idsStable,objects:await page.evaluate(input=>VectorOperations.inspect(input),{id:args.object_id,index:args.index,includeNodes:args.include_path_nodes})};});}
export async function arrangeVectorProject(args,signal){if(args.action!=='move'&&(args.dx!==undefined||args.dy!==undefined||args.snap_guides!==undefined))throw new Error('Move distance and guide snapping apply only to move.');const source=await readVectorProject(args.input);if(source.revision!==args.revision)throw Object.assign(new Error('This vector project changed. Inspect it before editing.'),{code:'REVISION_CONFLICT',currentRevision:source.revision});if(args.object_ids&&!source.idsStable)throw new Error('This project lacks stable object IDs. Use indices and save a normalized copy first.');const out=await outputPath(args.output,['.vectorroom']);return withRoom('/vectorroom/','VectorRoom',signal,async page=>{await loadVectorProject(page,source.bytes);const changed=await page.evaluate(input=>VectorOperations.apply(input),{ids:args.object_ids,indices:args.indices,action:args.action,dx:args.dx,dy:args.dy,snap:args.snap_guides});const result=await downloadTo(page,'#save',out,'application/json'),output={...result,room:'VectorRoom',operation:'arrange_vector',input_revision:source.revision,revision:crypto.createHash('sha256').update(await fs.readFile(out)).digest('hex'),...changed};if(!args.include_preview)return output;try{return attachPreview(output,await previewOnPage(page,{kind:'vector',maxDimension:args.preview_max_dimension}));}catch(error){return {...output,preview_error:'The file was saved, but preview failed: '+error.message};}});}
export async function updateVectorProject(args,signal){
  if((args.object_id===undefined)===(args.index===undefined))throw new Error('Provide exactly one object_id or index.');
  if(!args.dry_run&&!args.output)throw new Error('Choose a new output file, or use dry_run.');
  const source=await readVectorProject(args.input);
  if(source.revision!==args.revision)throw Object.assign(new Error('This vector project changed. Inspect it before editing.'),{code:'REVISION_CONFLICT',currentRevision:source.revision});
  if(args.object_id&&!source.idsStable)throw new Error('This project lacks stable object IDs. Use an index and save a normalized copy first.');
  const out=args.dry_run?null:await outputPath(args.output,['.vectorroom']),names={fill_mode:'fillMode',stroke_width:'strokeWidth',font_size:'fontSize',font_weight:'fontWeight',font_style:'fontStyle',text_align:'textAlign',line_height:'lineHeight',letter_spacing:'letterSpacing'},properties={};
  for(const [key,value]of Object.entries(args.properties))properties[names[key]||key]=key==='points'?value.map(point=>({x:point.x,y:point.y,inX:point.in_x,inY:point.in_y,outX:point.out_x,outY:point.out_y})):value;
  return withRoom('/vectorroom/','VectorRoom',signal,async page=>{
    await loadVectorProject(page,source.bytes);
    const changed=await page.evaluate(input=>VectorOperations.update(input),{id:args.object_id,index:args.index,properties});
    let output={room:'VectorRoom',operation:'update_vector',input_revision:source.revision,dry_run:!!args.dry_run,...changed};
    if(out){const result=await downloadTo(page,'#save',out,'application/json');output={...output,...result,revision:crypto.createHash('sha256').update(await fs.readFile(out)).digest('hex')};}
    if(!args.include_preview)return output;
    try{return attachPreview(output,await previewOnPage(page,{kind:'vector',maxDimension:args.preview_max_dimension}));}catch(error){return {...output,preview_error:(out?'The file was saved, but preview failed: ':'Preview failed: ')+error.message};}
  });
}

async function readCaptureTemplate(requested){if(path.extname(requested).toLowerCase()!=='.capturescene')throw new Error('A scene template must use .capturescene.');const file=await inputPath(requested),stat=await fs.stat(file);if(stat.size>CaptureTemplate.maxBytes)throw new Error('Template files must be 4 MiB or smaller.');const bytes=await fs.readFile(file);if(bytes.length>CaptureTemplate.maxBytes)throw new Error('Template files must be 4 MiB or smaller.');return {bytes,template:CaptureTemplate.parse(bytes.toString('utf8'))};}
function captureSummary(template){return {name:template.name,sources:template.sources.map(source=>{const {image,...fields}=source;return {...fields,...(image?{embedded_image_bytes:Math.floor(image.slice(image.indexOf(',')+1).length*3/4)-(image.endsWith('==')?2:image.endsWith('=')?1:0)}:{})};})};}
export async function inspectCaptureTemplate(args){const {bytes,template}=await readCaptureTemplate(args.input);return {revision:crypto.createHash('sha256').update(bytes).digest('hex'),template:captureSummary(template)};}
export async function createCaptureTemplate(args,signal){
  const sources=[],images=[];for(const input of args.sources){const isCamera=input.type==='camera',isText=input.type==='text',defaults={x:isCamera?910:isText?80:0,y:isCamera?500:isText?80:0,width:isCamera?300:isText?800:1280,height:isCamera?169:isText?160:720};const item={type:input.type,name:input.name||input.type[0].toUpperCase()+input.type.slice(1),visible:input.visible??true,x:input.x??defaults.x,y:input.y??defaults.y,width:input.width??defaults.width,height:input.height??defaults.height,volume:input.volume??1};
    if(input.type==='image'){if(!input.image_path)throw new Error('Image template sources require image_path.');const file=await inputPath(input.image_path),stat=await fs.stat(file);if(stat.size>CaptureTemplate.maxImageBytes)throw new Error('Each template image must be 2 MiB or smaller.');const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'}[path.extname(file).toLowerCase()];if(!mime)throw new Error('Template images must be PNG, JPEG, WebP or GIF.');const bytes=await fs.readFile(file);if(bytes.length>CaptureTemplate.maxImageBytes)throw new Error('Each template image must be 2 MiB or smaller.');item.image='data:'+mime+';base64,'+bytes.toString('base64');images.push({file,mime,bytes});}else if(input.image_path)throw new Error('image_path applies only to image sources.');
    if(isText)Object.assign(item,{text:input.text??'Your story starts here',fontSize:input.font_size??60,color:input.color??'#ffffff',textBackdrop:input.text_backdrop??false});else if(input.text!==undefined||input.font_size!==undefined||input.color!==undefined||input.text_backdrop!==undefined)throw new Error('Text style applies only to text sources.');sources.push(item);
  }
  const template=CaptureTemplate.validate({format:'captureroom-scene-template',version:1,name:args.name,sources}),data=CaptureTemplate.serialize(template),out=await outputPath(args.output,['.capturescene']);
  if(images.length)await withRoom('/captureroom/','CaptureRoom',signal,async page=>{await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='capture-template-probe';document.body.append(input);});for(const image of images){await page.locator('#capture-template-probe').setInputFiles({name:path.basename(image.file),mimeType:image.mime,buffer:image.bytes});await page.evaluate(async()=>{let bitmap;try{bitmap=await createImageBitmap(document.querySelector('#capture-template-probe').files[0]);if(bitmap.width*bitmap.height>16000000)throw new Error('Template images must be 16 megapixels or smaller.');}catch(error){throw new Error('Could not decode a template image: '+error.message);}finally{bitmap?.close();}});}});
  await fs.writeFile(out,data,{flag:'wx',mode:0o600});return {path:out,bytes:Buffer.byteLength(data),mime_type:'application/json',room:'CaptureRoom',operation:'create_scene_template',revision:crypto.createHash('sha256').update(data).digest('hex'),template:captureSummary(template)};
}
export async function recordScene(args, signal, progress) {
  if (!args.image && !args.text && !args.template_path) throw new Error('Provide an image, text or scene template.');
  if(args.template_path&&['image','text','image_fit','image_box','font_size','color','text_box','text_backdrop','text_fit'].some(key=>args[key]!==undefined))throw new Error('Use a scene template or direct image/text options, not both.');
  const pauses=args.pauses||[];if(pauses.some((pause,index)=>pause.at_seconds>=args.duration||(index&&pause.at_seconds<=pauses[index-1].at_seconds)))throw new Error('Pause times must be strictly increasing and inside the recording duration.');
  const image = args.image ? await inputPath(args.image) : null,template=args.template_path?await readCaptureTemplate(args.template_path):null;
  if(template?.template.sources.some(source=>source.visible&&['screen','camera','mic'].includes(source.type)))throw new Error('Visible screen, camera or microphone sources require a person to reconnect them in CaptureRoom.');
  return withRoom('/captureroom/', 'CaptureRoom', signal, async page => {
    let bounds={x:80,y:80,width:1120,height:560};
    if(args.resolution!==undefined)await page.locator('#recordResolution').selectOption(String(args.resolution));
    if(template){await page.locator('#templateFile').setInputFiles({name:'scene.capturescene',mimeType:'application/json',buffer:template.bytes});await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Template opened as a new scene.')||document.querySelector('#status').classList.contains('error'),null,{timeout:30000});if(await page.locator('#status').evaluate(node=>node.classList.contains('error')))throw new Error(await page.locator('#status').textContent());}
    if (image) {
      await page.locator('#imageFile').setInputFiles(image);
      await page.waitForFunction(() => [...document.querySelectorAll('#sources .item-main')].some(item => item.textContent), null, { timeout:30000 });
      if(args.image_fit==='cover')await page.locator('#fillFrame').click();
      if(args.image_box)for(const [key,value] of Object.entries(args.image_box))await setField(page,'#'+key,value);
      bounds=await page.evaluate(()=>{const item=source(),left=Math.max(0,item.x),top=Math.max(0,item.y),right=Math.min(stageWidth,item.x+item.width),bottom=Math.min(stageHeight,item.y+item.height),width=Math.max(1,right-left),height=Math.max(1,bottom-top),pad=Math.min(48,width*.05,height*.05);return {x:left+pad,y:top+pad,width:Math.max(1,width-2*pad),height:Math.max(1,height-2*pad)};});
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
    if(args.countdown!==undefined)await page.locator('#recordCountdown').selectOption(String(args.countdown));if(args.fps!==undefined)await page.locator('#recordFps').selectOption(String(args.fps));await page.locator('#enableRecovery').uncheck();
    await page.locator('#record').click();
    await page.waitForFunction(() => document.querySelector('#recordState').textContent === 'RECORDING' || document.querySelector('#status').classList.contains('error'));
    if (await page.locator('#status').evaluate(el => el.classList.contains('error'))) throw new Error(await page.locator('#status').textContent());
    const started = Date.now();let pausedMs=0,nextPause=0;
    while (true) {
      const elapsed = (Date.now() - started - pausedMs) / 1000, remaining = args.duration - elapsed;
      if (remaining <= 0) break;
      const pause=pauses[nextPause];if(pause&&elapsed>=pause.at_seconds){if(await page.locator('#pauseRecord').isHidden())throw new Error('This browser cannot pause recording.');await page.locator('#pauseRecord').click();await page.waitForFunction(()=>document.querySelector('#recordState').textContent==='PAUSED');const began=Date.now();await delay(pause.duration_seconds*1000,undefined,{signal});await page.locator('#pauseRecord').click();await page.waitForFunction(()=>document.querySelector('#recordState').textContent==='RECORDING');pausedMs+=Date.now()-began;nextPause++;continue;}
      await delay(Math.max(.01,Math.min(remaining,5,pause?Math.max(0,pause.at_seconds-elapsed):5)) * 1000, undefined, { signal });
      const percentage = Math.min(90, 5 + Math.floor((Date.now() - started-pausedMs) / 1000 / args.duration * 85));
      await progress?.(percentage, 100, 'Recording the prepared scene…');
    }
    await page.locator('#record').click();
    await page.waitForFunction(() => !document.querySelector('#result').classList.contains('hidden') || document.querySelector('#status').classList.contains('error'), null, { timeout:30000 });
    if (await page.locator('#status').evaluate(el => el.classList.contains('error'))) throw new Error(await page.locator('#status').textContent());
    const result = await downloadTo(page, '#download', out, mimeByExt[ext]);
    return { ...result, room:'CaptureRoom', operation:'record_scene', requested_duration_seconds:args.duration, resolution:args.resolution??720,...(template?.template.sources.some(source=>['screen','camera','mic'].includes(source.type))?{warnings:['Hidden live sources were not connected; device permissions require an interactive browser.']}:{}) };
  });
}

export async function renderVideo(args, signal, progress) {
  const outputFormat=await preflightVideoOutput(args.output, args.render_mode, args.output_format);
  const entries=[...(args.media||[])],sequence=args.frame_sequence;
  if(!entries.length&&!sequence)throw new Error('Provide media or a frame_sequence.');
  if(sequence){if(!!sequence.frames===!!sequence.frame_asset_ids)throw new Error('Provide either frame_sequence.frames or frame_asset_ids.');const frames=sequence.frames||sequence.frame_asset_ids,count=Math.ceil(sequence.duration*sequence.fps-1e-9),start=sequence.start||0;if(count+entries.length>10000)throw new Error('Frame sequence exceeds the 10,000-clip project limit.');
    for(let i=0;i<count;i++){const at=start+i/sequence.fps,end=Math.min(start+sequence.duration,start+(i+1)/sequence.fps);entries.push({...(sequence.frames?{input:frames[i%frames.length]}:{asset_id:frames[i%frames.length]}),start:at,duration:end-at,track:sequence.track,fit:sequence.fit,scale:sequence.scale,x:sequence.x,y:sequence.y,_frame:true});}}
  for(const entry of entries)if(!!entry.input===!!entry.asset_id)throw new Error('Each media item needs exactly one input or asset_id.');
  const grades=await Promise.all(entries.map(entry=>requestedGrade(entry)));
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
  entries.forEach((entry, entryIndex) => {
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
    if (!isAudio&&(grades[entryIndex]||entry.grade_strength!==undefined||entry.grade_enabled!==undefined)) {
      const current=Grade.readTarget(item,'clip'),request=grades[entryIndex],values=request?.adjustments||current.adjustments,look=requestedLook(current,request);
      for(const key of Grade.basic)if(entry[key]!==undefined)values[key]=entry[key]-100;
      Grade.writeTarget(item,'clip',values,entry.grade_strength??current.strength,entry.grade_enabled??true,look);
    }
    if (entry.keyframes) {
      const times = new Set();
      item.keyframes = entry.keyframes.map(frame => {
        const { timeline_time, source_time, time:legacyTime, creative_look, ...values } = frame;
        if (timeline_time !== undefined && (timeline_time < item.start - 1e-9 || timeline_time > T.end(item) + 1e-9)) throw new Error('Keyframe timeline_time must fall within the clip for ' + asset.name + '.');
        const time = timeline_time === undefined ? (source_time ?? legacyTime) : Math.max(item.in, Math.min(item.out, item.in + (timeline_time - item.start) * T.rate(item)));
        const timeKey = Math.round(time * 1e9);
        if (times.has(timeKey)) throw new Error('Keyframe times must be unique for ' + asset.name + '.');
        times.add(timeKey);
        if (creative_look !== undefined) { values.creativeLook=ClipLookFrames.validate(creative_look);state.version=5; }
        return { id:uid(), time, ...values };
      }).sort((a,b) => a.time - b.time);
    }
    item.fadeIn = entry.fade_in || 0; item.fadeOut = entry.fade_out || 0;
  });
  for (const title of args.titles || []) {
    if (title.end <= title.start || title.end > T.duration(state) + .001) throw new Error('Title timing must fit within the timeline.');
    state.titles.push({ id:uid(), text:title.text, start:title.start, end:title.end, position:'custom', x:title.x ?? 50, y:title.y ?? 50, width:84, rotation:0, font:'sans-serif', bold:true, italic:false, size:title.size ?? 6, color:title.color || '#ffffff' });
  }
  if(state.version<5&&T.requiresV5(state))state.version=5;
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
  if (args.include_audio !== undefined) body.include_audio = args.include_audio;
  if (outputFormat !== 'auto') body.output_format = outputFormat;
  const result = await renderProjectRequest(body, args.output, signal);
  const warnings = entries.some(entry => entry.keyframes?.some(frame => frame.time !== undefined)) ?
    ['Legacy keyframe time means source-media seconds, not timeline seconds. Prefer timeline_time or source_time.'] : [];
  return { ...result, operation:'render_video', duration_seconds:assembled.duration, project, warnings, assets:[...requested.map(input=>({input,asset_id:assetFor.get(fileFor.get(input)).id})),...existing.map(asset=>({asset_id:asset.id,reused:true}))], note:'Imported media remains in the Cliproom server library.' };
}

export async function renderSavedProject(args, signal) {
  if (!!args.project_id === !!args.project_path) throw new Error('Provide either project_id or project_path.');
  const outputFormat=await preflightVideoOutput(args.output, args.render_mode, args.output_format);
  let body;
  if (args.project_id) body = { project_id:args.project_id };
  else {
    const file = await inputPath(args.project_path), stat = await fs.stat(file);
    if (stat.size > 2 * 1024 * 1024) throw new Error('Project JSON is too large.');
    try { body = { project:JSON.parse(await fs.readFile(file, 'utf8')) }; }
    catch { throw new Error('Project file is not valid JSON.'); }
  }
  if (args.render_mode) body.render_mode = args.render_mode;
  if (args.include_audio !== undefined) body.include_audio = args.include_audio;
  if (outputFormat !== 'auto') body.output_format = outputFormat;
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
    if (body.include_audio === false && response.headers.get('x-cliproom-audio-included') !== 'false') { await response.body?.cancel(); throw new Error('The RoomSuite server did not confirm a silent export. Update and restart the server.'); }
    const type = (response.headers.get('content-type') || '').split(';')[0];
    const ext = type === 'video/mp4' ? '.mp4' : type === 'video/webm' ? '.webm' : null;
    if (!ext) { await response.body?.cancel(); throw new Error('The renderer returned an unsupported video format.'); }
    if (body.output_format && ext !== '.'+body.output_format) { await response.body?.cancel(); throw new Error('The renderer did not honor output_format. Update and restart the RoomSuite server.'); }
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
