'use strict';
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const preview = $('preview'), previewCtx = preview.getContext('2d');
const output = document.createElement('canvas'); output.width = 1280; output.height = 720;
const outputCtx = output.getContext('2d');
let scenes = [{ id:uid(), name:'Scene 1', sources:[] }], activeScene = scenes[0].id, selected = null;
let audioContext = null, audioDestination = null, silentSource = null, recorder = null, canvasStream = null, chunks = [], recordingStart = 0, recordingBlob = null, recordingDuration = 0, currentRecordingDuration = 0, recordings = [], drag = null, lastDraw = 0;
function scene() { return scenes.find(item => item.id === activeScene); }
function source() { return scene()?.sources.find(item => item.id === selected); }
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function time(seconds) { seconds = Math.floor(seconds); return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0'); }
function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)(); audioDestination = audioContext.createMediaStreamDestination();
    // Keep the mixed audio track ticking even before a microphone is added.
    // Otherwise some browsers produce an empty recording for a silent scene.
    silentSource = audioContext.createConstantSource(); const silence = audioContext.createGain(); silence.gain.value = 0;
    silentSource.connect(silence); silence.connect(audioDestination); silentSource.start();
  }
  return audioContext.resume();
}
function connectAudio(item) {
  if (!item.stream?.getAudioTracks().length) return;
  item.audioNode = audioContext.createMediaStreamSource(item.stream); item.gainNode = audioContext.createGain();
  item.audioNode.connect(item.gainNode); item.gainNode.connect(audioDestination); syncAudio();
}
function syncAudio() {
  for (const s of scenes) for (const item of s.sources) if (item.gainNode) item.gainNode.gain.value = s.id === activeScene && item.visible && !item.ended ? item.volume : 0;
}
function cleanup(item) {
  if (item.stream) item.stream.getTracks().forEach(track => track.stop());
  if (item.audioNode) item.audioNode.disconnect(); if (item.gainNode) item.gainNode.disconnect();
  if (item.video) item.video.srcObject = null; if (item.url) URL.revokeObjectURL(item.url);
}
function renderUi() {
  const current = scene(), item = source();
  $('sceneName').value = current.name; $('deleteScene').disabled = scenes.length <= 1;
  $('scenes').replaceChildren();
  scenes.forEach(entry => {
    const row = document.createElement('div'); row.className = 'list-item' + (entry.id === activeScene ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'source-icon'; icon.textContent = '▣';
    const button = document.createElement('button'); button.className = 'item-main'; button.textContent = entry.name;
    button.addEventListener('click', () => { activeScene = entry.id; selected = null; syncAudio(); renderUi(); });
    row.append(icon,button); $('scenes').append(row);
  });
  $('sources').replaceChildren();
  if (!current.sources.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Add a source to start creating.'; $('sources').append(empty); }
  [...current.sources].reverse().forEach(entry => {
    const row = document.createElement('div'); row.className = 'list-item' + (entry.id === selected ? ' active' : '');
    const icon = document.createElement('span'); icon.className = 'source-icon'; icon.textContent = ({ screen:'▣', camera:'◉', mic:'♫', image:'▧', text:'T' })[entry.type];
    const button = document.createElement('button'); button.className = 'item-main'; button.textContent = entry.name + (entry.ended ? ' (ended)' : ''); button.addEventListener('click', () => { selected = entry.id; renderUi(); });
    const toggle = document.createElement('button'); toggle.className = 'source-toggle'; toggle.textContent = entry.visible ? '◉' : '○'; toggle.setAttribute('aria-label', (entry.visible ? 'Hide ' : 'Show ') + entry.name);
    toggle.addEventListener('click', () => { entry.visible = !entry.visible; syncAudio(); renderUi(); });
    row.append(icon,button,toggle); $('sources').append(row);
  });
  for (const id of ['lower','raise','remove']) $(id).disabled = !item;
  $('properties').classList.toggle('hidden', !item); $('inspectorHint').classList.toggle('hidden', !!item);
  if (item) {
    $('sourceName').value = item.name; $('visible').checked = item.visible;
    $('visualSettings').classList.toggle('hidden', item.type === 'mic'); $('textSettings').classList.toggle('hidden', item.type !== 'text');
    $('fitSettings').classList.toggle('hidden', !['image','screen','camera'].includes(item.type));
    $('audioSettings').classList.toggle('hidden', !item.gainNode);
    if (item.type !== 'mic') for (const key of ['x','y','width','height']) $(key).value = Math.round(item[key]);
    if (item.type === 'text') { $('text').value = item.text; $('fontSize').value = item.fontSize; $('color').value = item.color; $('textBackdrop').checked=!!item.textBackdrop; }
    if (item.gainNode) { $('volume').value = Math.round(item.volume * 100); $('volumeValue').textContent = $('volume').value + '%'; }
  }
}
function createSource(type, name) {
  const isCamera = type === 'camera', isText = type === 'text';
  return { id:uid(), type, name, visible:true, x:isCamera ? 910 : isText ? 80 : 0, y:isCamera ? 500 : isText ? 80 : 0, width:isCamera ? 300 : isText ? 800 : 1280, height:isCamera ? 169 : isText ? 160 : 720, volume:1, text:'Your story starts here', fontSize:60, color:'#ffffff', textBackdrop:false, ended:false };
}
function fitSource(item,mode='contain'){
  const w=item?.image?.naturalWidth||item?.video?.videoWidth,h=item?.image?.naturalHeight||item?.video?.videoHeight;
  if(!w||!h)throw new Error('The source dimensions are not available yet.');
  const scale=mode==='cover'?Math.max(output.width/w,output.height/h):Math.min(output.width/w,output.height/h);
  item.width=w*scale;item.height=h*scale;item.x=(output.width-item.width)/2;item.y=(output.height-item.height)/2;renderUi();
}
async function addStream(type) {
  const target = scene();
  if (!navigator.mediaDevices || !window.isSecureContext) return status('Camera, microphone and screen capture require HTTPS or localhost.', true);
  if (type === 'screen' && !navigator.mediaDevices.getDisplayMedia) return status('Screen capture is not available in this browser on this device.', true);
  if (type !== 'screen' && !navigator.mediaDevices.getUserMedia) return status('This browser cannot access a camera or microphone.', true);
  let stream;
  try {
    const audioReady = ensureAudio(); audioReady.catch(() => {});
    stream = type === 'screen' ? await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true }) : await navigator.mediaDevices.getUserMedia(type === 'camera' ? { video:true, audio:false } : { audio:true, video:false });
    await audioReady;
    if (!scenes.includes(target)) { stream.getTracks().forEach(track => track.stop()); return; }
    const item = createSource(type, type === 'screen' ? 'Screen' : type === 'camera' ? 'Camera' : 'Microphone'); item.stream = stream;
    if (type !== 'mic') {
      item.video = document.createElement('video'); item.video.muted = true; item.video.playsInline = true; item.video.srcObject = stream;
      await item.video.play();
    }
    connectAudio(item); target.sources.push(item); if (target.id === activeScene) selected = item.id;
    for (const track of stream.getTracks()) track.addEventListener('ended', () => {
      if (track.kind === 'video' || type === 'mic') {
        item.ended = true; stream.getTracks().filter(other => other !== track).forEach(other => other.stop());
        syncAudio(); renderUi(); status(item.name + ' stopped sharing.');
      } else status(item.name + ' audio stopped; its video is still available.');
    });
    syncAudio(); renderUi();
    status(type === 'screen' && !stream.getAudioTracks().length ? 'Screen added. This browser did not provide screen audio.' : item.name + ' added to ' + target.name + '.');
  } catch (error) { if (stream) stream.getTracks().forEach(track => track.stop()); status('Could not add this source: ' + error.message, true); }
}
$('addScreen').addEventListener('click', () => addStream('screen'));
$('addCamera').addEventListener('click', () => addStream('camera'));
$('addMic').addEventListener('click', () => addStream('mic'));
$('addText').addEventListener('click', () => { const item = createSource('text','Text'); scene().sources.push(item); selected = item.id; renderUi(); status('Text added. Edit it in Source settings.'); });
function addImageFile(file) {
  if (!file) return;
  const target = scene(), url = URL.createObjectURL(file), image = new Image();
  image.onload = () => {
    if (!scenes.includes(target)) { URL.revokeObjectURL(url); return; }
    const item = createSource('image', file.name.slice(0,60)); item.image = image; item.url = url; fitSource(item);
    target.sources.push(item); if (target.id === activeScene) selected = item.id; renderUi(); status('Image added.');
  };
  image.onerror = () => { URL.revokeObjectURL(url); status('This image could not be opened.', true); }; image.src = url;
}
$('imageFile').addEventListener('change', event => { const file=event.target.files[0];event.target.value='';addImageFile(file); });
$('openSharedImage').addEventListener('click',async()=>{try{const file=await RoomShared.choose(['image/*']);if(file)addImageFile(file);}catch(error){status(error.message,true);}});
(async()=>{try{const file=await RoomShared.fromQuery();if(file)addImageFile(file);}catch(error){status(error.message,true);}})();
$('addScene').addEventListener('click', () => { const next = { id:uid(), name:'Scene ' + (scenes.length + 1), sources:[] }; scenes.push(next); activeScene = next.id; selected = null; syncAudio(); renderUi(); });
$('sceneName').addEventListener('change', () => { scene().name = $('sceneName').value.trim().slice(0,60) || 'Untitled scene'; renderUi(); });
$('deleteScene').addEventListener('click', () => {
  if (scenes.length <= 1) return; const old = scene(); old.sources.forEach(cleanup); scenes = scenes.filter(item => item.id !== old.id); activeScene = scenes[0].id; selected = null; syncAudio(); renderUi(); status('Scene and its sources removed.');
});
$('remove').addEventListener('click', () => { const item = source(); if (!item) return; cleanup(item); scene().sources = scene().sources.filter(entry => entry !== item); selected = null; renderUi(); });
$('raise').addEventListener('click', () => { const items = scene().sources, i = items.findIndex(entry => entry.id === selected); if (i >= 0 && i < items.length - 1) [items[i],items[i+1]] = [items[i+1],items[i]]; renderUi(); });
$('lower').addEventListener('click', () => { const items = scene().sources, i = items.findIndex(entry => entry.id === selected); if (i > 0) [items[i],items[i-1]] = [items[i-1],items[i]]; renderUi(); });
$('sourceName').addEventListener('change', () => { if (source()) { source().name = $('sourceName').value.trim().slice(0,60) || 'Source'; renderUi(); } });
$('visible').addEventListener('change', () => { if (source()) { source().visible = $('visible').checked; syncAudio(); renderUi(); } });
for (const key of ['x','y','width','height','fontSize']) $(key).addEventListener('change', () => {
  const item = source(), value = Number($(key).value); if (!item || !Number.isFinite(value)) return;
  item[key] = key === 'width' || key === 'height' ? clamp(value, 1, 3000) : key === 'fontSize' ? clamp(value, 8, 300) : clamp(value, -3000, 3000); renderUi();
});
for (const key of ['text','color']) $(key).addEventListener('change', () => { if (source()) { source()[key] = $(key).value.slice(0,500); renderUi(); } });
$('textBackdrop').addEventListener('change',()=>{if(source()?.type==='text')source().textBackdrop=$('textBackdrop').checked;});
for(const [id,mode] of [['fitFrame','contain'],['fillFrame','cover']])$(id).addEventListener('click',()=>{try{fitSource(source(),mode);status(mode==='contain'?'Source fitted to frame.':'Source fills the frame.');}catch(error){status(error.message,true);}});
$('volume').addEventListener('input', () => { if (source()) { source().volume = Number($('volume').value) / 100; $('volumeValue').textContent = $('volume').value + '%'; syncAudio(); } });
function wrapText(ctx,text,width){
  const lines=[];for(const paragraph of text.split('\n')){let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)){const joined=line?line+' '+word:word;if(ctx.measureText(joined).width<=width){line=joined;continue;}
      if(line){lines.push(line);line='';}for(const char of word){if(line&&ctx.measureText(line+char).width>width){lines.push(line);line='';}line+=char;}}
    lines.push(line);
  }return lines;
}
function drawFrame() {
  outputCtx.fillStyle = '#242032'; outputCtx.fillRect(0,0,output.width,output.height);
  const current = scene();
  for (const item of current.sources) {
    if (!item.visible || item.type === 'mic' || item.ended) continue;
    try {
      if ((item.type === 'screen' || item.type === 'camera') && item.video.readyState >= 2) outputCtx.drawImage(item.video, item.x, item.y, item.width, item.height);
      else if (item.type === 'image' && item.image.complete) outputCtx.drawImage(item.image, item.x, item.y, item.width, item.height);
      else if (item.type === 'text') {
        outputCtx.save();outputCtx.beginPath();outputCtx.rect(item.x,item.y,item.width,item.height);outputCtx.clip();outputCtx.font = '700 ' + item.fontSize + 'px system-ui, sans-serif'; outputCtx.textBaseline = 'top';
        const rgb=item.color.match(/[0-9a-f]{2}/ig).map(x=>parseInt(x,16)),light=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)>140;
        wrapText(outputCtx,item.text,item.width).forEach((line,index)=>{const y=item.y+index*item.fontSize*1.2;if(y>=item.y+item.height)return;
          if(item.textBackdrop&&line){outputCtx.fillStyle=light?'rgba(0,0,0,.72)':'rgba(255,255,255,.88)';outputCtx.fillRect(item.x,y,Math.min(item.width,outputCtx.measureText(line).width+12),item.fontSize*1.16);}
          outputCtx.fillStyle=item.color;outputCtx.fillText(line,item.x,y);});outputCtx.restore();
      }
    } catch {}
  }
  previewCtx.clearRect(0,0,preview.width,preview.height); previewCtx.drawImage(output,0,0);
  const item = source();
  if (item && item.type !== 'mic' && item.visible) { previewCtx.strokeStyle = '#b9a8ff'; previewCtx.lineWidth = 3; previewCtx.setLineDash([10,7]); previewCtx.strokeRect(item.x, item.y, item.width, item.height); previewCtx.setLineDash([]); }
}
function loop(now) { if (now - lastDraw >= 1000 / 30) { lastDraw = now; drawFrame(); if (recorder?.state === 'recording') $('timer').textContent = time((performance.now() - recordingStart) / 1000); } requestAnimationFrame(loop); }
requestAnimationFrame(loop);
function pos(event) { const rect = preview.getBoundingClientRect(); return { x:(event.clientX - rect.left) / rect.width * preview.width, y:(event.clientY - rect.top) / rect.height * preview.height }; }
preview.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return; const p = pos(event);
  const item = [...scene().sources].reverse().find(entry => entry.type !== 'mic' && entry.visible && p.x >= entry.x && p.x <= entry.x + entry.width && p.y >= entry.y && p.y <= entry.y + entry.height);
  selected = item?.id || null; renderUi(); if (item) { drag = { start:p, x:item.x, y:item.y, id:item.id }; preview.setPointerCapture(event.pointerId); }
});
preview.addEventListener('pointermove', event => { if (!drag) return; const item = source(); if (!item || item.id !== drag.id) return; const p = pos(event); item.x = clamp(drag.x + p.x - drag.start.x, -3000, 3000); item.y = clamp(drag.y + p.y - drag.start.y, -3000, 3000); $('x').value = Math.round(item.x); $('y').value = Math.round(item.y); });
preview.addEventListener('pointerup', () => { drag = null; }); preview.addEventListener('pointercancel', () => { drag = null; });
function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
function extension() { return recordingBlob?.type.startsWith('video/mp4') ? 'mp4' : 'webm'; }
function selectRecording(index) {
  const entry = recordings[index]; if (!entry) return;
  recordingBlob = entry.blob; recordingDuration = entry.duration;
  $('recordingPicker').value = String(index); $('openCliproom').classList.add('hidden');
  $('resultInfo').textContent = time(entry.duration) + ' · ' + (entry.blob.size / 1024 / 1024).toFixed(1) + ' MB · ' + entry.blob.type;
}
$('recordingPicker').addEventListener('change', () => selectRecording(Number($('recordingPicker').value)));
$('record').addEventListener('click', async () => {
  if (recorder && recorder.state === 'recording') { $('record').disabled = true; currentRecordingDuration = (performance.now() - recordingStart) / 1000; recorder.stop(); status('Finishing your recording…'); return; }
  if (!window.MediaRecorder || !output.captureStream) return status('Recording is not supported by this browser.', true);
  if (!scene().sources.some(item => item.visible && item.type !== 'mic' && !item.ended)) return status('Add a visible screen, camera, image or text source first.', true);
  try {
    await ensureAudio(); drawFrame(); canvasStream = output.captureStream(30);
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()]);
    const choices = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    const mime = choices.find(type => MediaRecorder.isTypeSupported(type));
    recorder = mime ? new MediaRecorder(stream, { mimeType:mime }) : new MediaRecorder(stream);
    chunks = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => status('The recording encountered an error.', true);
    recorder.onstop = async () => {
      canvasStream.getTracks().forEach(track => track.stop()); canvasStream = null;
      const type = (recorder.mimeType || 'video/webm').split(';')[0], duration=currentRecordingDuration || (performance.now()-recordingStart)/1000;let blob=new Blob(chunks,{type}),warning='';
      if(chunks.length&&type==='video/webm')try{blob=await RoomWebM.withDuration(blob,duration);}catch(error){warning=' Duration metadata could not be added; some editors may not import this recording.';}
      $('record').disabled = false; $('record').textContent = '●  Start recording'; $('recordState').textContent = 'READY TO CREATE'; $('recordState').classList.remove('recording');
      if (!chunks.length) return status('No video was recorded.', true);
      recordings.push({ blob, duration }); const option = document.createElement('option'); option.value = String(recordings.length - 1); option.textContent = 'Recording ' + recordings.length; $('recordingPicker').append(option); selectRecording(recordings.length - 1);
      $('result').classList.remove('hidden');
      status('Recording ready. Download it or send it to Cliproom.'+warning,!!warning);
    };
    currentRecordingDuration=0;recorder.start(1000); recordingStart = performance.now();
    $('record').textContent = '■  Stop recording'; $('recordState').textContent = 'RECORDING'; $('recordState').classList.add('recording'); status('Recording this scene. You can switch scenes while recording.');
  } catch (error) { if (canvasStream) canvasStream.getTracks().forEach(track => track.stop()); canvasStream = null; status('Could not start recording: ' + error.message, true); }
});
$('download').addEventListener('click', () => { if (recordingBlob) download(recordingBlob, 'captureroom-recording.' + extension()); });
$('saveSharedRecording').addEventListener('click',async()=>{if(!recordingBlob)return;try{const path=await RoomShared.save(recordingBlob,'captureroom-recording.'+extension());if(path)status('Saved to shared files: '+path);}catch(error){status(error.message,true);}});
$('send').addEventListener('click', async () => {
  if (!recordingBlob) return;
  const chosen = recordingBlob, duration = recordingDuration, filename = 'captureroom-recording.' + extension();
  $('send').disabled = true; $('recordingPicker').disabled = true;
  await RoomHandoff.send(chosen, filename, duration, $('status'), $('openCliproom'));
  if (chosen !== recordingBlob) { $('openCliproom').classList.add('hidden'); status('The earlier recording was sent. Select it and send again to open it in Cliproom.'); }
  $('recordingPicker').disabled = false; $('send').disabled = false;
});
window.addEventListener('beforeunload', event => { if (recorder?.state === 'recording' || recordingBlob || scenes.some(entry => entry.sources.length)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { scenes.forEach(entry => entry.sources.forEach(cleanup)); if (canvasStream) canvasStream.getTracks().forEach(track => track.stop()); });
renderUi();
