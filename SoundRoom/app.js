'use strict';
const $ = id => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const canvas = $('waveform'), ctx = canvas.getContext('2d');
let audioContext, buffer = null, title = 'audio', cursor = 0, selection = null, markers = [], undo = [];
let activeSource = null, animation = 0, playStart = 0, playOffset = 0, playEnd = 0, playSerial = 0;
let recorder = null, microphone = null, recordingChunks = [], pointerStart = null;
let renderBusy = false, soundRevision = 0, loadGeneration=0, gateCache = null, gatePending = null;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function invalidateLoudness() { soundRevision++;if(gateCache&&gateCache.input!==buffer)gateCache=null;$('loudnessResult').textContent='Measures processed mono/stereo audio up to 60 seconds.'; }
function context() { return audioContext || (audioContext = new (window.AudioContext || window.webkitAudioContext)()); }
function time(n) { n = Math.max(0, n || 0); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + (n % 60).toFixed(1).padStart(4, '0'); }
function safeName(value) { return (value || 'audio').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '-').slice(0, 80) || 'audio'; }
function settings() { const value=(id,fallback,min,max)=>clamp(Number.isFinite(Number($(id).value))&&$(id).value!==''?Number($(id).value):fallback,min,max);return {gain:value('gain',100,0,300)/100,fadeIn:value('fadeIn',0,0,600),fadeOut:value('fadeOut',0,0,600),normalizeTarget:value('normalizeTarget',-3,-24,0),eqLow:value('eqLow',0,-12,12),eqMid:value('eqMid',0,-12,12),eqHigh:value('eqHigh',0,-12,12),compressor:$('compressor').checked,threshold:value('threshold',-18,-60,0),ratio:value('ratio',4,1,20),noiseGate:$('noiseGate').checked,noiseThreshold:value('noiseThreshold',-45,-80,-10),noiseReduction:value('noiseReduction',24,0,36),limiter:$('limiter').checked,ceiling:value('ceiling',-1,-24,0)}; }
function setSettings(s){$('gain').value=String(s.gain*100);$('gainValue').textContent=$('gain').value+'%';for(const key of ['fadeIn','fadeOut','normalizeTarget','eqLow','eqMid','eqHigh','threshold','ratio','noiseThreshold','noiseReduction','ceiling'])$(key).value=String(s[key]);for(const key of ['compressor','noiseGate','limiter'])$(key).checked=s[key];}
const defaultSettings={gain:1,fadeIn:0,fadeOut:0,normalizeTarget:-3,eqLow:0,eqMid:0,eqHigh:0,compressor:false,threshold:-18,ratio:4,noiseGate:false,noiseThreshold:-45,noiseReduction:24,limiter:false,ceiling:-1};
function processingChain(ac,source,s){let node=source;for(const [key,type,frequency] of [['eqLow','lowshelf',120],['eqMid','peaking',1000],['eqHigh','highshelf',8000]]){if(!s[key])continue;const filter=ac.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.gain.value=s[key];if(type==='peaking')filter.Q.value=1;node.connect(filter);node=filter;}if(s.compressor){const compressor=ac.createDynamicsCompressor();compressor.threshold.value=s.threshold;compressor.ratio.value=s.ratio;compressor.knee.value=0;compressor.attack.value=.003;compressor.release.value=.25;node.connect(compressor);node=compressor;}return node;}
async function gatedBuffer(input,s){
  if(!s.noiseGate)return input;if(input.numberOfChannels>2||input.length*input.numberOfChannels>SoundNoiseGate.maxSamples)throw new Error('Noise gate supports mono/stereo audio with at most 6 million samples.');const key=s.noiseThreshold+':'+s.noiseReduction;if(gateCache?.input===input&&gateCache.key===key)return gateCache.output;if(gatePending){await gatePending.catch(()=>{});return gatedBuffer(input,s);}
  const job=(async()=>{const copies=Array.from({length:input.numberOfChannels},(_,i)=>new Float32Array(input.getChannelData(i)));let worker;try{worker=new Worker('noise-gate-worker.js');const channels=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Noise gate timed out.')),30000);worker.onmessage=event=>{clearTimeout(timer);event.data.error?reject(new Error(event.data.error)):resolve(event.data.channels);};worker.onerror=()=>{clearTimeout(timer);reject(new Error('The local noise gate could not start.'));};worker.postMessage({channels:copies,rate:input.sampleRate,threshold:s.noiseThreshold,reduction:s.noiseReduction},copies.map(channel=>channel.buffer));});const output=context().createBuffer(input.numberOfChannels,input.length,input.sampleRate);channels.forEach((channel,index)=>output.copyToChannel(channel,index));if(buffer===input)gateCache={input,key,output};return output;}finally{worker?.terminate();}})();gatePending=job;try{return await job;}finally{if(gatePending===job)gatePending=null;}
}
function limitPlayback(ac,node,s){if(!s.limiter){node.connect(ac.destination);return;}const ceiling=Math.pow(10,s.ceiling/20),shaper=ac.createWaveShaper(),curve=new Float32Array(32769);for(let i=0;i<curve.length;i++)curve[i]=clamp(i*2/(curve.length-1)-1,-ceiling,ceiling);shaper.curve=curve;node.connect(shaper);shaper.connect(ac.destination);}
function envelope(t, duration, s) {
  let factor = 1;
  if (s.fadeIn) factor = Math.min(factor, t / s.fadeIn);
  if (s.fadeOut) factor = Math.min(factor, (duration - t) / s.fadeOut);
  return s.gain * clamp(factor, 0, 1);
}
function remember() { undo.push({ buffer, cursor, selection: selection && [...selection], markers: [...markers] }); if (undo.length > 8) undo.shift(); }
function stop() {
  playSerial++; cancelAnimationFrame(animation);
  if (activeSource) { try { activeSource.stop(); } catch {} activeSource.disconnect(); activeSource = null; }
  $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play');
}
function render() {
  const has = !!buffer, duration = has ? buffer.duration : 0;
  $('trackName').textContent = has ? title : 'Your waveform';
  $('fileInfo').textContent = has ? buffer.numberOfChannels + ' CH · ' + Math.round(buffer.sampleRate / 1000) + ' KHZ' : 'NO AUDIO YET';
  $('duration').textContent = time(duration); $('position').textContent = time(cursor);
  for (const id of ['play','export','normalize','selectAll','selectionStart','selectionEnd','playhead','split','send','saveSharedAudio','saveProject','saveSharedProject','analyzeLoudness']) $(id).disabled = !has || (renderBusy && ['export','send','saveSharedAudio','saveProject','saveSharedProject','analyzeLoudness'].includes(id));
  $('undo').disabled = !undo.length; $('trim').disabled = !has || !selection; $('cut').disabled = !has || !selection;
  $('clearSelection').disabled = !selection; $('exportPart').disabled = !has || (!selection && !markers.length);
  $('selectionStart').max = duration; $('selectionEnd').max = duration; $('playhead').max = duration;
  $('selectionStart').value = (selection ? selection[0] : cursor).toFixed(2);
  $('selectionEnd').value = (selection ? selection[1] : cursor).toFixed(2);
  $('playhead').value = cursor.toFixed(2);
  $('rangeInfo').textContent = !has ? 'Open or record audio to begin.' : selection ? 'Selected ' + time(selection[0]) + ' – ' + time(selection[1]) + ' (' + time(selection[1] - selection[0]) + ')' : markers.length + (markers.length === 1 ? ' split point' : ' split points') + ' · Click or drag on the waveform.';
  draw();
}
function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#faf9fd'; ctx.fillRect(0, 0, w, h);
  if (!buffer) {
    ctx.fillStyle = '#c1b9d6'; ctx.font = 'bold 22px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Your audio will appear here', w / 2, h / 2); return;
  }
  const duration = buffer.duration, samples = buffer.getChannelData(0);
  if (selection) { ctx.fillStyle = '#e9e4ff'; ctx.fillRect(selection[0] / duration * w, 0, (selection[1] - selection[0]) / duration * w, h); }
  ctx.strokeStyle = '#8f79dd'; ctx.lineWidth = 1.5; ctx.beginPath();
  const stride = Math.max(1, Math.floor(samples.length / w));
  for (let x = 0; x < w; x++) {
    const from = Math.floor(x * samples.length / w), to = Math.min(samples.length, from + stride);
    let low = 0, high = 0;
    for (let i = from; i < to; i++) { low = Math.min(low, samples[i]); high = Math.max(high, samples[i]); }
    ctx.moveTo(x + .5, h / 2 - high * (h * .43)); ctx.lineTo(x + .5, h / 2 - low * (h * .43));
  }
  ctx.stroke();
  ctx.strokeStyle = '#e3a982'; ctx.setLineDash([5, 5]);
  for (const mark of markers) { const x = mark / duration * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = '#4c3da2'; ctx.lineWidth = 2;
  const x = cursor / duration * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
}
async function openBlob(blob, name) {
  const generation=++loadGeneration;
  try {
    status('Reading audio…'); stop();
    const data = await blob.arrayBuffer();
    const decoded = await context().decodeAudioData(data);
    if (!Number.isFinite(decoded.duration) || !decoded.length) throw new Error('This file has no audio.');if(generation!==loadGeneration)return;
    buffer = decoded; title = safeName(name); cursor = 0; selection = null; markers = []; undo = [];
    setSettings(defaultSettings);invalidateLoudness();
    $('openCliproom').classList.add('hidden'); status('Audio ready. Drag on the waveform to select a range.'); render();
  } catch (error) { if(generation===loadGeneration)status('Could not open this audio: ' + error.message, true); }
}
function selectedRange() { return selection || [0, buffer.duration]; }
function replaceWithRanges(ranges) {
  const sampleRate = buffer.sampleRate;
  const spans = ranges.map(([a, b]) => [Math.floor(a * sampleRate), Math.min(buffer.length, Math.floor(b * sampleRate))]).filter(([a,b]) => b > a);
  const length = spans.reduce((sum, [a,b]) => sum + b - a, 0);
  if (!length) { status('The selection would leave no audio.', true); return; }
  remember(); stop();
  const next = context().createBuffer(buffer.numberOfChannels, length, sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const out = next.getChannelData(channel), input = buffer.getChannelData(channel); let offset = 0;
    for (const [a,b] of spans) { out.set(input.subarray(a,b), offset); offset += b - a; }
  }
  buffer = next; cursor = 0; selection = null; markers = []; invalidateLoudness();render(); status('Edit applied. You can undo it.');
}
function partRange() {
  if (selection) return selection;
  const boundaries = [0, ...markers, buffer.duration];
  const index = boundaries.findIndex((n, i) => i < boundaries.length - 1 && cursor >= n && cursor < boundaries[i + 1]);
  return index >= 0 ? [boundaries[index], boundaries[index + 1]] : [boundaries[boundaries.length - 2], buffer.duration];
}
async function makeWav(range,processing=settings()) {
  const input=buffer,[start, end] = range, rate = input.sampleRate, channels = input.numberOfChannels;
  const first = Math.floor(start * rate), last = Math.min(input.length, Math.floor(end * rate)), frames = last - first;
  if (frames <= 0) throw new Error('Choose a longer selection.');
  const byteLength = 44 + frames * channels * 2;
  if (byteLength > 0x7fffffff) throw new Error('This audio is too large to export as one WAV.');
  const bytes = new ArrayBuffer(byteLength), view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  const s=SoundSession.settings(processing);let processed=await gatedBuffer(input,s);
  if(s.eqLow||s.eqMid||s.eqHigh||s.compressor){const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!Offline)throw new Error('Offline audio processing is unavailable in this browser.');const offline=new Offline(channels,input.length,rate),node=offline.createBufferSource();node.buffer=processed;processingChain(offline,node,s).connect(offline.destination);node.start();processed=await offline.startRendering();}
  const ceiling=s.limiter?Math.pow(10,s.ceiling/20):1;
  const source = Array.from({ length: channels }, (_, channel) => processed.getChannelData(channel)); let offset = 44;
  for (let i = 0; i < frames; i++) {
    const factor = envelope((first + i) / rate, input.duration, s);
    for (let channel = 0; channel < channels; channel++) {
      const sample = clamp(source[channel][first + i] * factor, -ceiling, ceiling);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
async function makeSourceWav(input){const channels=input.numberOfChannels,frames=input.length,rate=input.sampleRate,byteLength=44+frames*channels*4;if(byteLength>256*1024*1024)throw new Error('Editable handoff supports source audio up to 256 MiB. Export a WAV for larger audio.');const bytes=new ArrayBuffer(byteLength),view=new DataView(bytes),write=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};write(0,'RIFF');view.setUint32(4,byteLength-8,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,3,true);view.setUint16(22,channels,true);view.setUint32(24,rate,true);view.setUint32(28,rate*channels*4,true);view.setUint16(32,channels*4,true);view.setUint16(34,32,true);write(36,'data');view.setUint32(40,frames*channels*4,true);const samples=Array.from({length:channels},(_,i)=>input.getChannelData(i));let offset=44;for(let frame=0;frame<frames;frame++){for(let ch=0;ch<channels;ch++){const value=samples[ch][frame];if(!Number.isFinite(value)||Math.abs(value)>16)throw new Error('Audio contains an unsupported sample.');view.setFloat32(offset,value,true);offset+=4;}if(frame&&frame%1000000===0)await new Promise(resolve=>setTimeout(resolve,0));}return new Blob([bytes],{type:'audio/wav'});}
async function measureLoudness(){
  if(!buffer)throw new Error('Open audio before measuring loudness.');if(buffer.numberOfChannels>2)throw new Error('Loudness analysis supports mono or stereo audio.');if(buffer.duration<.4||buffer.duration>60)throw new Error('Loudness analysis supports audio from 0.4 to 60 seconds.');
  const wav=await makeWav([0,buffer.duration]),bytes=await wav.arrayBuffer(),view=new DataView(bytes);let peak=0;for(let i=44;i+1<view.byteLength;i+=2)peak=Math.max(peak,Math.abs(view.getInt16(i,true))/32768);
  let audio=await context().decodeAudioData(bytes);if(audio.sampleRate!==SoundLoudness.rate){const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext,frames=Math.min(SoundLoudness.maxFrames,Math.round(audio.duration*SoundLoudness.rate)),offline=new Offline(audio.numberOfChannels,frames,SoundLoudness.rate),source=offline.createBufferSource();source.buffer=audio;source.connect(offline.destination);source.start();audio=await offline.startRendering();}
  const analysis=SoundLoudness.measure(Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i)));return {...analysis,sample_peak_dbfs:peak?Math.round(20*Math.log10(peak)*100)/100:null,duration_seconds:audio.duration,note:'K-weighted gated estimate of the exported 16-bit WAV; sample peak is not true peak.'};
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function withRender(action){if(renderBusy)return;renderBusy=true;render();try{await action();}catch(error){status(error.message,true);}finally{renderBusy=false;render();}}
function sessionBlob(){return new Blob([SoundSession.encode(buffer,title,settings(),cursor,selection,markers)],{type:'application/json'});}
async function openSession(file){const generation=++loadGeneration;try{if(file.size>SoundSession.maxBytes)throw new Error('Session files must be 32 MiB or smaller.');status('Opening session…');const project=SoundSession.decode(await file.text()),next=context().createBuffer(project.channels,project.frames,project.sampleRate);for(let ch=0;ch<project.channels;ch++)next.copyToChannel(project.samples[ch],ch);if(generation!==loadGeneration)return;stop();buffer=next;title=project.title;cursor=project.cursor;selection=project.selection;markers=project.markers;undo=[];setSettings(project.processing);invalidateLoudness();$('openCliproom').classList.add('hidden');render();status('Editable session opened.');}catch(error){if(generation===loadGeneration)status('Could not open this session: '+error.message,true);}}
async function openHandoffSource(id,encoded){const generation=++loadGeneration;try{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||'')||typeof encoded!=='string'||encoded.length>4096)throw new Error('Invalid SoundRoom handoff.');let value;try{value=JSON.parse(encoded);}catch{throw new Error('Invalid SoundRoom processing settings.');}const processing=SoundSession.settings(value),metaResponse=await fetch('/api/assets/'+id+'/metadata'),meta=await metaResponse.json();if(!metaResponse.ok||!String(meta.type).startsWith('audio/')||!Number.isFinite(meta.size)||meta.size>256*1024*1024)throw new Error('The editable source audio is unavailable or too large.');const response=await fetch('/api/assets/'+id);if(!response.ok||Number(response.headers.get('content-length')||0)>256*1024*1024)throw new Error('The editable source audio is unavailable or too large.');const bytes=await response.arrayBuffer();if(bytes.byteLength>256*1024*1024)throw new Error('The editable source audio is too large.');const next=await context().decodeAudioData(bytes);if(!next.length||!Number.isFinite(next.duration))throw new Error('The editable source has no audio.');if(generation!==loadGeneration)return;stop();buffer=next;title=safeName(meta.name).replace(/-source$/,'');cursor=0;selection=null;markers=[];undo=[];setSettings(processing);invalidateLoudness();$('openCliproom').classList.add('hidden');render();status('Editable SoundRoom source opened. Changes can be sent back as a new clip.');}catch(error){if(generation===loadGeneration)status('Could not open the editable source: '+error.message,true);}}
$('audioFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) openBlob(file, file.name); event.target.value = ''; });
$('projectFile').addEventListener('change',event=>{const file=event.target.files[0];if(file)openSession(file);event.target.value='';});
$('openSharedProject').addEventListener('click',async()=>{try{const path=await RoomShared.choosePath(['.soundroom']);if(path)await openSession(await RoomShared.get(path,{maxBytes:SoundSession.maxBytes}));}catch(error){status(error.message,true);}});
$('saveProject').addEventListener('click',()=>withRender(async()=>{status('Preparing editable session…');await new Promise(resolve=>setTimeout(resolve,20));download(sessionBlob(),title+'.soundroom');status('Editable session saved.');}));
$('saveSharedProject').addEventListener('click',()=>withRender(async()=>{status('Preparing editable session…');await new Promise(resolve=>setTimeout(resolve,20));const path=await RoomShared.save(sessionBlob(),title+'.soundroom');if(path)status('Session saved to shared files: '+path);}));
$('record').addEventListener('click', async () => {
  if (recorder && recorder.state !== 'inactive') { recorder.stop(); $('record').disabled = true; status('Finishing recording…'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return status('Microphone recording is unavailable in this browser or without HTTPS.', true);
  try {
    stop(); microphone = await navigator.mediaDevices.getUserMedia({ audio: true }); recordingChunks = [];
    recorder = new MediaRecorder(microphone); recorder.ondataavailable = event => { if (event.data.size) recordingChunks.push(event.data); };
    recorder.onerror = () => status('The microphone recording failed.', true);
    recorder.onstop = async () => {
      microphone.getTracks().forEach(track => track.stop()); microphone = null;
      $('record').disabled = false; $('record').textContent = '●  Record microphone';
      if (recordingChunks.length) await openBlob(new Blob(recordingChunks, { type: recorder.mimeType }), 'microphone recording');
      else status('No audio was recorded.', true);
    };
    recorder.start(1000); $('record').textContent = '■  Stop recording'; status('Recording your microphone…');
  } catch (error) { if (microphone) microphone.getTracks().forEach(track => track.stop()); microphone = null; status('Could not start the microphone: ' + error.message, true); }
});
canvas.addEventListener('pointerdown', event => {
  if (!buffer || event.button !== 0) return;
  stop(); const r = canvas.getBoundingClientRect(); pointerStart = clamp((event.clientX - r.left) / r.width, 0, 1) * buffer.duration;
  cursor = pointerStart; selection = null; canvas.setPointerCapture(event.pointerId); render();
});
canvas.addEventListener('pointermove', event => {
  if (pointerStart === null || !buffer) return; const r = canvas.getBoundingClientRect();
  const end = clamp((event.clientX - r.left) / r.width, 0, 1) * buffer.duration;
  selection = Math.abs(end - pointerStart) > .01 ? [Math.min(pointerStart, end), Math.max(pointerStart, end)] : null; cursor = end; render();
});
canvas.addEventListener('pointerup', () => { pointerStart = null; });
canvas.addEventListener('pointercancel', () => { pointerStart = null; });
for (const id of ['selectionStart','selectionEnd']) $(id).addEventListener('change', () => {
  if (!buffer) return; stop();
  const a = clamp(Number($('selectionStart').value) || 0, 0, buffer.duration), b = clamp(Number($('selectionEnd').value) || 0, 0, buffer.duration);
  selection = Math.abs(a - b) > .001 ? [Math.min(a,b), Math.max(a,b)] : null; cursor = Math.min(a,b); render();
});
$('playhead').addEventListener('change', () => { if (!buffer) return; stop(); cursor = clamp(Number($('playhead').value) || 0, 0, buffer.duration); render(); });
$('selectAll').addEventListener('click', () => { stop(); selection = [0, buffer.duration]; cursor = 0; render(); });
$('clearSelection').addEventListener('click', () => { stop(); selection = null; render(); });
$('trim').addEventListener('click', () => { if (selection) replaceWithRanges([selection]); });
$('cut').addEventListener('click', () => { if (selection) replaceWithRanges([[0, selection[0]], [selection[1], buffer.duration]]); });
$('split').addEventListener('click', () => {
  if (cursor <= 0 || cursor >= buffer.duration || markers.some(mark => Math.abs(mark - cursor) < .01)) return status('Place the playhead inside the audio, away from an existing split.', true);
  remember(); markers.push(cursor); markers.sort((a,b) => a - b); selection = null; render(); status('Split added. Place the playhead in a part to export it.');
});
$('undo').addEventListener('click', () => { if (!undo.length) return; stop(); ({ buffer, cursor, selection, markers } = undo.pop()); invalidateLoudness();render(); status('Edit undone.'); });
$('gain').addEventListener('input', () => { $('gainValue').textContent = $('gain').value + '%';invalidateLoudness(); if (activeSource) stop(); });
for (const id of ['fadeIn','fadeOut','eqLow','eqMid','eqHigh','compressor','threshold','ratio','noiseGate','noiseThreshold','noiseReduction','limiter','ceiling']) $(id).addEventListener('change',()=>{stop();invalidateLoudness();});
$('analyzeLoudness').addEventListener('click',()=>withRender(async()=>{status('Analyzing the processed WAV…');await new Promise(resolve=>setTimeout(resolve,20));const revision=soundRevision,result=await measureLoudness();if(revision!==soundRevision){status('Audio changed during analysis; run it again.');return;}$('loudnessResult').textContent=(result.integrated_lufs===null?'Below the loudness gate':result.integrated_lufs.toFixed(2)+' LUFS integrated')+' · '+(result.sample_peak_dbfs===null?'silent':result.sample_peak_dbfs.toFixed(2)+' dBFS sample peak')+'. This is not a true-peak measurement.';status('Loudness analysis complete.');}));
$('normalize').addEventListener('click', () => {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const sample of buffer.getChannelData(ch)) peak = Math.max(peak, Math.abs(sample));
  if (peak < .000001) return status('This audio is silent, so there is nothing to normalize.', true);
  const target=clamp(Number($('normalizeTarget').value)||0,-24,0),wanted=Math.pow(10,target/20)/peak,gain=Math.floor(Math.min(3,wanted)*100+1e-9);
  $('normalizeTarget').value=String(target);$('gain').value=String(gain);$('gain').dispatchEvent(new Event('input'));status(wanted>3?'Volume reached the 300% limit; the target peak may not be reached.':'Volume set for a peak at or below '+target+' dBFS.');
});
$('play').addEventListener('click', async () => {
  if (activeSource) { stop(); return; }
  if (!buffer) return;
  try {
    const input=buffer,s=settings(),serial=++playSerial,revision=soundRevision,[a,b]=selection||[cursor>=input.duration?0:cursor,input.duration];if(b<=a)return;await context().resume();if(s.noiseGate)status('Preparing the local noise gate…');const prepared=await gatedBuffer(input,s);if(serial!==playSerial||revision!==soundRevision||buffer!==input)return;
    const source = context().createBufferSource(), gain = context().createGain(), now = context().currentTime;
    source.buffer = prepared; processingChain(context(),source,s).connect(gain); limitPlayback(context(),gain,s);
    const points = [a, s.fadeIn, input.duration - s.fadeOut, input.duration * s.fadeIn / (s.fadeIn + s.fadeOut || 1), b].filter(t => t >= a && t <= b).sort((x,y) => x-y);
    gain.gain.setValueAtTime(envelope(a, input.duration, s), now);
    for (const t of points) if (t > a) gain.gain.linearRampToValueAtTime(envelope(t, input.duration, s), now + t - a);
    activeSource = source; playOffset = a; playStart = now; playEnd = b; cursor = a;
    source.onended = () => { if (serial === playSerial) { cursor = playEnd; stop(); render(); } };
    source.start(now, a, b - a); $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pause');
    const tick = () => { if (serial !== playSerial) return; cursor = Math.min(playEnd, playOffset + context().currentTime - playStart); $('position').textContent = time(cursor); draw(); animation = requestAnimationFrame(tick); }; tick();
  } catch (error) { stop(); status('Playback failed: ' + error.message, true); }
});
$('export').addEventListener('click', () => withRender(async()=>{const name=title+'.wav',range=[0,buffer.duration];status('Preparing WAV…');download(await makeWav(range),name);status('WAV exported.');}));
$('exportPart').addEventListener('click', () => withRender(async()=>{const name=title+'-part.wav',range=partRange();status('Preparing WAV…');download(await makeWav(range),name);status('Current part exported.');}));
$('openSharedAudio').addEventListener('click',async()=>{try{const file=await RoomShared.choose(['audio/*']);if(file)await openBlob(file,file.name);}catch(error){status(error.message,true);}});
$('saveSharedAudio').addEventListener('click',()=>withRender(async()=>{const name=title+'.wav',range=[0,buffer.duration];status('Preparing WAV…');const path=await RoomShared.save(await makeWav(range),name);if(path)status('Saved to shared files: '+path);}));
(async()=>{try{const params=new URLSearchParams(location.search),source=params.get('source_asset'),processing=params.get('processing');if(source||processing){history.replaceState(null,'',location.pathname);await openHandoffSource(source,processing);return;}const requested=params.get('shared_file')||'',file=await RoomShared.fromQuery(requested.toLowerCase().endsWith('.soundroom')?{maxBytes:SoundSession.maxBytes}:{});if(file){if(file.name.toLowerCase().endsWith('.soundroom'))await openSession(file);else await openBlob(file,file.name);}}catch(error){status(error.message,true);}})();
$('send').addEventListener('click', () => withRender(async()=>{const input=buffer,name=title+'.wav',duration=input.duration,processing=SoundSession.settings(settings()),revision=soundRevision;status('Preparing editable source and processed WAV…');await new Promise(resolve=>setTimeout(resolve,20));const source=await makeSourceWav(input),wav=await makeWav([0,duration],processing);if(buffer!==input||soundRevision!==revision)throw new Error('Audio or processing changed while preparing the handoff. Try again.');await RoomHandoff.send(wav,name,duration,$('status'),$('openCliproom'),{source,sourceName:title+'-source.wav',processing,...(window.SoundRoomHandoffIds||{})});}));
window.addEventListener('beforeunload', event => { if (buffer || recorder?.state === 'recording') { event.preventDefault(); event.returnValue = ''; } });
render();
