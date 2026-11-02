'use strict';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const uid = () => crypto.randomUUID();
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const number = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const seconds = n => { n = Math.max(0, number(n)); const mins = Math.floor(n / 60); return `${String(mins).padStart(2, '0')}:${(n % 60).toFixed(1).padStart(4, '0')}`; };
const niceSize = n => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
const T = window.ClipTimeline;
const TITLE_FONTS = [
  { id:'sans-serif', label:'Sans serif', family:'sans-serif' },
  { id:'serif', label:'Serif', family:'Georgia, serif' },
  { id:'monospace', label:'Monospace', family:'monospace' },
  { id:'arial', label:'Arial', family:'Arial, "Liberation Sans", sans-serif' },
  { id:'verdana', label:'Verdana', family:'Verdana, "DejaVu Sans", sans-serif' },
  { id:'trebuchet', label:'Trebuchet MS', family:'"Trebuchet MS", "Liberation Sans", sans-serif' },
  { id:'georgia', label:'Georgia', family:'Georgia, "DejaVu Serif", serif' },
  { id:'times', label:'Times New Roman', family:'"Times New Roman", "Liberation Serif", serif' },
  { id:'courier', label:'Courier New', family:'"Courier New", "Liberation Mono", monospace' },
  { id:'impact', label:'Impact', family:'Impact, "DejaVu Sans Condensed", sans-serif' },
  { id:'cursive', label:'Cursive', family:'cursive' }
];
const emptyState = () => T.empty(uid);
let state = emptyState(), projectId = uid(), revision = 0, dirty = false, selected = null;
let videoTarget = state.videoTracks[0].id, audioTarget = state.audioTracks[0].id;
let timelineZoom = 1, stageDrag = null, keyframeClipId = null, keyframeIndex = 0;
const audioGesture = T.createAudioClickGesture({ onCut:cutAudio, onOptions:(clipId, time) => selectAudio(clipId, time, true) });
let undoStack = [], redoStack = [], currentTime = 0, playing = false, playClock = 0, frameId = 0, lastDrawTime = 0, playbackGeneration = 0;
let audioContext = null, outputAudio = null, silentAudio = null, activeMedia = new Set(), recorder = null, recording = false, exportPreparing = false, cancelRecording = false, exportGeneration = 0;
let exportFailure = '', exportWarning = '', realtimeRenderedFrames = 0, realtimeCaptureTrack = null, offlineExportAbort = null;
let saveInProgress = false, mediaBusy = false, statusTimer = 0;
let exportToShared = false, gradeCompare = 'off', gradeBefore = null;
let fastColorPreview=false;try{fastColorPreview=localStorage.getItem('cliproom.fastColorPreview')==='1';}catch{}
const elements = new Map(), images = new Map();
const gradeMaskImages = new Map(),gradeMaskWarnings=new Set();let pendingClipMask=null;
const waveforms = new Map(), waveformErrors = new Map();
let showWaveforms = false, waveformBusy = false;
let useProxyPreview=false,proxyBusy=false,proxyAbort=null,proxyCheckToken=0;
const proxyStatuses=new Map();
const canvas = $('canvas'), context = canvas.getContext('2d');

function notify(message, delay = 4000) {
  $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(statusTimer);
  statusTimer = setTimeout(() => $('toast').classList.remove('show'), delay);
}
async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.method && options.method !== 'GET') headers.set('X-Cliproom-Request', '1');
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status}).`), { status: response.status });
  return body;
}
function totalDuration() { return T.duration(state); }
function asset(id) { return state.assets.find(item => item.id === id); }
function selectedItem() {
  if (!selected) return null;
  if (selected.type === 'clip') return state.clips.find(c => c.id === selected.id);
  if (selected.type === 'title') return state.titles.find(t => t.id === selected.id);
  if (selected.type === 'audio') return state.audioClips.find(c => c.id === selected.id);
  return null;
}
function cancelAudioClick() {
  audioGesture.cancel();
}
function commitPrevious(before) {
  if (state.version < 5 && T.requiresV5(state)) state.version = 5;
  if (JSON.stringify(state) === before) return;
  undoStack.push(JSON.parse(before)); if (undoStack.length > 80) undoStack.shift(); redoStack = []; dirty = true;
  if (selected && !selectedItem()) selected = null;
  currentTime = clamp(currentTime, 0, totalDuration());
  stopPlayback(); render();
}
function change(fn) {
  if (recording || exportPreparing) return;
  cancelAudioClick();
  const before = JSON.stringify(state);
  fn(); commitPrevious(before);
}
function applyHistory(direction) {
  if (recording || exportPreparing) return;
  cancelAudioClick();
  const from = direction === 'undo' ? undoStack : redoStack, to = direction === 'undo' ? redoStack : undoStack;
  if (!from.length) return;
  to.push(clone(state)); state = from.pop(); selected = null; dirty = true; stopPlayback(); currentTime = clamp(currentTime, 0, totalDuration()); render();
}
function render() {
  const usedMasks=new Set(state.clips.map(clip=>clip.gradeMask?.image).filter(Boolean));for(const key of gradeMaskImages.keys())if(!usedMasks.has(key))gradeMaskImages.delete(key);
  $('projectName').value = state.name;
  $('undoBtn').disabled = !undoStack.length; $('redoBtn').disabled = !redoStack.length;
  $('assetCount').textContent = state.assets.length;
  $('stageEmpty').classList.toggle('hidden', totalDuration() > 0);
  $('ratioBadge').textContent = `${state.aspect} · ${state.quality}`;
  $('playBtn').disabled = !totalDuration();
  $('exportBtn').disabled = !totalDuration();
  $('addTitleBtn').disabled = !totalDuration();
  $('splitBtn').disabled = !selected || !['clip', 'audio'].includes(selected.type);
  $('duplicateBtn').disabled = !selected;
  $('removeBtn').disabled = !selected;
  if (!state.videoTracks.some(t => t.id === videoTarget)) videoTarget = state.videoTracks[0].id;
  if (!state.audioTracks.some(t => t.id === audioTarget)) audioTarget = state.audioTracks[0].id;
  $('videoTarget').innerHTML = state.videoTracks.map(t => option(t.id, escapeHTML(t.name), videoTarget)).join('');
  $('audioTarget').innerHTML = state.audioTracks.map(t => option(t.id, escapeHTML(t.name), audioTarget)).join('');
  const selectedAudio = selected?.type === 'audio' ? selected.id : '';
  $('audioOptionsPicker').classList.toggle('hidden', !state.audioClips.length);
  $('audioOptionsSelect').innerHTML = option('', 'Select a clip…', selectedAudio) + [...state.audioClips].sort(T.order).map(clip => {
    const name = asset(clip.assetId)?.name || 'Missing media', track = state.audioTracks.find(t => t.id === clip.trackId)?.name || 'Audio';
    return option(clip.id, escapeHTML(`${name} · ${track} · ${seconds(clip.start)}`), selectedAudio);
  }).join('');
  pruneMedia(); renderMedia(); renderInspector(); renderTimeline(); setCanvasSize(); syncMedia(true); renderFrame(); updateTime();
  if(showWaveforms)queueMicrotask(buildWaveforms);
}
async function buildWaveforms(){
  if(!showWaveforms||waveformBusy)return;
  const pending=[...new Set([...state.audioClips,...state.clips].map(clip=>clip.assetId))].map(asset).filter(item=>['audio','video'].includes(item?.kind)&&!waveforms.has(item.id)&&!waveformErrors.has(item.id));
  if(!pending.length)return;
  const Constructor=window.AudioContext||window.webkitAudioContext;
  if(!Constructor){for(const item of pending)waveformErrors.set(item.id,'Audio decoding is unavailable.');notify('This browser cannot decode audio waveforms.');return;}
  waveformBusy=true;notify('Preparing short audio waveforms locally…',10000);let decoder;
  try{
    decoder=new Constructor();
    for(const item of pending){
      if(!showWaveforms)break;
      try{
        if(!Number.isFinite(item.duration)||item.duration>RoomWaveform.maxSeconds||!Number.isFinite(item.size)||item.size>RoomWaveform.maxBytes)throw new Error('Waveforms support media up to 3 minutes and 20 MiB.');
        const bytes=await RoomWaveform.readResponse(await fetch('/api/assets/'+encodeURIComponent(item.id)));
        const url=URL.createObjectURL(new Blob([bytes],{type:item.type})),probe=document.createElement(item.kind==='video'?'video':'audio');probe.preload='metadata';probe.src=url;
        try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Media metadata timed out.')),20000);probe.onloadedmetadata=()=>{clearTimeout(timer);resolve();};probe.onerror=()=>{clearTimeout(timer);reject(new Error('Media metadata is unavailable.'));};});if(!Number.isFinite(probe.duration)||probe.duration>RoomWaveform.maxSeconds)throw new Error('Media exceeds the waveform duration limit.');}finally{probe.removeAttribute('src');probe.load();URL.revokeObjectURL(url);}
        let audio;try{audio=await decoder.decodeAudioData(bytes);}catch{throw new Error('No decodable audio track is available in this browser.');}if(audio.duration>RoomWaveform.maxSeconds||audio.numberOfChannels>8)throw new Error('Audio exceeds the waveform duration or channel limit.');
        waveforms.set(item.id,{duration:audio.duration,peaks:RoomWaveform.peaks(Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i)))});
      }catch(error){waveformErrors.set(item.id,error.message||'Waveform unavailable.');}
      if(showWaveforms)renderTimeline();
    }
  }catch(error){for(const item of pending)if(!waveforms.has(item.id)&&!waveformErrors.has(item.id))waveformErrors.set(item.id,error.message||'Waveform unavailable.');}finally{
    if(decoder)await decoder.close().catch(()=>{});waveformBusy=false;
    if(showWaveforms){const unavailable=pending.filter(item=>waveformErrors.has(item.id)).length;notify(unavailable?`Some waveforms could not be shown (${unavailable}). Media needs decodable audio and must be no longer than 3 minutes or 20 MiB.`:'Audio waveforms are ready.',6000);queueMicrotask(buildWaveforms);}
  }
}
function drawWaveform(clip){
  const data=waveforms.get(clip.assetId);if(!data)return null;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=26;canvas.className='audio-waveform';canvas.setAttribute('aria-hidden','true');
  const ctx=canvas.getContext('2d');ctx.strokeStyle='#a66f52';ctx.lineWidth=1;ctx.beginPath();
  RoomWaveform.segment(data.peaks,data.duration,clip.in,clip.out,256).forEach((peak,x)=>{const height=Math.max(.5,peak*11);ctx.moveTo(x,13-height);ctx.lineTo(x,13+height);});ctx.stroke();return canvas;
}
function renderMedia() {
  const root = $('mediaList'); root.replaceChildren();
  if (!state.assets.length) { root.innerHTML = '<div class="empty-library"><span>✦</span><p>Your media will be here,<br>ready when you are.</p></div>'; return; }
  for (const item of state.assets) {
    const el = document.createElement('div'); el.className = 'media-item';
    const icon = item.kind === 'audio' ? 'music' : 'film';
    el.innerHTML = `<span class="media-icon ${item.kind === 'audio' ? 'audio' : ''}"><svg><use href="#i-${icon}"/></svg></span><div class="media-details"><strong title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</strong><small>${item.kind === 'image' ? 'Photo' : seconds(item.duration)} · ${niceSize(item.size)}</small></div><button class="media-add" aria-label="Add ${escapeHTML(item.name)} to timeline" title="Add to timeline">+</button>`;
    el.querySelector('button').addEventListener('click', () => addMedia(item.id)); root.append(el);
  }
}
function renderProxyList(){const root=$('proxyList');root.replaceChildren();const videos=state.assets.filter(item=>item.kind==='video');if(!videos.length){const message=document.createElement('p');message.className='mini-hint';message.textContent='Add a video to the project to create an optimized preview.';root.append(message);return;}for(const item of videos){const row=document.createElement('div'),label=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small'),button=document.createElement('button'),status=proxyStatuses.get(item.id);row.className='project-item';name.textContent=item.name;detail.textContent=!status?'Checking…':status.error?'Status unavailable':status.broken?'Preview unavailable · remove or recreate':status.exists?'Ready · '+niceSize(status.bytes||0):'No optimized preview';label.append(name,detail);button.className='tiny-button';button.type='button';button.disabled=proxyBusy||!status;button.textContent=status?.error?'Retry':status?.exists?'Remove':'Create';button.setAttribute('aria-label',(status?.error?'Retry checking ':status?.exists?'Remove optimized preview for ':'Create optimized preview for ')+item.name);button.onclick=()=>{if(status?.error)void refreshProxyStatuses();else if(status?.exists)void removeProxy(item.id);else void makeProxy(item.id);};row.append(label,button);root.append(row);}}
async function refreshProxyStatuses(){const token=++proxyCheckToken,ids=[...new Set(state.assets.filter(item=>item.kind==='video').map(item=>item.id))];for(const id of ids)proxyStatuses.delete(id);renderProxyList();let next=0;async function worker(){while(next<ids.length){const id=ids[next++];try{const value=await request('/api/proxies/'+encodeURIComponent(id)+'/status');if(token===proxyCheckToken)proxyStatuses.set(id,value);}catch(error){if(token===proxyCheckToken)proxyStatuses.set(id,{error:error.message});}if(token===proxyCheckToken)renderProxyList();}}await Promise.all(Array.from({length:Math.min(6,ids.length)},worker));if(token===proxyCheckToken&&useProxyPreview&&!recording&&!exportPreparing)refreshPreviewSources();}
async function makeProxy(id){if(proxyBusy||recording||exportPreparing)return;proxyCheckToken++;proxyBusy=true;proxyAbort=new AbortController();$('cancelProxy').hidden=false;$('proxyStatus').textContent='Preparing optimized preview…';renderProxyList();try{const {createProxy}=await import('/proxy.js'),result=await createProxy(id,{signal:proxyAbort.signal,onProgress:value=>{$('proxyStatus').textContent='Creating optimized preview · '+Math.round(value*100)+'%';}});proxyStatuses.set(id,result);$('proxyStatus').textContent=result.already_exists?'An optimized preview is already available.':'Optimized preview ready. Exports still use the original.';if(useProxyPreview&&!recording&&!exportPreparing)refreshPreviewSources();}catch(error){$('proxyStatus').textContent=proxyAbort.signal.aborted?'Optimized preview cancelled.':error.message;}finally{proxyBusy=false;proxyAbort=null;$('cancelProxy').hidden=true;renderProxyList();void refreshProxyStatuses();}}
async function removeProxy(id){if(proxyBusy||recording||exportPreparing)return;proxyCheckToken++;proxyBusy=true;const previous=proxyStatuses.get(id);proxyStatuses.set(id,{exists:false});refreshPreviewSources();renderProxyList();try{await request('/api/proxies/'+encodeURIComponent(id),{method:'DELETE'});$('proxyStatus').textContent='Optimized preview removed. The original is unchanged.';}catch(error){proxyStatuses.set(id,previous);$('proxyStatus').textContent=error.message;}finally{proxyBusy=false;renderProxyList();void refreshProxyStatuses();}}
$('proxyBtn').addEventListener('click',()=>{if(recording||exportPreparing)return;showProxyDialog();});
function showProxyDialog(){$('proxyStatus').textContent='';$('useProxyPreview').checked=useProxyPreview;if(!$('proxyDialog').open)$('proxyDialog').showModal();void refreshProxyStatuses();}
$('useProxyPreview').addEventListener('change',event=>{useProxyPreview=event.target.checked;refreshPreviewSources();});
$('cancelProxy').addEventListener('click',()=>proxyAbort?.abort());$('proxyDialog').addEventListener('close',()=>proxyAbort?.abort());
function field(label, id, value, extra = '') { return `<label class="field"><span>${label}</span><input id="${id}" ${extra} value="${escapeHTML(value)}"></label>`; }
function option(value, label, current) { return `<option value="${escapeHTML(value)}" ${value === current ? 'selected' : ''}>${label}</option>`; }
function slider(label, id, value, min, max, disabled = false) {
  return `<label class="field"><span>${label} · ${value}%</span><input id="${id}" type="range" min="${min}" max="${max}" step="${id === 'titleSize' ? '.1' : '1'}" value="${value}" ${disabled ? 'disabled' : ''}></label>`;
}
function keyframePanel(item, isVideo) {
  const frames = Array.isArray(item.keyframes) ? item.keyframes : [];
  if (keyframeClipId !== item.id) { keyframeClipId = item.id; keyframeIndex = 0; }
  keyframeIndex = clamp(keyframeIndex, 0, Math.max(0, frames.length - 1));
  const frame = frames[keyframeIndex];
  const defaults = { scale:1, x:50, y:50, opacity:1, rotation:0, brightness:100, contrast:100, saturation:100, volume:1 };
  const atFrame = frame ? T.animatedValues({ ...item, start:0, in:0, out:Math.max(number(item.out), number(frame.time), .001), rate:1 }, number(frame.time)) : defaults;
  const value = key => number(frame?.[key], number(atFrame[key], number(item[key], defaults[key])));
  const choices = frames.map((entry, index) => option(String(index), 'Source ' + number(entry.time).toFixed(2) + 's', String(keyframeIndex))).join('');
  let html = '<div class="section-label inspector-section"><span>KEYFRAMES</span></div>' +
    '<p class="mini-hint">Move the playhead inside this clip, then add a keyframe. Values interpolate between points and follow the source when trimmed or retimed.</p>' +
    '<button class="tiny-button wide-tiny" id="addKeyframeBtn">＋ Add or select at playhead</button>';
  if (!frame) return html + '<p class="mini-hint">No keyframes yet.</p>';
  html += '<label class="field"><span>Keyframe</span><select id="keyframeSelect">' + choices + '</select></label>' +
    '<div class="field-row">' + field('Source time (sec)','keyframeTime',number(frame.time).toFixed(2),'type="number" min="0" step="0.01"') + field('Volume %','keyframeVolume',Math.round(value('volume') * 100),'type="number" min="0" max="100" step="1"') + '</div>';
  if (isVideo) html +=
    '<div class="field-row">' + field('Scale %','keyframeScale',Math.round(value('scale') * 100),'type="number" min="10" max="200" step="1"') + field('Opacity %','keyframeOpacity',Math.round(value('opacity') * 100),'type="number" min="0" max="100" step="1"') + '</div>' +
    '<div class="field-row">' + field('Horizontal %','keyframeX',Math.round(value('x')),'type="number" min="-100" max="200" step="1"') + field('Vertical %','keyframeY',Math.round(value('y')),'type="number" min="-100" max="200" step="1"') + '</div>' +
    field('Rotation (°)','keyframeRotation',value('rotation').toFixed(1),'type="number" step="1"') +
    '<div class="field-row">' + field('Brightness %','keyframeBrightness',Math.round(value('brightness')),'type="number" min="0" max="200" step="1"') + field('Contrast %','keyframeContrast',Math.round(value('contrast')),'type="number" min="0" max="200" step="1"') + '</div>' +
    field('Saturation %','keyframeSaturation',Math.round(value('saturation')),'type="number" min="0" max="200" step="1"') +
    '<details class="grade-keyframes"><summary>Advanced color keyframes</summary>' + RoomGrade.advanced.map(key=>field(key==='exposure_ev'?'Exposure (EV)':key[0].toUpperCase()+key.slice(1),'keyframeGrade_'+key,value(key),`type="number" min="${RoomGrade.specs[key][0]}" max="${RoomGrade.specs[key][1]}" step="${key==='exposure_ev'?'.1':'1'}"`)).join('') + Object.entries(RoomGrade.Look.effectSpecs).map(([key,range])=>field(key[0].toUpperCase()+key.slice(1),'keyframeEffect_'+key,value(key),`type="number" min="${range[0]}" max="${range[1]}" step="1"`)).join('') + '<p class="mini-hint">Capture the current curves, hue ranges and wheels at this keyframe. Capture an earlier look before changing the clip controls. LUTs stay fixed on the clip.</p><button class="tiny-button wide-tiny" id="captureCreativeKeyframe">Capture current creative look</button>'+(frame.creativeLook?'<button class="tiny-button wide-tiny" id="clearCreativeKeyframe">Clear captured creative look</button><p class="mini-hint">Creative look captured at this keyframe.</p>':'')+'</details>';
  return html + '<div class="keyframe-actions"><button class="tiny-button" id="gotoKeyframeBtn">Go to keyframe</button><button class="tiny-button danger" id="deleteKeyframeBtn">Delete keyframe</button></div>' +
    '<p class="mini-hint">These values apply to this keyframe. The clip controls above set the base values.</p>';
}
function gradeFitsProject(clips, grade) {
  const encoder=new TextEncoder(),size=value=>encoder.encode(JSON.stringify(value)).length;
  let bytes=size({baseRevision:revision,state});
  for(const clip of clips){const candidate={...clip};RoomGrade.writeTarget(candidate,'clip',grade.adjustments,grade.strength,grade.enabled,grade.look);bytes+=size(candidate)-size(clip);}
  return bytes<=2*1024*1024;
}
function renderInspector() {
  RoomGradeUI.capture($('clipGradePanel'));
  const root = $('inspectorBody'), item = selectedItem();
  if (!item) {
    $('inspectorTitle').innerHTML = 'Project<span class="purple">.</span>';
    $('inspectorIntro').textContent = 'The little things make it yours.';
    root.innerHTML = `<label class="field"><span>Canvas shape</span><select id="projectAspect">${option('16:9','Landscape · 16:9',state.aspect)}${option('9:16','Portrait · 9:16',state.aspect)}${option('1:1','Square · 1:1',state.aspect)}</select></label><label class="field"><span>Export size</span><select id="projectQuality">${option('720p','720p · lighter',state.quality)}${option('1080p','1080p · more detail',state.quality)}</select><small>Choose 720p for a lighter export on older devices.</small></label><label class="field"><span>Canvas background</span><input id="projectBackground" type="color" value="${/^#[0-9a-f]{6}$/i.test(state.background||'')?state.background:'#26252e'}"><small>Fades reveal this color.</small></label><div class="field"><span>Project storage</span><small>${revision ? 'Saved on this server. Use Save after editing.' : 'Not yet saved. Save to open on another device.'}</small></div>`;
  } else if (selected.type === 'clip' || selected.type === 'audio') {
    const source = asset(item.assetId), isVideo = selected.type === 'clip';
    const tracks = isVideo ? state.videoTracks : state.audioTracks;
    const timedMedia = source?.kind !== 'image', supportsFilters = 'filter' in context;
    $('inspectorTitle').innerHTML = `${isVideo ? 'Video clip' : 'Audio clip'}<span class="purple">.</span>`;
    $('inspectorIntro').textContent = source ? source.name : 'Missing media';
    root.innerHTML = `
      <label class="field"><span>Track</span><select id="itemTrack">${tracks.map(t => option(t.id, escapeHTML(t.name), item.trackId)).join('')}</select></label>
      <div class="field-row">${field('Source in (sec)','itemIn',item.in.toFixed(2),'type="number" min="0" step="0.1"')}${field('Source out (sec)','itemOut',item.out.toFixed(2),'type="number" min="0" step="0.1"')}</div>
      ${field('Timeline start (sec)','itemStart',item.start.toFixed(2),'type="number" min="0" step="0.1"')}
      <button class="tiny-button wide-tiny" id="placeAtPlayheadBtn">Place at playhead</button>
      ${timedMedia ? `<div class="field-row">${field('Speed (×)','itemRate',T.rate(item).toFixed(2),'type="number" min="0.5" max="4" step="0.05"')}${field('Duration (sec)','itemDuration',T.length(item).toFixed(2),'type="number" min="0.05" step="0.1"')}</div>` : ''}
      ${!isVideo ? '<button class="tiny-button wide-tiny" id="fitAudioBtn">Fit audio to entire video</button><p class="mini-hint">Changes tempo to fit; pitch is preserved when supported by your browser.</p>' : ''}
      ${isVideo ? `
        <label class="field"><span>Frame</span><select id="clipFit">${option('contain','Fit inside frame',item.fit)}${option('cover','Fill frame',item.fit)}</select></label>
        ${slider('Size','clipScale',Math.round(item.scale * 100),10,200)}
        <div class="field-row">${field('Horizontal %','clipX',item.x,'type="number" min="-100" max="200" step="1"')}${field('Vertical %','clipY',item.y,'type="number" min="-100" max="200" step="1"')}</div>
        ${slider('Opacity','clipOpacity',Math.round(item.opacity * 100),0,100)}
        ${field('Rotation (°)','clipRotation',T.normalizeRotation(item.rotation).toFixed(1),'type="number" step="1"')}
        <p class="mini-hint">Drag the picture on the preview; use its handles to resize or rotate.</p>
        <label class="check-field"><input id="clipFlip" type="checkbox" ${item.flipX ? 'checked' : ''}> Flip horizontally</label>
        <div class="section-label inspector-section"><span>COLOR</span><button class="text-button" id="resetColorBtn">Reset</button></div>
        ${slider('Brightness','clipBrightness',item.brightness,0,200,!supportsFilters)}
        ${slider('Contrast','clipContrast',item.contrast,0,200,!supportsFilters)}
        ${slider('Saturation','clipSaturation',item.saturation,0,200,!supportsFilters)}
        <div id="clipGradePanel"></div>
        <details class="grade-region"><summary>Color region</summary><p class="mini-hint">Import a static mask matching this picture’s aspect ratio. White or opaque areas receive the grade; black or transparent areas stay unchanged. The mask follows this clip, not moving objects.</p><label class="field"><span>Use mask</span><select id="clipMaskChannel"><option value="luminance">Brightness</option><option value="alpha">Transparency</option></select></label><button class="tiny-button wide-tiny" id="importClipMask">${item.gradeMask?'Replace color mask':'Import color mask'}</button>${item.gradeMask?'<button class="tiny-button wide-tiny" id="removeClipMask">Remove color mask</button>':''}</details>
        ${supportsFilters ? '' : '<p class="mini-hint">Color adjustments are unavailable in this browser.</p>'}` : ''}
      ${!isVideo || source?.kind === 'video' ? slider(isVideo ? 'Original sound' : 'Volume','itemVolume',Math.round(item.volume * 100),0,100) : ''}
      ${!isVideo&&item.soundroom ? soundroomInspector(item.soundroom) : ''}
      <div class="section-label inspector-section"><span>TRANSITIONS</span></div>
      <div class="field-row">${field('Fade in (sec)','itemFadeIn',number(item.fadeIn).toFixed(2),'type="number" min="0" step="0.1"')}${field('Fade out (sec)','itemFadeOut',number(item.fadeOut).toFixed(2),'type="number" min="0" step="0.1"')}</div>
      <button class="tiny-button wide-tiny" id="dissolveBtn">${isVideo ? '↔ Dissolve from previous' : '↔ Crossfade from previous'}</button>
      <p class="mini-hint">Overlaps the previous clip on this track using the fade-in time, or one second by default.</p>`;
  } else if (selected.type === 'title') {
    $('inspectorTitle').innerHTML = 'Title<span class="purple">.</span>'; $('inspectorIntro').textContent = 'A few words can go a long way.';
    root.innerHTML = `
      <label class="field"><span>Words</span><textarea id="titleText" maxlength="240">${escapeHTML(item.text)}</textarea></label>
      <div class="field-row">${field('Start (sec)','titleStart',item.start.toFixed(item.subtitle?3:1),`type="number" min="0" step="${item.subtitle?'0.001':'0.1'}"`)}${field('End (sec)','titleEnd',item.end.toFixed(item.subtitle?3:1),`type="number" min="0" step="${item.subtitle?'0.001':'0.1'}"`)}</div>
      <label class="field"><span>Position preset</span><select id="titlePosition">${option('top','Top',item.position)}${option('middle','Middle',item.position)}${option('bottom','Bottom',item.position)}${option('custom','Custom',item.position)}</select></label>
      <div class="field-row">${field('Horizontal %','titleX',Math.round(item.x),'type="number" min="0" max="100" step="1"')}${field('Vertical %','titleY',Math.round(item.y),'type="number" min="0" max="100" step="1"')}</div>
      ${field('Rotation (°)','titleRotation',T.normalizeRotation(item.rotation).toFixed(1),'type="number" step="1"')}
      <p class="mini-hint">Drag the text on the preview; use its handles to resize or rotate.</p>
      <label class="field"><span>Font</span><select id="titleFont">${TITLE_FONTS.map(font => option(font.id, font.label, item.font)).join('')}</select><small>Named fonts use those available on this device.</small></label>
      <div class="check-row"><label class="check-field"><input id="titleBold" type="checkbox" ${item.bold ? 'checked' : ''}> Bold</label><label class="check-field"><input id="titleItalic" type="checkbox" ${item.italic ? 'checked' : ''}> Italic</label></div>
      ${slider('Size','titleSize',item.size,2,30)}${slider('Text width','titleWidth',item.width,10,100)}
      <label class="field"><span>Color</span><input id="titleColor" type="color" value="${escapeHTML(item.color)}"></label>`;
  }
  if (item && selected?.type === 'clip') RoomGradeUI.mount($('clipGradePanel'), {
    get:()=>RoomGrade.readTarget(item,'clip'), getCompare:()=>gradeCompare,
    compare:value=>{gradeCompare=value;renderFrame();}, notify:message=>notify(message.includes('Look applied')&&item.keyframes?.some(frame=>frame.creativeLook!==undefined||[...RoomGrade.basic,...RoomGrade.advanced,...Object.keys(RoomGrade.Look.effectSpecs)].some(key=>frame[key]!==undefined))?message+' Existing color keyframes may override it.':message,6000),
    applyBatch:grade=>{const clips=state.clips.filter(clip=>clip.trackId===item.trackId);if(clips.length>100)return notify('This track has more than 100 clips; apply the look in smaller batches.',6000);if(!gradeFitsProject(clips,grade))return notify('This look is too large for the project. Apply it to fewer clips or use a smaller LUT.',7000);change(()=>{for(const clip of clips)RoomGrade.writeTarget(clip,'clip',grade.adjustments,grade.strength,grade.enabled,grade.look);});const animated=clips.some(clip=>clip.keyframes?.some(frame=>frame.creativeLook!==undefined||[...RoomGrade.basic,...RoomGrade.advanced,...Object.keys(RoomGrade.Look.effectSpecs)].some(key=>frame[key]!==undefined)));notify(`Look applied to ${clips.length} clip(s) on this track.${animated?' Existing color keyframes may override it.':''}`,6000);},
    update:(grade,commitChange)=>{
      if(recording||exportPreparing||selected?.id!==item.id)return false;
      if(grade.look?.lut&&grade.look.lut!==item.colorGrade?.look?.lut&&!gradeFitsProject([item],grade)){notify('This embedded LUT is too large for the project. Use a smaller LUT or remove other embedded looks.',7000);return false;}
      if(gradeBefore===null)gradeBefore=JSON.stringify(state);
      RoomGrade.writeTarget(item,'clip',grade.adjustments,grade.strength,grade.enabled,grade.look);
      if(state.version<5&&T.requiresV5(state))state.version=5;
      if(commitChange){const before=gradeBefore;gradeBefore=null;commitPrevious(before);}else renderFrame();return true;
    }
  });
  if (item && ['clip','audio'].includes(selected?.type)) root.insertAdjacentHTML('beforeend', keyframePanel(item, selected.type === 'clip'));
}
function soundroomInspector(link){try{const value=SoundSettings.link(link),source=asset(value.sourceAssetId);if(!source||source.kind!=='audio')return '<p class="mini-hint">The editable SoundRoom source is missing.</p>';const query=new URLSearchParams({source_asset:value.sourceAssetId,processing:JSON.stringify(value.processing)});return `<div class="section-label inspector-section"><span>SOUNDROOM SOURCE</span></div><p class="mini-hint">This timeline uses a processed copy. Open the full source and saved settings to edit, then send a new clip back.</p><a class="tiny-button wide-tiny" href="/soundroom/?${escapeHTML(query.toString())}" target="_blank" rel="noopener">Open editable source in SoundRoom ↗</a>`;}catch{return '<p class="mini-hint">The SoundRoom source settings are invalid.</p>';}}
function draggedClip(original, source, mode, delta) {
  const next = { ...original }, playbackRate = T.rate(original), minDuration = Math.min(.05, T.length(original));
  if (mode === 'move') next.start = Math.round(clamp(original.start + delta, 0, 86400) * 100) / 100;
  if (mode === 'trim-start') {
    const amount = clamp(delta, Math.max(-original.start, -original.in / playbackRate), T.length(original) - minDuration);
    next.start = original.start + amount; next.in = original.in + amount * playbackRate;
  }
  if (mode === 'trim-end') {
    const max = source.kind === 'image' ? 3600 : source.duration;
    next.out = clamp(original.out + delta * playbackRate, Math.min(max, original.in + minDuration * playbackRate), max);
  }
  if (mode === 'stretch') {
    const sourceLength = original.out - original.in;
    const duration = clamp(T.length(original) + delta, sourceLength / T.MAX_RATE, sourceLength / T.MIN_RATE);
    next.rate = sourceLength / duration;
  }
  return next;
}
function draggedTitle(original, delta, total) {
  let start = original.start, end = Math.min(total, original.end);
  if (original.mode === 'move') {
    const length = Math.max(.05, end - start); start = clamp(start + delta, 0, Math.max(0, total - length)); end = start + length;
  } else if (original.mode === 'start') start = clamp(start + delta, 0, end - .05);
  else if (original.mode === 'end') end = clamp(end + delta, start + .05, total);
  return { start, end };
}
function selectAudio(clipId, time, focusSpeed = false) {
  if (recording || exportPreparing) return;
  const clip = state.audioClips.find(item => item.id === clipId); if (!clip) return;
  selected = { type:'audio', id:clipId }; currentTime = clamp(time, clip.start, T.end(clip));
  stopPlayback(); render();
  if (focusSpeed) { const input = $('itemRate'); input?.focus(); input?.select(); }
}
function cutAudio(clipId, time) {
  const clip = state.audioClips.find(item => item.id === clipId); if (!clip) return;
  let second = null;
  change(() => {
    second = T.split(state, clipId, 'audio', time, uid);
    if (second) { selected = { type:'audio', id:second.id }; currentTime = time; }
  });
  if (!second) { selectAudio(clipId, time); notify('Choose a point inside the audio clip to cut it.'); }
}
function audioClick(clipId, time, x, y) {
  audioGesture.click(clipId, time, x, y);
}
function renderTimeline() {
  const total = totalDuration(), span = timelineSpan(), root = $('timelineContent');
  root.replaceChildren();
  root.style.width = `${Math.max(700, $('timelineScroll').clientWidth * timelineZoom)}px`;
  const rulerLabel = document.createElement('div'); rulerLabel.className = 'track-label ruler-label'; rulerLabel.textContent = 'TIME';
  const ruler = document.createElement('div'); ruler.id = 'ruler'; ruler.className = 'ruler'; ruler.setAttribute('aria-label', 'Seek on timeline');
  for (let i = 0; i <= 4; i++) { const tick = document.createElement('span'); tick.className = 'tick'; tick.style.left = `calc(${i * 25}% - ${i === 4 ? 30 : 0}px)`; tick.textContent = seconds(span * i / 4); ruler.append(tick); }
  root.append(rulerLabel, ruler);
  const seekFromEvent = event => { const rect = ruler.getBoundingClientRect(); seek((event.clientX - rect.left) / rect.width * span); };
  ruler.addEventListener('click', seekFromEvent);
  function row(track, type) {
    const label = document.createElement('div'); label.className = 'track-label'; label.title = track.name;
    const name = document.createElement('button');name.type='button';name.className='track-name';name.textContent=track.name;name.setAttribute('aria-label','Rename '+track.name);name.title='Rename track';name.addEventListener('click',()=>{const value=prompt('Track name',track.name);if(value===null)return;const next=value.trim();if(!next||next.length>80||/[\x00-\x1f\x7f]/.test(next))return notify('Track names must be 1 to 80 characters.');change(()=>{track.name=next;});});label.append(name);
    const tracks = type === 'clip' ? state.videoTracks : state.audioTracks;
    if (type === 'clip') {
      const visibility = document.createElement('button'); visibility.className = 'track-toggle' + (track.hidden ? ' off' : ''); visibility.textContent = track.hidden ? '○' : '◉';
      visibility.setAttribute('aria-label', `${track.hidden ? 'Show' : 'Hide'} ${track.name}`); visibility.title = track.hidden ? 'Show picture track' : 'Hide picture track';
      visibility.addEventListener('click', () => change(() => { track.hidden = !track.hidden; })); label.append(visibility);
    }
    const mute = document.createElement('button'); mute.className = 'track-toggle' + (track.muted ? ' off' : ''); mute.textContent = track.muted ? 'M' : '♪';
    mute.setAttribute('aria-label', `${track.muted ? 'Unmute' : 'Mute'} ${track.name}`); mute.title = track.muted ? 'Unmute track' : 'Mute track';
    mute.addEventListener('click', () => change(() => { track.muted = !track.muted; })); label.append(mute);
    if (tracks.length > 1) {
      const remove = document.createElement('button'); remove.className = 'remove-track'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${track.name} track`); remove.title = 'Remove track and its clips (undo available)';
      remove.addEventListener('click', () => change(() => {
        if (type === 'clip') { state.videoTracks = state.videoTracks.filter(t => t.id !== track.id); state.clips = state.clips.filter(c => c.trackId !== track.id); }
        else { state.audioTracks = state.audioTracks.filter(t => t.id !== track.id); state.audioClips = state.audioClips.filter(c => c.trackId !== track.id); }
      })); label.append(remove);
    }
    const lane = document.createElement('div'); lane.className = `track timeline-lane ${type === 'audio' ? 'audio-lane' : ''}`; lane.setAttribute('aria-label', track.name);
    lane.addEventListener('click', seekFromEvent);
    const clips = (type === 'clip' ? state.clips : state.audioClips).filter(c => c.trackId === track.id).sort(T.order);
    clips.forEach((clip, index) => {
      const source = asset(clip.assetId), el = document.createElement('button');
      el.className = `clip timeline-clip ${type === 'audio' ? 'audio-clip' : ''}` + (selected?.type === type && selected.id === clip.id ? ' selected' : '');
      el.style.left = `${100 * clip.start / span}%`; el.style.width = `${100 * T.length(clip) / span}%`; el.style.zIndex = String(index + 1);
      el.innerHTML = `<span class="clip-edge clip-edge-left" data-mode="trim-start" title="Drag to trim the start"></span><strong>${type === 'audio' ? '♪ ' : ''}${escapeHTML(source?.name || 'Missing media')}</strong><small>${seconds(T.length(clip))}${T.rate(clip) !== 1 ? ` · ${T.rate(clip).toFixed(2)}×` : ''}${clip.fadeIn || clip.fadeOut ? ' · fade' : ''}</small><span class="clip-edge clip-edge-right ${type === 'audio' ? 'stretch-edge' : ''}" data-mode="${type === 'audio' ? 'stretch' : 'trim-end'}" title="${type === 'audio' ? 'Drag to stretch audio' : 'Drag to trim the end'}"></span>`;
      if(showWaveforms){const waveform=drawWaveform(clip);if(waveform)el.prepend(waveform);}
      el.setAttribute('aria-label', `${source?.name || 'Missing media'} on ${track.name}, ${seconds(T.length(clip))}`);
      for (const frame of Array.isArray(clip.keyframes) ? clip.keyframes : []) {
        if (!Number.isFinite(frame.time) || frame.time < clip.in || frame.time > clip.out) continue;
        const marker = document.createElement('span'); marker.className = 'keyframe-marker';
        marker.style.left = (100 * (frame.time - clip.in) / (clip.out - clip.in)) + '%';
        el.append(marker);
      }
      if (type === 'audio') { el.dataset.audioId = clip.id; el.title = 'Click or tap to cut; double-click or double-tap to change speed'+(showWaveforms&&waveformErrors.has(clip.assetId)?'. '+waveformErrors.get(clip.assetId):''); }
      else if(showWaveforms&&waveformErrors.has(clip.assetId))el.title=waveformErrors.get(clip.assetId);
      let drag = null, suppressClick = false, lastMode = 'move';
      el.addEventListener('pointerdown', event => {
        if (event.button !== 0 || recording || exportPreparing) return;
        lastMode = event.target.dataset.mode || 'move';
        drag = { x: event.clientX, original: { ...clip }, mode: event.target.dataset.mode || 'move', moved: false, width: ruler.clientWidth };
        el.setPointerCapture(event.pointerId);
      });
      el.addEventListener('pointermove', event => {
        if (!drag) return;
        const delta = event.clientX - drag.x;
        if (Math.abs(delta) > 4) drag.moved = true;
        if (drag.moved) {
          if (type === 'audio') cancelAudioClick();
          const preview = draggedClip(drag.original, source, drag.mode, delta / drag.width * span);
          el.style.left = `${100 * preview.start / span}%`; el.style.width = `${100 * T.length(preview) / span}%`;
        }
      });
      el.addEventListener('pointerup', event => {
        if (!drag) return;
        const finalDrag = drag; drag = null;
        if (finalDrag.moved) {
          suppressClick = true; selected = { type, id: clip.id };
          change(() => {
            Object.assign(clip, draggedClip(finalDrag.original, source, finalDrag.mode, (event.clientX - finalDrag.x) / finalDrag.width * span));
            clip.fadeIn = Math.min(clip.fadeIn || 0, T.length(clip)); clip.fadeOut = Math.min(clip.fadeOut || 0, T.length(clip));
            currentTime = finalDrag.mode === 'trim-end' || finalDrag.mode === 'stretch' ? Math.min(T.end(clip), totalDuration()) : clip.start;
          });
        }
      });
      el.addEventListener('pointercancel', () => { drag = null; renderTimeline(); });
      el.addEventListener('click', event => {
        event.stopPropagation(); if (suppressClick) { suppressClick = false; return; }
        if (type === 'audio') {
          const rect = ruler.getBoundingClientRect(), time = (event.clientX - rect.left) / rect.width * span;
          if (event.detail === 0 || lastMode !== 'move') { cancelAudioClick(); selectAudio(clip.id, clip.start); }
          else audioClick(clip.id, time, event.clientX, event.clientY);
          return;
        }
        cancelAudioClick();
        selected = { type, id: clip.id }; currentTime = clip.start; stopPlayback(); render();
      });
      lane.append(el);
    });
    root.append(label, lane);
  }
  [...state.videoTracks].reverse().forEach(track => row(track, 'clip'));
  const titleLabel = document.createElement('div'); titleLabel.className = 'track-label'; titleLabel.textContent = 'Titles';
  const titles = document.createElement('div'); titles.className = 'track title-lane'; titles.addEventListener('click', seekFromEvent);
  for (const title of state.titles) {
    if (title.start >= total || title.end <= title.start) continue;
    const el = document.createElement('button'); el.className = 'overlay title title-timeline' + (selected?.type === 'title' && selected.id === title.id ? ' selected' : '');
    el.style.left = `${100 * title.start / span}%`; el.style.width = `${100 * (Math.min(total, title.end) - title.start) / span}%`;
    el.innerHTML = `<span class="clip-edge clip-edge-left" data-mode="start" title="Drag to trim title start"></span><span class="title-clip-name">${escapeHTML(title.text || 'Title')}</span><span class="clip-edge clip-edge-right" data-mode="end" title="Drag to trim title end"></span>`;
    let drag = null, suppressClick = false;
    el.addEventListener('pointerdown', event => { if (event.button !== 0 || recording || exportPreparing) return; drag = { x:event.clientX, start:title.start, end:title.end, mode:event.target.dataset.mode || 'move', moved:false, width:ruler.clientWidth }; el.setPointerCapture(event.pointerId); });
    el.addEventListener('pointermove', event => {
      if (!drag) return; const dx = event.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) { const next = draggedTitle(drag, dx / drag.width * span, total); el.style.left = `${100 * next.start / span}%`; el.style.width = `${100 * (next.end - next.start) / span}%`; }
    });
    el.addEventListener('pointerup', event => {
      if (!drag) return; const previous = drag; drag = null;
      if (previous.moved) { suppressClick = true; selected = { type:'title', id:title.id }; change(() => { Object.assign(title, draggedTitle(previous, (event.clientX - previous.x) / previous.width * span, total)); currentTime = title.start; }); }
    });
    el.addEventListener('pointercancel', () => { drag = null; renderTimeline(); });
    el.addEventListener('click', event => { event.stopPropagation(); if (suppressClick) { suppressClick = false; return; } selected = { type: 'title', id: title.id }; seek(title.start); render(); }); titles.append(el);
  }
  root.append(titleLabel, titles);
  state.audioTracks.forEach(track => row(track, 'audio'));
  const playhead = document.createElement('div'); playhead.id = 'playhead'; playhead.className = 'playhead'; playhead.innerHTML = '<span></span>'; root.append(playhead);
  updatePlayhead();
}
function timelineSpan() { const total = totalDuration(); return Math.max(total * 1.1, total + 1, 1); }
function updatePlayhead() { const ruler = $('ruler'), head = $('playhead'); if (!ruler || !head) return; head.style.left = `${ruler.offsetLeft + ruler.clientWidth * clamp(currentTime / timelineSpan(), 0, 1)}px`; }
function updateTime() {
  $('timeDisplay').innerHTML = `${seconds(currentTime)} <span>/</span> ${seconds(totalDuration())}`;
  $('playBtn').innerHTML = `<svg><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
  $('playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  updatePlayhead();
  if (recording) { const pct = totalDuration() ? Math.min(100, currentTime / totalDuration() * 100) : 0; $('exportProgress').style.width = pct + '%'; $('exportStatus').textContent = `Rendering ${seconds(currentTime)} of ${seconds(totalDuration())}…`; }
}
function addMedia(id,soundroom=null) {
  const source = asset(id); if (!source) return;
  change(() => {
    if (source.kind === 'audio') {
      const start = Math.max(0, ...state.audioClips.filter(c => c.trackId === audioTarget).map(T.end));
      const clip = { id: uid(), assetId: id, trackId: audioTarget, start, in: 0, out: source.duration, rate:1, volume:soundroom?1:.7, fadeIn: 0, fadeOut: 0,...(soundroom?{soundroom:SoundSettings.link(soundroom)}:{}) };
      state.audioClips.push(clip); selected = { type: 'audio', id: clip.id }; currentTime = clip.start;
    } else {
      const start = Math.max(0, ...state.clips.filter(c => c.trackId === videoTarget).map(T.end));
      const clip = { id: uid(), assetId: id, trackId: videoTarget, start, in: 0, out:source.kind === 'image' ? 5 : source.duration, rate:1, volume:1, fit:'contain', opacity:1, scale:1, x:50, y:50, brightness:100, contrast:100, saturation:100, rotation:0, flipX:false, fadeIn:0, fadeOut:0 };
      state.clips.push(clip); selected = { type: 'clip', id: clip.id }; currentTime = clip.start;
    }
  });
}
async function inspectFile(file, kind) {
  const objectUrl = URL.createObjectURL(file);
  try {
    if (kind === 'image') {
      const image = new Image(); image.src = objectUrl;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Your browser could not open this photo.')); });
      return { duration: 5, width: image.naturalWidth, height: image.naturalHeight };
    }
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video'); el.preload = 'metadata'; el.src = objectUrl;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Reading this file timed out.')), 20000); el.onloadedmetadata = () => { clearTimeout(timer); resolve(); }; el.onerror = () => { clearTimeout(timer); reject(new Error('Your browser cannot decode this file.')); }; });
    const duration=await readableDuration(el);
    return { duration, width: el.videoWidth || 0, height: el.videoHeight || 0 };
  } finally { URL.revokeObjectURL(objectUrl); }
}
async function readableDuration(media){
  if(Number.isFinite(media.duration)&&media.duration>0)return media.duration;
  // Older MediaRecorder WebM files have no duration in their header. Seeking
  // to the end lets Chromium discover the final timestamp without guessing.
  return new Promise((resolve,reject)=>{let timer;
    const done=()=>{if(Number.isFinite(media.duration)&&media.duration>0){cleanup();resolve(media.duration);}};
    const cleanup=()=>{clearTimeout(timer);for(const event of ['durationchange','timeupdate','seeked'])media.removeEventListener(event,done);media.removeEventListener('error',failed);};
    const failed=()=>{cleanup();reject(new Error('The file has no readable duration.'));};
    for(const event of ['durationchange','timeupdate','seeked'])media.addEventListener(event,done);media.addEventListener('error',failed);timer=setTimeout(failed,20000);
    try{media.currentTime=1e101;done();}catch{failed();}
  });
}
const fallbackTypes = { mp4:'video/mp4', m4v:'video/x-m4v', mov:'video/quicktime', webm:'video/webm', mp3:'audio/mpeg', m4a:'audio/mp4', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', avif:'image/avif' };
async function importFiles(files) {
  if (mediaBusy || recording) return;
  mediaBusy = true; $('importBtn').disabled = true; $('emptyImportBtn').disabled = true;
  for (const file of files) {
    try {
      const type = (file.type || fallbackTypes[file.name.split('.').pop().toLowerCase()] || '').toLowerCase().split(';')[0];
      const kind = type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio' : type.startsWith('image/') ? 'image' : null;
      if (!kind || type === 'image/svg+xml') throw new Error('Choose a supported video, audio file, or photo.');
      if (file.size > 2 * 1024 * 1024 * 1024) throw new Error('Files must be 2 GB or smaller.');
      notify(`Adding ${file.name} to your library…`, 30000);
      const info = await inspectFile(file, kind);
      const uploaded = await request('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Type': type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
      change(() => { state.assets.push({ ...uploaded, ...info, kind }); });
      addMedia(uploaded.id);
      notify(`${file.name} added to the timeline.`);
    } catch (error) { notify(`${file.name}: ${error.message}`, 7000); }
  }
  mediaBusy = false; $('importBtn').disabled = false; $('emptyImportBtn').disabled = false; $('fileInput').value = '';
}

function setCanvasSize() {
  const base = state.quality === '1080p' ? 1080 : 720;
  const [w, h] = state.aspect === '1:1' ? [base, base] : state.aspect === '9:16' ? [base, Math.round(base * 16 / 9)] : [Math.round(base * 16 / 9), base];
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; canvas.style.aspectRatio = `${w}/${h}`; }
}
function imageFor(source) {
  if (!images.has(source.id)) { const img = new Image(); img.onload = () => { if (!playing) renderFrame(); }; img.src = `/api/assets/${source.id}`; images.set(source.id, img); }
  return images.get(source.id);
}
function gradeMaskFor(value){
  const mask=ClipRegionGrade.validate(value);let image=gradeMaskImages.get(mask.image);
  if(!image){image=new Image();image.onload=()=>{if(!playing)renderFrame();};image.onerror=()=>{if(!gradeMaskWarnings.has(mask.image)){gradeMaskWarnings.add(mask.image);notify('A color mask could not be decoded. Replace it before exporting.',7000);}};image.src=mask.image;gradeMaskImages.set(mask.image,image);}return image;
}
async function prepareGradeMasks(project=state){
  ClipRegionGrade.validateProject(project.clips);await Promise.all(project.clips.filter(clip=>clip.gradeMask).map(async clip=>{const mask=ClipRegionGrade.validate(clip.gradeMask),image=gradeMaskFor(mask);try{await image.decode();}catch{throw new Error('A color mask could not be decoded. Replace it before exporting.');}if(image.naturalWidth!==mask.width||image.naturalHeight!==mask.height)throw new Error('A color mask has invalid dimensions.');const source=project.assets.find(item=>item.id===clip.assetId);if(source?.width&&source?.height&&!ClipRegionGrade.compatible(mask.width,mask.height,source.width,source.height))throw new Error('A color mask does not match its source aspect ratio.');}));
}
function pruneMedia() {
  const current = new Map([...state.clips, ...state.audioClips].map(c => [c.id, c.assetId]));
  for (const [id, entry] of elements) if (current.get(id) !== entry.assetId) dropMedia(id);
}
function dropMedia(id){const entry=elements.get(id);if(!entry)return;entry.el.pause();entry.el.removeAttribute('src');entry.el.load();entry.source?.disconnect();entry.gain?.disconnect();elements.delete(id);activeMedia.delete(id);}
function refreshPreviewSources(){stopPlayback();for(const id of [...elements.keys()])dropMedia(id);syncMedia(true);renderFrame();}
function mediaFor(source, clip) {
  const useProxy=source.kind==='video'&&useProxyPreview&&!recording&&!exportPreparing&&proxyStatuses.get(source.id)?.exists&&!proxyStatuses.get(source.id)?.broken,url=useProxy?`/api/proxies/${source.id}?v=${encodeURIComponent(proxyStatuses.get(source.id).version)}`:`/api/assets/${source.id}`;
  if(elements.has(clip.id)&&elements.get(clip.id).url!==url)dropMedia(clip.id);
  if (!elements.has(clip.id)) {
    const el = document.createElement(source.kind === 'audio' ? 'audio' : 'video'); el.preload = 'auto'; el.playsInline = true;
    el.addEventListener('loadeddata', () => { if (!playing) renderFrame(); });
    el.addEventListener('seeked', () => { if (!playing) renderFrame(); });
    const entry={el,gain:null,source:null,assetId:source.id,url};elements.set(clip.id,entry);
    el.addEventListener('error',()=>{if(useProxy&&elements.get(clip.id)===entry){proxyStatuses.set(source.id,{exists:true,broken:true});refreshPreviewSources();notify('The optimized preview could not be played. Switched back to the original.',7000);}});el.src=url;
  }
  const entry = elements.get(clip.id);
  if (audioContext && !entry.gain) {
    // The element may have been previewed before the audio graph existed,
    // including at the silent start of a fade. Once connected, gain controls
    // the volume; keeping the element's old volume would mute or double-scale it.
    entry.el.volume = 1;
    entry.source=audioContext.createMediaElementSource(entry.el); entry.gain = audioContext.createGain(); entry.source.connect(entry.gain); entry.gain.connect(audioContext.destination); entry.gain.connect(outputAudio);
  }
  return entry;
}
function drawCover(source, clip, opacity, compare = 'off', fastPreview = false, strict = false) {
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return;
  const boxWidth = canvas.width * clip.scale, boxHeight = canvas.height * clip.scale;
  const centerX = canvas.width * clip.x / 100, centerY = canvas.height * clip.y / 100;
  const scale = clip.fit === 'cover' ? Math.max(boxWidth / sw, boxHeight / sh) : Math.min(boxWidth / sw, boxHeight / sh);
  const w = sw * scale, h = sh * scale;
  context.save(); context.globalAlpha = opacity;
  context.translate(centerX, centerY); context.rotate(number(clip.rotation) * Math.PI / 180); if (clip.flipX) context.scale(-1, 1);
  context.beginPath(); context.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight); context.clip();
  const grade=RoomGrade.readTarget(clip,'clip');
  const draw=before=>{
    const values=RoomGrade.effective(grade,before),ratio=Math.min(1,Math.abs(w)/sw,Math.abs(h)/sh,fastPreview?480/Math.max(sw,sh):1);
    let region=false,processed;const active=RoomGrade.hasAdvanced(values)||RoomGrade.basic.some(key=>values[key]!==0);
    if(!before&&clip.gradeMask&&active){const mask=gradeMaskFor(clip.gradeMask);if(!mask.complete||!mask.naturalWidth){if(strict)throw new Error('A color mask is not ready.');processed=source;}else if(!ClipRegionGrade.compatible(mask.naturalWidth,mask.naturalHeight,sw,sh)){if(strict)throw new Error('A color mask does not match its source aspect ratio.');if(!gradeMaskWarnings.has(clip.gradeMask.image)){gradeMaskWarnings.add(clip.gradeMask.image);notify('A color mask does not match its source. Replace it before exporting.',7000);}processed=source;}else{region=true;processed=ClipRegionGrade.render(source,mask,values,sw*ratio,sh*ratio,source instanceof HTMLImageElement);}}
    else processed=RoomGrade.renderSource(source,values,sw*ratio,sh*ratio,source instanceof HTMLImageElement);
    if ('filter' in context) context.filter=region||processed===source&&clip.gradeMask&&!before?'none':RoomGrade.cssFilter(values);
    context.drawImage(processed,-w/2,-h/2,w,h);
  };
  try {
    if(compare==='split'){context.save();context.beginPath();context.rect(-w/2,-h/2,w/2,h);context.clip();draw(true);context.restore();context.save();context.beginPath();context.rect(0,-h/2,w/2,h);context.clip();draw(false);context.restore();}
    else draw(compare==='before');
  } catch(error) { if(source instanceof HTMLVideoElement && source.readyState<2) { context.restore(); return; } throw error; }
  context.restore();
}
function videoLayout(clip) {
  const source = asset(clip.assetId), sw = number(source?.width) || canvas.width, sh = number(source?.height) || canvas.height;
  const boxWidth = canvas.width * number(clip.scale, 1), boxHeight = canvas.height * number(clip.scale, 1);
  const scale = clip.fit === 'cover' ? Math.max(boxWidth / sw, boxHeight / sh) : Math.min(boxWidth / sw, boxHeight / sh);
  const width = Math.min(boxWidth, sw * scale), height = Math.min(boxHeight, sh * scale);
  const centerX = canvas.width * number(clip.x, 50) / 100, centerY = canvas.height * number(clip.y, 50) / 100;
  return { centerX, centerY, width, height, x:centerX - width / 2, y:centerY - height / 2 };
}
function titleLayout(title) {
  const size = Math.round(canvas.width * title.size / 100), maxWidth = canvas.width * number(title.width, 84) / 100;
  const fontFamily = TITLE_FONTS.find(font => font.id === title.font)?.family || 'sans-serif';
  const font = `${title.italic ? 'italic ' : ''}${title.bold ? '700' : '400'} ${size}px ${fontFamily}`;
  context.save(); context.font = font;
  const lines = [];
  for (const paragraph of title.text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  const displayed = lines.slice(0, 6), lineHeight = size * 1.15;
  const centerX = canvas.width * number(title.x, 50) / 100, centerY = canvas.height * number(title.y, 50) / 100;
  const width = Math.max(size, ...displayed.map(line => Math.min(maxWidth, context.measureText(line).width)));
  const pad = Math.max(size * .2, 8), height = displayed.length * lineHeight;
  context.restore();
  return { size, font, maxWidth, displayed, lineHeight, centerX, centerY,
    x:centerX - width / 2 - pad, y:centerY - height / 2 - pad, width:width + 2 * pad, height:height + 2 * pad };
}
function drawTitle(title) {
  const layout = titleLayout(title);
  context.save(); context.font = layout.font; context.fillStyle = title.color; context.textAlign = 'center'; context.textBaseline = 'middle'; context.shadowColor = 'rgba(0,0,0,.72)'; context.shadowBlur = layout.size * .15;
  context.translate(layout.centerX, layout.centerY); context.rotate(T.normalizeRotation(title.rotation) * Math.PI / 180);
  layout.displayed.forEach((line, i, all) => context.fillText(line, 0, (i - (all.length - 1) / 2) * layout.lineHeight, layout.maxWidth));
  context.restore();
}
function updateStageSelection() {
  const overlay = $('stageSelection'), item = selectedItem();
  const at = currentTime >= totalDuration() && totalDuration() > 0 ? Math.max(0, totalDuration() - .001) : currentTime;
  const isTitle = selected?.type === 'title', isVideo = selected?.type === 'clip';
  const active = item && (isTitle ? at >= item.start && at < item.end : isVideo && T.active(item, at) && !state.videoTracks.find(track => track.id === item.trackId)?.hidden);
  if (!active || playing || recording || exportPreparing) { overlay.classList.add('hidden'); return; }
  const visual = isVideo ? { ...item, ...T.animatedValues(item, at) } : item;
  const canvasRect = canvas.getBoundingClientRect(), frameRect = $('canvasFrame').getBoundingClientRect(), layout = isTitle ? titleLayout(item) : videoLayout(visual);
  if (!canvasRect.width || !canvasRect.height) { overlay.classList.add('hidden'); return; }
  overlay.style.left = `${canvasRect.left - frameRect.left + layout.x / canvas.width * canvasRect.width}px`;
  overlay.style.top = `${canvasRect.top - frameRect.top + layout.y / canvas.height * canvasRect.height}px`;
  overlay.style.width = `${layout.width / canvas.width * canvasRect.width}px`;
  overlay.style.height = `${layout.height / canvas.height * canvasRect.height}px`;
  overlay.style.transform = `rotate(${T.normalizeRotation(visual.rotation)}deg)`;
  overlay.setAttribute('aria-label', `Selected ${isTitle ? 'text' : 'picture'}: drag to move`);
  overlay.classList.remove('hidden');
}
function renderFrame(offlineVideoFrames = null) {
  context.fillStyle = /^#[0-9a-f]{6}$/i.test(state.background||'') ? state.background : '#26252e'; context.fillRect(0, 0, canvas.width, canvas.height);
  const at = currentTime >= totalDuration() && totalDuration() > 0 ? Math.max(0, totalDuration() - .001) : currentTime;
  for (const track of state.videoTracks) {
    if (track.hidden) continue;
    const visible = state.clips.filter(c => c.trackId === track.id && T.active(c, at)).sort(T.order);
    for (const clip of visible) {
      const source = asset(clip.assetId), opacity = T.visualOpacity(state, clip, at), animated=T.animatedValues(clip, at),effectKeys=Object.keys(RoomGrade.Look.effectSpecs),hasEffectFrames=clip.keyframes?.some(frame=>effectKeys.some(key=>frame[key]!==undefined));
      const colorGrade={...(clip.colorGrade||{}),...Object.fromEntries(RoomGrade.advanced.map(key=>[key,animated[key]]))},hasCreativeFrames=clip.keyframes?.some(frame=>frame.creativeLook!==undefined);
      if(hasEffectFrames||hasCreativeFrames)colorGrade.look={...(hasCreativeFrames?ClipLookFrames.at(clip,T.sourceAt(clip,at)):RoomGrade.Look.validate(clip.colorGrade?.look)),...(hasEffectFrames?Object.fromEntries(effectKeys.map(key=>[key,animated[key]])):{})};
      const visual = { ...clip, ...animated, colorGrade };
      const compare=!recording&&!exportPreparing&&!offlineVideoFrames&&selected?.type==='clip'&&selected.id===clip.id?gradeCompare:'off';
      const fast=fastColorPreview&&!recording&&!exportPreparing&&!offlineVideoFrames;
      const strict=recording||exportPreparing||!!offlineVideoFrames;
      if (source?.kind === 'image') { const img = imageFor(source); if (img.complete && img.naturalWidth) drawCover(img, visual, opacity, compare, fast, strict); }
      if (source?.kind === 'video') { const el = offlineVideoFrames ? offlineVideoFrames.get(clip.id) : mediaFor(source, clip).el; if (el && (offlineVideoFrames || el.readyState >= 2)) drawCover(el, visual, opacity, compare, fast, strict); }
    }
  }
  for (const title of state.titles) if (at >= title.start && at < title.end) drawTitle(title);
  updateStageSelection();
  if (recording) { realtimeRenderedFrames++;try { realtimeCaptureTrack?.requestFrame?.(); } catch { /* automatic capture remains available */ } }
}
function setTime(el, value) {
  const apply = () => { try { if (Math.abs(el.currentTime - value) > .02) el.currentTime = Math.max(0, value); } catch { /* a seek can wait for metadata */ } };
  if (el.readyState >= 1) apply(); else el.addEventListener('loadedmetadata', apply, { once: true });
}
function playElement(el) { const p = el.play(); if (p && p.catch) p.catch(() => { if (playing) notify('The browser could not play this media. Try another format.'); }); }
function syncMedia(force = false) {
  const nowActive = new Set();
  for (const clip of [...state.clips, ...state.audioClips]) {
    const source = asset(clip.assetId);
    if (!source || source.kind === 'image' || !T.active(clip, currentTime)) continue;
    nowActive.add(clip.id);
    const entry = mediaFor(source, clip), track = [...state.videoTracks, ...state.audioTracks].find(t => t.id === clip.trackId);
    const volume = track?.muted ? 0 : clamp(T.animatedValues(clip, currentTime).volume * T.envelope(clip, currentTime), 0, 1);
    if (Math.abs(entry.el.playbackRate - T.rate(clip)) > .00001) entry.el.playbackRate = T.rate(clip);
    if ('preservesPitch' in entry.el && !entry.el.preservesPitch) entry.el.preservesPitch = true;
    if (entry.gain) entry.gain.gain.value = volume; else entry.el.volume = volume;
    if (force || !activeMedia.has(clip.id)) {
      setTime(entry.el, T.sourceAt(clip, currentTime));
      if (playing) playElement(entry.el); else entry.el.pause();
    }
  }
  for (const [id, entry] of elements) if (!nowActive.has(id)) entry.el.pause();
  activeMedia = nowActive;
}
function seek(time) {
  currentTime = clamp(number(time), 0, totalDuration());
  if (playing) playClock = performance.now() - currentTime * 1000;
  syncMedia(true); renderFrame(); updateTime();
}
async function ensureAudio() {
  if (!audioContext) {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) throw new Error('This browser cannot mix audio for playback or export.');
    audioContext = new Constructor(); outputAudio = audioContext.createMediaStreamDestination();
    // Keep the destination clock running for picture-only timelines.
    silentAudio = audioContext.createConstantSource(); const silence = audioContext.createGain(); silence.gain.value = 0;
    silentAudio.connect(silence); silence.connect(outputAudio); silentAudio.start();
  }
  if (audioContext.state !== 'running') await audioContext.resume();
}
function waitForMedia(el, event, condition) {
  if (condition()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const events = [...new Set([event, 'canplay', 'seeked'])];
    const cleanup = () => { clearTimeout(timer); for (const name of events) el.removeEventListener(name, ready); el.removeEventListener('error', failed); };
    const ready = () => { if (condition()) { cleanup(); resolve(); } };
    const failed = () => { cleanup(); reject(new Error('A media file could not be decoded by this browser.')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('A media file took too long to prepare.')); }, 30000);
    for (const name of events) el.addEventListener(name, ready);
    el.addEventListener('error', failed);
    if (condition()) ready();
  });
}
async function prepareExport() {
  // Each simultaneous clip needs its own decoder and audio node, even when
  // several clips refer to the same original file.
  await Promise.all([...state.clips, ...state.audioClips].map(async clip => {
    const source = asset(clip.assetId);
    if (!source) throw new Error('A project media file is missing.');
    if (source.kind === 'image') {
      const img = imageFor(source);
      if (typeof img.decode === 'function') await img.decode();
      else if (!img.complete) await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    } else {
      const { el } = mediaFor(source, clip);
      await waitForMedia(el, 'loadeddata', () => el.readyState >= 2);
      setTime(el, clip.in);
      await waitForMedia(el, 'seeked', () => !el.seeking);
      await waitForMedia(el, 'loadeddata', () => el.readyState >= 2);
    }
  }));
  renderFrame();
}
async function waitForPlaybackStart(initialTime, generation) {
  const active = [...state.clips, ...state.audioClips].filter(clip => activeMedia.has(clip.id));
  if (!active.length) return true;
  const began = performance.now();
  while (playing && generation === playbackGeneration) {
    const ready = active.every(clip => {
      const entry = elements.get(clip.id); if (!entry || entry.el.paused || entry.el.seeking) return false;
      const available = Math.max(0, clip.out - T.sourceAt(clip, initialTime));
      const needed = Math.min(.02 * T.rate(clip), available / 2);
      return entry.el.currentTime >= T.sourceAt(clip, initialTime) + needed;
    });
    if (ready) return true;
    if (performance.now() - began > 5000) throw new Error('A media clip could not start. Check its format and try again.');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}
async function startPlayback(fromStart = false, onReady = null) {
  if (!totalDuration()) return;
  await ensureAudio();
  if (fromStart || currentTime >= totalDuration()) currentTime = 0;
  const initialTime = currentTime, generation = ++playbackGeneration;
  playing = true; activeMedia = new Set(); syncMedia(true); updateTime();
  const ready = await waitForPlaybackStart(initialTime, generation);
  if (!ready || generation !== playbackGeneration) return false;
  if (onReady) onReady();
  playClock = performance.now() - initialTime * 1000;
  lastDrawTime = 0;
  cancelAnimationFrame(frameId); frameId = requestAnimationFrame(tick); updateTime();
  return true;
}
function stopPlayback() {
  playbackGeneration++; playing = false; cancelAnimationFrame(frameId); frameId = 0;
  for (const { el } of elements.values()) el.pause();
  activeMedia = new Set(); updateTime(); updateStageSelection();
}
function tick(now) {
  if (!playing) return;
  currentTime = Math.min(totalDuration(), Math.max(0, (now - playClock) / 1000));
  syncMedia();
  if (!lastDrawTime || now - lastDrawTime >= 1000 / 30 || currentTime >= totalDuration()) { renderFrame(); updateTime(); lastDrawTime = now; }
  if (currentTime >= totalDuration()) {
    stopPlayback(); renderFrame();
    if (recording && recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* already stopping */ } }
    return;
  }
  frameId = requestAnimationFrame(tick);
}

function setState(newState, id, newRevision) {
  const nextState = T.migrate(newState, uid);
  ClipRegionGrade.validateProject(nextState.clips);gradeMaskImages.clear();gradeMaskWarnings.clear();
  cancelAudioClick();
  stopPlayback();
  state = nextState; projectId = id; revision = newRevision; currentTime = 0; selected = null; undoStack = []; redoStack = []; dirty = false;
  videoTarget = state.videoTracks[0].id; audioTarget = state.audioTracks[0].id;
  render(); syncMedia(true); renderFrame();if(useProxyPreview)void refreshProxyStatuses();
}
async function saveProject(asCopy = false) {
  if (saveInProgress || recording || exportPreparing || mediaBusy) { notify('Please wait for the current action to finish.'); return; }
  saveInProgress = true; $('saveBtn').disabled = true;
  const saveId = asCopy ? uid() : projectId, snapshot = clone(state), baseRevision = asCopy ? 0 : revision;
  if (asCopy) snapshot.name = snapshot.name.replace(/ \(copy\)$/, '').slice(0, 153) + ' (copy)';
  try {
    const saved = await request(`/api/projects/${saveId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision, state: snapshot }) });
    if (asCopy) { projectId = saveId; state.name = snapshot.name; }
    revision = saved.revision; dirty = JSON.stringify(state) !== JSON.stringify(snapshot);
    $('conflictDialog').close(); render(); notify(dirty ? 'Saved the earlier version. Save again for your latest changes.' : 'Project saved on this server.');
  } catch (error) {
    if (error.status === 409) $('conflictDialog').showModal(); else notify(error.message, 7000);
  } finally { saveInProgress = false; $('saveBtn').disabled = false; }
}
async function loadProjectList() {
  const { projects } = await request('/api/projects'), root = $('projectList'); root.replaceChildren();
  if (!projects.length) root.innerHTML = '<p class="mini-hint">No saved projects yet. Save your first story to find it here.</p>';
  for (const project of projects) {
    const row = document.createElement('div'); row.className = 'project-item';
    const open = document.createElement('button'); open.className = 'project-open'; open.type = 'button';
    open.setAttribute('aria-label', 'Open ' + project.name);
    open.innerHTML = `<span><strong>${escapeHTML(project.name)}</strong><small>Saved ${escapeHTML(new Date(project.updatedAt).toLocaleString())}</small></span><span class="project-open-label" aria-hidden="true">Open ↗</span>`;
    open.addEventListener('click', async () => {
      if (dirty && !confirm('You have unsaved changes. Open this project anyway?')) return;
      try { const loaded = await request(`/api/projects/${project.id}`); setState(loaded.state, loaded.id, loaded.revision); $('projectsDialog').close(); notify('Project opened.'); }
      catch (error) { $('projectsStatus').textContent = error.message; }
    });
    const remove = document.createElement('button'); remove.className = 'project-delete'; remove.type = 'button'; remove.textContent = 'Delete';
    remove.setAttribute('aria-label', 'Delete ' + project.name);
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete “${project.name}”? This permanently removes the saved project; its uploaded media stays on the server.`)) return;
      remove.disabled = true; open.disabled = true; $('projectsStatus').textContent = 'Deleting project…';
      try {
        await request(`/api/projects/${project.id}`, { method:'DELETE', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ baseRevision:project.revision }) });
        const wasOpen = projectId === project.id && revision > 0;
        if (wasOpen) { projectId = uid(); revision = 0; dirty = true; render(); }
        const focus = row.nextElementSibling?.querySelector('.project-open') || row.previousElementSibling?.querySelector('.project-open') || $('newProjectBtn');
        row.remove();
        if (!root.children.length) root.innerHTML = '<p class="mini-hint">No saved projects yet. Save your first story to find it here.</p>';
        $('projectsStatus').textContent = wasOpen ? 'Project deleted. Your open timeline can be saved as a new project.' : 'Project deleted. Its uploaded media remains on the server.';
        if ($('projectsDialog').open) focus.focus();
      } catch (error) {
        if (error.status === 409 || error.status === 404) {
          try { await loadProjectList(); } catch { /* Keep the existing list and show the error. */ }
        }
        $('projectsStatus').textContent = error.message;
      } finally { remove.disabled = false; open.disabled = false; }
    });
    const pack=document.createElement('a');pack.className='tiny-button';pack.textContent='Download package';pack.setAttribute('aria-label','Download package for '+project.name);pack.href='/api/projects/'+project.id+'/package?'+new URLSearchParams({revision:String(project.revision)});pack.download='cliproom-'+project.id+'.roomclip';pack.target='_blank';pack.rel='noopener';pack.onclick=()=>{$('projectsStatus').textContent='Preparing a package of this saved revision and its project media. Large packages may take time.';};
    row.append(open, pack, remove); root.append(row);
  }
}
async function showProjects() {
  if (recording || exportPreparing || mediaBusy || saveInProgress) return;
  try {
    await loadProjectList(); $('projectsStatus').textContent = '';
    if (!$('projectsDialog').open) $('projectsDialog').showModal();
  } catch (error) { notify(error.message, 7000); }
}
let mediaAuditNext=null,mediaAuditGeneration=0,mediaAuditView='audit';
async function loadMediaAudit(reset=false){
  const generation=++mediaAuditGeneration,offset=reset?0:mediaAuditNext;if(offset===null)return;const list=$('mediaAuditList'),status=$('mediaAuditStatus'),more=$('mediaAuditMore');if(reset)list.replaceChildren();more.hidden=true;status.textContent='Checking saved projects and server media…';
  try{const result=await request('/api/assets/audit?'+new URLSearchParams({offset:String(offset),limit:'100'}));if(generation!==mediaAuditGeneration)return;mediaAuditNext=result.next_offset;more.hidden=mediaAuditNext===null;status.textContent=result.complete?`${result.media_count} media file(s) · ${result.unreferenced_count} not referenced by saved projects. ${result.unmanaged_media} file(s) need manual inspection.`:'Audit incomplete; unreferenced status is unknown. '+result.issues.join(' ');
    for(const item of result.items){const row=document.createElement('div'),detail=document.createElement('div'),title=document.createElement('strong'),summary=document.createElement('small');row.className='project-item';row.dataset.mediaId=item.id;row.dataset.mediaStatus=item.status;title.textContent=item.name;const open=state.assets.some(asset=>typeof asset.id==='string'&&asset.id.toLowerCase()===item.id.toLowerCase())||[...state.clips,...state.audioClips].some(clip=>typeof clip.assetId==='string'&&clip.assetId.toLowerCase()===item.id.toLowerCase()),references=item.reference_count?item.references.map(ref=>ref.name).join(', ')+(item.reference_count>item.references.length?' and more':''):item.status==='unreferenced'?'No saved project references':'Reference status unknown',oldEnough=Date.now()-Date.parse(item.modified_at)>=result.trash_min_age_seconds*1000;summary.textContent=(item.bytes/1024/1024).toFixed(2)+' MiB · '+references+(open?' · in this open project':item.status==='unreferenced'&&!oldEnough?' · available for trash after 24 hours':'');detail.append(title,summary);row.append(detail);if(item.status==='unreferenced'&&!open&&oldEnough){const remove=document.createElement('button');remove.className='project-delete';remove.textContent='Move to trash';remove.addEventListener('click',async()=>{if(!confirm(`Move “${item.name}” to recoverable trash? Other open or unsaved projects and external backups may still need it.`))return;remove.disabled=true;try{const result=await request('/api/assets/'+item.id+'/trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm_unsaved:true})});await loadMediaAudit(true);if(result.proxy_warning)status.textContent=result.proxy_warning+' Open trash to retry removing the preview.';}catch(error){status.textContent=error.message;remove.disabled=false;}});row.append(remove);}list.append(row);}
    if(!list.children.length){const empty=document.createElement('p');empty.className='mini-hint';empty.textContent='No server media found.';list.append(empty);}
  }catch(error){if(generation===mediaAuditGeneration)status.textContent=error.message;}
}
async function loadMediaTrash(reset=false){const generation=++mediaAuditGeneration,offset=reset?0:mediaAuditNext;if(offset===null)return;const list=$('mediaAuditList'),status=$('mediaAuditStatus'),more=$('mediaAuditMore');if(reset)list.replaceChildren();more.hidden=true;status.textContent='Loading media trash…';try{const result=await request('/api/assets/trash?'+new URLSearchParams({offset:String(offset),limit:'100'}));if(generation!==mediaAuditGeneration)return;mediaAuditNext=result.next_offset;more.hidden=mediaAuditNext===null;status.textContent=result.total+' trash item(s). Restoring never overwrites active media; deleting forever cannot be undone.';for(const item of result.items){const row=document.createElement('div'),detail=document.createElement('div'),title=document.createElement('strong'),summary=document.createElement('small');row.className='project-item';title.textContent=item.name||item.id;summary.textContent=item.damaged?'Damaged entry; needs manual recovery.':(item.bytes/1024/1024).toFixed(2)+' MiB · moved '+new Date(item.trashed_at).toLocaleString();detail.append(title,summary);row.append(detail);if(!item.damaged){const actions=document.createElement('div'),restore=document.createElement('button'),purge=document.createElement('button'),clearProxy=document.createElement('button');restore.className='tiny-button';restore.textContent='Restore';purge.className='project-delete';purge.textContent='Delete forever';clearProxy.className='tiny-button';clearProxy.textContent='Remove preview';clearProxy.addEventListener('click',async()=>{clearProxy.disabled=true;try{const result=await request('/api/proxies/'+item.id,{method:'DELETE'});status.textContent=result.removed?'Optimized preview removed.':'No optimized preview remains.';}catch(error){status.textContent=error.message;}finally{clearProxy.disabled=false;}});restore.addEventListener('click',async()=>{restore.disabled=purge.disabled=true;try{const result=await request('/api/assets/trash/'+item.id+'/restore',{method:'POST'});await loadMediaTrash(true);if(result.cleanup_warning)status.textContent=result.cleanup_warning;}catch(error){status.textContent=error.message;restore.disabled=purge.disabled=false;}});purge.addEventListener('click',async()=>{if(!confirm(`Permanently delete “${item.name}”? This cannot be undone.`))return;restore.disabled=purge.disabled=true;try{await request('/api/assets/trash/'+item.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true})});await loadMediaTrash(true);}catch(error){status.textContent=error.message;restore.disabled=purge.disabled=false;}});actions.append(restore,clearProxy,purge);row.append(actions);}list.append(row);}if(!list.children.length){const empty=document.createElement('p');empty.className='mini-hint';empty.textContent='Media trash is empty.';list.append(empty);}}catch(error){if(generation===mediaAuditGeneration)status.textContent=error.message;}}
$('auditMediaBtn').addEventListener('click',()=>{mediaAuditView='audit';$('mediaAuditToggle').textContent='View trash';mediaAuditNext=0;if(!$('mediaAuditDialog').open)$('mediaAuditDialog').showModal();void loadMediaAudit(true);});
$('mediaAuditToggle').addEventListener('click',()=>{mediaAuditView=mediaAuditView==='audit'?'trash':'audit';$('mediaAuditToggle').textContent=mediaAuditView==='audit'?'View trash':'View media';mediaAuditNext=0;void(mediaAuditView==='audit'?loadMediaAudit(true):loadMediaTrash(true));});
$('mediaAuditMore').addEventListener('click',()=>void(mediaAuditView==='audit'?loadMediaAudit():loadMediaTrash()));
function hasPotentialAudio() {
  return state.audioClips.some(clip=>!state.audioTracks.find(track=>track.id===clip.trackId)?.muted) ||
    state.clips.some(clip=>asset(clip.assetId)?.kind==='video' && !state.videoTracks.find(track=>track.id===clip.trackId)?.muted);
}
function formatSupport(preferred = 'auto') {
  if (!window.MediaRecorder || !canvas.captureStream) return null;
  const audio=$('exportAudio').value!=='mute' && hasPotentialAudio();
  const choices = [
    ...(audio ? [
      { mime:'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension:'mp4', label:'MP4', audio:true },
      { mime:'video/mp4;codecs=avc1.42E01E,opus', extension:'mp4', label:'MP4', audio:true, convertAudio:true }
    ] : [{ mime:'video/mp4;codecs=avc1.42E01E', extension:'mp4', label:'MP4', audio:false }]),
    { mime:'video/webm;codecs=vp8,opus', extension:'webm', label:'WebM' },
    { mime:'video/webm;codecs=vp9,opus', extension:'webm', label:'WebM' },
    { mime:'video/webm', extension:'webm', label:'WebM' }
  ];
  return choices.find(choice => (preferred === 'auto' || choice.extension === preferred) && MediaRecorder.isTypeSupported(choice.mime)) || null;
}
function updateExportFormat() {
  const offline=$('exportMode').value==='offline',busy=recording||exportPreparing;$('exportMode').disabled=busy;$('exportAudio').disabled=busy;$('exportFormatChoice').disabled=offline||busy;
  $('exportModeHint').textContent=offline?'The server renders a WebM frame by frame. It may take longer and use more memory. Supports projects up to 10 minutes with normal-speed audio and video and still JPEG, PNG or WebP images.':'Keep this tab open and in the foreground. Real-time export may drop frames if rendering is slow; choose Every frame for supported projects when consistent frames matter.';
  if(offline){$('exportFormat').textContent='WebM · every frame · requires optional server rendering dependencies';$('startExportBtn').disabled=busy;$('sharedExportBtn').disabled=busy;return;}
  const format = formatSupport($('exportFormatChoice').value);
  $('exportFormat').textContent = format ? `${format.label} · available in this browser` : 'The selected format is not available in this browser.';
  $('startExportBtn').disabled = busy || !format; $('sharedExportBtn').disabled = busy || !format;
}
function showExport() {
  if(proxyBusy)return notify('Wait for optimized preview generation to finish.');if (!totalDuration() || recording) return;
  $('exportSummary').textContent = `${state.aspect} · ${state.quality} · ${seconds(totalDuration())}`;
  updateExportFormat(); $('exportProgressWrap').classList.add('hidden'); $('exportDialog').showModal();
}
async function exportEveryFrame(){
  if(recording||exportPreparing)return;const shared=exportToShared;exportToShared=false;
  const generation=++exportGeneration,controller=new AbortController();offlineExportAbort=controller;exportPreparing=true;cancelRecording=false;exportFailure='';exportWarning='';
  updateExportFormat();$('exportCancelBtn').textContent='Cancel export';$('exportProgressWrap').classList.remove('hidden');$('exportProgress').style.width='0%';$('exportStatus').textContent='Waiting for the server to render every frame…';
  try{
    stopPlayback();const snapshot=clone(state),name=(snapshot.name.trim().replace(/[\\/:*?"<>|]+/g,'-')||'cliproom-video')+'.webm';
    const response=await fetch('/api/render',{method:'POST',headers:{'Content-Type':'application/json','X-Cliproom-Request':'1'},body:JSON.stringify({project:snapshot,render_mode:'offline',include_audio:$('exportAudio').value!=='mute'}),signal:controller.signal});
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.error||`Render failed (${response.status}).`);}
    $('exportStatus').textContent='Receiving the finished video…';const blob=await response.blob();
    if(controller.signal.aborted||generation!==exportGeneration)return;if(!blob.size)throw new Error('The server did not produce a video.');
    $('exportProgress').style.width='100%';$('exportDialog').close();
    if(shared&&window.RoomShared){const saved=await RoomShared.save(blob,name);if(saved)notify('Saved to shared files: '+saved);}
    else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notify('Your video is ready.');}
  }catch(error){if(generation!==exportGeneration||controller.signal.aborted)return;exportFailure=error.message||'Could not render the video.';$('exportStatus').textContent=exportFailure;notify(exportFailure,7000);}
  finally{if(offlineExportAbort===controller)offlineExportAbort=null;if(generation===exportGeneration){exportPreparing=false;$('exportCancelBtn').textContent='Cancel';updateExportFormat();render();}}
}
async function exportVideo(preferred = $('exportFormatChoice').value) {
  if($('exportMode').value==='offline')return exportEveryFrame();
  const format = formatSupport(preferred); if (!format || recording || exportPreparing) return;
  const shared = exportToShared; exportToShared = false;
  const generation = ++exportGeneration;
  let stream = null,convertAudio=null; exportFailure='';exportWarning='';realtimeRenderedFrames=0;
  exportPreparing = true; cancelRecording = false; updateExportFormat();
  $('exportCancelBtn').textContent = 'Cancel export'; $('exportProgressWrap').classList.remove('hidden');
  $('exportStatus').textContent = 'Preparing media…';
  try {
    if(format.convertAudio){try{const module=await import('/mp4-audio.js');module.prepareMp4Audio();convertAudio=module.convertMp4Audio;}catch{throw new Error('MP4 audio conversion requires the optional MCP dependencies. Install or update them, or choose WebM.');}}
    await prepareGradeMasks(state);await ensureAudio(); stopPlayback(); seek(0); renderFrame();
    await prepareExport();
    if (generation !== exportGeneration) return;
    stream = canvas.captureStream(30);
    realtimeCaptureTrack=stream.getVideoTracks()[0]||null;
    if(format.audio!==false && $('exportAudio').value!=='mute')for (const track of outputAudio.stream.getAudioTracks()) stream.addTrack(track);
    const chunks = [], exportDuration=totalDuration(); recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: state.quality === '1080p' ? 8000000 : 4500000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstart = () => { if (recording && !cancelRecording) try { realtimeCaptureTrack?.requestFrame?.(); } catch { /* automatic capture remains available */ } };
    recorder.onerror = () => { exportFailure='Export failed in this browser.';cancelRecording = true; notify(exportFailure, 7000); };
    recorder.onstop = async () => {
      recording = false; exportPreparing=!!convertAudio && !cancelRecording;
      stream.getVideoTracks().forEach(track => track.stop());
      realtimeCaptureTrack=null;recorder = null; render();
      try { if (!cancelRecording && chunks.length) {
        // This counts completed canvas draws, not encoded frames. A severe
        // shortfall is a warning, not a claim about the exact encoded count.
        const targetFrames=Math.round(exportDuration*30);
        if(targetFrames>=15&&realtimeRenderedFrames<targetFrames*.7)exportWarning='Real-time rendering was too slow and the video may be missing frames. Try Every frame export for supported projects.';
        let blob = new Blob(chunks, { type: format.mime });const name = (state.name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'cliproom-video') + '.' + format.extension;
        if(convertAudio){$('exportStatus').textContent='Encoding MP4 audio…';blob=await convertAudio(blob);if(cancelRecording || generation!==exportGeneration)return;}
        if(format.extension==='webm')try{blob=await RoomWebM.withDuration(blob,exportDuration);}catch(error){notify('The video is ready, but its duration metadata could not be added.',7000);}
        $('exportDialog').close();
        if (shared && window.RoomShared) { try { const path=await RoomShared.save(blob,name); if(path)notify('Saved to shared files: '+path+(exportWarning?' · '+exportWarning:''),exportWarning?12000:4000); } catch(error) { notify(error.message,7000); } }
        else { const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notify(exportWarning?'Video ready. '+exportWarning:'Your video is ready.',exportWarning?12000:4000); }
      } else if (!cancelRecording) {exportFailure='The browser did not produce a video. Try Every frame export for supported projects, or choose another format.';$('exportStatus').textContent=exportFailure;notify(exportFailure, 7000);}
      } catch(error) {exportFailure=error.message||'MP4 audio conversion failed.';$('exportStatus').textContent=exportFailure;notify(exportFailure,7000);}
      finally {if(generation===exportGeneration){exportPreparing=false;updateExportFormat();$('exportCancelBtn').textContent='Cancel';render();}}
    };
    const started = await startPlayback(true, () => { exportPreparing = false; recording = true; recorder.start(1000); renderFrame(); });
    if (!started) { stream.getVideoTracks().forEach(track => track.stop()); realtimeCaptureTrack=null;recorder = null; }
  } catch (error) {
    if (stream && (!recorder || recorder.state === 'inactive')) {stream.getVideoTracks().forEach(track => track.stop());realtimeCaptureTrack=null;}
    if (generation !== exportGeneration) return;
    exportPreparing = false; updateExportFormat(); $('exportCancelBtn').textContent = 'Cancel';
    cancelRecording = true; if (recorder && recorder.state !== 'inactive') recorder.stop(); else recording = false;
    stopPlayback(); exportFailure=error.message || 'Could not start export.'; $('exportStatus').textContent = exportFailure; notify(exportFailure, 7000);
  }
}

document.addEventListener('pointerdown', event => {
  const pendingClipId = audioGesture.pendingClipId(); if (!pendingClipId) return;
  const audio = event.target.closest?.('.audio-clip');
  if (!audio || audio.dataset.audioId !== pendingClipId) cancelAudioClick();
});
$('importBtn').addEventListener('click', () => $('fileInput').click()); $('emptyImportBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => importFiles([...e.target.files]));
$('clipColorMaskInput').addEventListener('change',async event=>{
  const file=event.target.files[0],pending=pendingClipMask;event.target.value='';pendingClipMask=null;if(!file||!pending)return;let image;
  try{
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Choose a PNG, JPEG or WebP mask up to 20 MiB.');
    image=await createImageBitmap(file);const mask=ClipRegionGrade.fromImage(image,pending.channel),item=state.clips.find(clip=>clip.id===pending.clipId),source=item&&asset(item.assetId);
    if(projectId!==pending.projectId||selected?.type!=='clip'||selected.id!==pending.clipId||!item||recording||exportPreparing)throw new Error('The selection changed. Choose the mask again.');
    if(!ClipRegionGrade.compatible(mask.width,mask.height,source?.width,source?.height))throw new Error('The mask must match the source picture’s aspect ratio.');
    const clips=state.clips.map(clip=>clip===item?{...clip,gradeMask:mask}:clip);ClipRegionGrade.validateProject(clips);
    if(new TextEncoder().encode(JSON.stringify({baseRevision:revision,state:{...state,clips}})).length>2*1024*1024)throw new Error('This mask would exceed the 2 MiB project save limit. Use a simpler mask.');
    change(()=>{item.gradeMask=mask;});notify('Color region added.');
  }catch(error){notify(error.message||'Could not import this color mask.',7000);}finally{image?.close();}
});
$('projectName').addEventListener('change', e => { const name = e.target.value.trim() || 'Untitled story'; change(() => { state.name = name; }); });
$('undoBtn').addEventListener('click', () => applyHistory('undo')); $('redoBtn').addEventListener('click', () => applyHistory('redo'));
$('saveBtn').addEventListener('click', () => saveProject()); $('openBtn').addEventListener('click', showProjects);
$('saveCopyBtn').addEventListener('click', () => saveProject(true));
$('importPackageBtn').addEventListener('click',()=>{if(mediaBusy||recording||exportPreparing||saveInProgress)return;if(dirty&&!confirm('You have unsaved changes. Import a package and open it anyway?'))return;$('packageInput').click();});
$('packageInput').addEventListener('change',async event=>{const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>256*1024*1024)return $('projectsStatus').textContent='Project packages are limited to 256 MiB.';const before=JSON.stringify(state),oldId=projectId,id=uid();mediaBusy=true;$('importPackageBtn').disabled=true;$('projectsStatus').textContent='Importing project and verifying media…';try{const result=await request('/api/packages/import?'+new URLSearchParams({project_id:id}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});if(JSON.stringify(state)===before&&projectId===oldId){setState(result.project.state,result.project.id,result.project.revision);$('projectsDialog').close();notify('Project package imported as a new project.');}else{await loadProjectList();$('projectsStatus').textContent='Package imported as a new project. Your current unsaved timeline remains open.';}}catch(error){$('projectsStatus').textContent=error.message;}finally{mediaBusy=false;$('importPackageBtn').disabled=false;}});
$('newProjectBtn').addEventListener('click', () => { if (dirty && !confirm('You have unsaved changes. Start a new project anyway?')) return; setState(emptyState(), uid(), 0); $('projectsDialog').close(); });
$('playBtn').addEventListener('click', async () => { if (playing) stopPlayback(); else try { await startPlayback(); } catch (e) { stopPlayback(); notify(e.message); } });
$('startBtn').addEventListener('click', () => { stopPlayback(); seek(0); }); $('endBtn').addEventListener('click', () => { stopPlayback(); seek(totalDuration()); });
$('prevFrameBtn').addEventListener('click', () => { stopPlayback(); seek(currentTime - 1/30); });
$('nextFrameBtn').addEventListener('click', () => { stopPlayback(); seek(currentTime + 1/30); });
$('videoTarget').addEventListener('change', e => { videoTarget = e.target.value; });
$('audioTarget').addEventListener('change', e => { audioTarget = e.target.value; });
$('audioOptionsSelect').addEventListener('change', e => {
  const clip = state.audioClips.find(item => item.id === e.target.value);
  if (clip) { cancelAudioClick(); selectAudio(clip.id, clip.start); }
});
function addTrack(kind) {
  change(() => {
    const tracks = kind === 'video' ? state.videoTracks : state.audioTracks, prefix = kind === 'video' ? 'Video' : 'Audio';
    let n = 1; while (tracks.some(t => t.name === `${prefix} ${n}`)) n++;
    const track = { id: uid(), name: `${prefix} ${n}`, muted:false, ...(kind === 'video' ? { hidden:false } : {}) }; tracks.push(track);
    if (kind === 'video') videoTarget = track.id; else audioTarget = track.id;
  });
  notify(`New ${kind} track ready. Imported media will be added there.`);
}
$('addVideoTrackBtn').addEventListener('click', () => addTrack('video'));
$('addAudioTrackBtn').addEventListener('click', () => addTrack('audio'));
$('addTitleBtn').addEventListener('click', () => change(() => { const total = totalDuration(), start = Math.min(currentTime, Math.max(0, total - 0.1)); const title = { id:uid(), text:'Your title here', start, end:Math.min(total, start + 3), position:'middle', x:50, y:50, width:84, rotation:0, font:'sans-serif', bold:true, italic:false, size:6, color:'#ffffff' }; state.titles.push(title); selected = { type:'title', id:title.id }; }));
function addSubtitles(result,offset=0,clip=false){if(recording||exportPreparing)throw new Error('Wait for the current export to finish.');const built=ClipSubtitles.titles(result.cues,{duration:totalDuration(),offset,clip},uid);if(state.titles.length+built.titles.length>1000||state.titles.filter(item=>item.subtitle===true).length+built.titles.length>ClipSubtitles.maxCues)throw new Error('A project supports up to 500 subtitles and 1,000 total titles.');const candidate={...state,titles:[...state.titles,...built.titles]};if(new TextEncoder().encode(JSON.stringify({baseRevision:revision,state:candidate})).length>2*1024*1024)throw new Error('Subtitles would exceed the project save limit.');change(()=>{state.titles.push(...built.titles);selected={type:'title',id:built.titles[0].id};currentTime=built.titles[0].start;});const warnings=[...new Set([...(result.warnings||[]),...built.warnings,...(ClipSubtitles.overlap(candidate.titles)?['Overlapping subtitles may overlap visually.']:[])])];$('subtitleStatus').textContent='Added '+built.titles.length+' editable subtitle(s). '+warnings.join(' ');}
async function importSubtitles(file){if(!file)return;try{if(file.size>ClipSubtitles.maxBytes)throw new Error('Subtitle files must be 512 KiB or smaller.');const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),offset=Number($('subtitleOffset').value);addSubtitles(ClipSubtitles.parse(text),offset,$('subtitleClip').checked);}catch(error){$('subtitleStatus').textContent=error.message;}}
$('subtitlesBtn').addEventListener('click',()=>{if(recording||exportPreparing)return;$('subtitleStart').value=currentTime.toFixed(3);$('subtitleEnd').value=totalDuration().toFixed(3);$('subtitleStatus').textContent=totalDuration()?'':'Add media to the timeline first.';$('subtitleShared').hidden=!window.RoomShared;refreshSpeechOptions();if(!$('subtitlesDialog').open)$('subtitlesDialog').showModal();if($('speechDetails').open)void refreshSpeechStatus();});
$('subtitleImport').addEventListener('click',()=>$('subtitleFile').click());$('subtitleFile').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';void importSubtitles(file);});
$('subtitleShared').addEventListener('click',async()=>{try{const path=await RoomShared.choosePath(['.srt','.vtt']);if(path)await importSubtitles(await RoomShared.get(path,{maxBytes:ClipSubtitles.maxBytes}));}catch(error){$('subtitleStatus').textContent=error.message;}});
$('subtitleGenerate').addEventListener('click',()=>{try{const start=Number($('subtitleStart').value),end=Number($('subtitleEnd').value);addSubtitles(ClipSubtitles.generate($('subtitleText').value,start,end));}catch(error){$('subtitleStatus').textContent=error.message;}});
let speechController=null,speechResult=null,speechBasis=null,speechReady=false;
function speechClip(){return [...state.audioClips,...state.clips].find(item=>item.id===$('speechClip').value);}
function speechSnapshot(item){return JSON.stringify({id:item.id,assetId:item.assetId,start:item.start,in:item.in,out:item.out,rate:T.rate(item)});}
function speechControls(){const busy=!!speechController;$('speechInstall').hidden=speechReady;$('speechInstall').disabled=busy;$('speechStart').disabled=busy||!speechReady||!speechClip();$('speechClip').disabled=busy;$('speechLanguage').disabled=busy;$('speechCancel').hidden=!busy;$('speechAdd').disabled=busy||!speechResult;}
function clearSpeech(){speechResult=null;speechBasis=null;$('speechPreview').value='';speechControls();}
function refreshSpeechOptions(){const input=$('speechClip'),previous=input.value,items=[...state.audioClips,...state.clips].filter(item=>['audio','video'].includes(asset(item.assetId)?.kind));input.replaceChildren();for(const item of items){const option=document.createElement('option');option.value=item.id;option.textContent=(asset(item.assetId)?.name||'Media')+' · '+seconds(item.start);input.append(option);}const preferred=items.find(item=>item.id===selected?.id)?.id||previous;if(items.some(item=>item.id===preferred))input.value=preferred;clearSpeech();}
async function refreshSpeechStatus(){try{const result=await request('/api/speech/model');speechReady=!!result.installed;if(!speechController)$('speechModelStatus').textContent=result.installed?'Local speech model ready.':result.invalid?'The installed model is damaged; see the Cliproom guide before reinstalling.':result.downloading?'A device is downloading the model…':'Download the model once to enable local transcription.';speechControls();return result;}catch(error){speechReady=false;if(!speechController)$('speechModelStatus').textContent=error.message;speechControls();return null;}}
$('speechDetails').addEventListener('toggle',()=>{if($('speechDetails').open)void refreshSpeechStatus();});
for(const id of ['speechClip','speechLanguage'])$(id).addEventListener('change',clearSpeech);
$('speechInstall').addEventListener('click',async()=>{if(speechController)return;const controller=new AbortController();speechController=controller;speechControls();$('speechModelStatus').textContent='Downloading the verified speech engine and model…';const poll=setInterval(async()=>{try{const info=await request('/api/speech/model');if(speechController===controller&&info.downloading)$('speechModelStatus').textContent='Downloading local model: '+Math.min(100,Math.floor(100*info.downloaded/info.bytes))+'%';}catch{}},1000);let failure='';try{await request('/api/speech/model',{method:'POST',signal:controller.signal});}catch(error){failure=controller.signal.aborted?'Model download cancelled.':error.message;}finally{clearInterval(poll);if(speechController===controller)speechController=null;await refreshSpeechStatus();if(failure)$('speechModelStatus').textContent=failure;}});
$('speechStart').addEventListener('click',async()=>{if(speechController||!speechReady)return;const item=speechClip(),source=item&&asset(item.assetId);if(!item||!source)return;clearSpeech();const basis=speechSnapshot(item),controller=new AbortController();speechController=controller;speechControls();try{const result=await ClipSpeech.recognize({clip:clone(item),asset:clone(source),language:$('speechLanguage').value,signal:controller.signal,onProgress:message=>{$('speechModelStatus').textContent=message;}});speechResult=result;speechBasis=basis;$('speechPreview').value=result.cues.map(cue=>seconds(cue.start)+' – '+seconds(cue.end)+'  '+cue.text).join('\n');$('speechModelStatus').textContent='Review the recognized text and timing, then add the subtitles.';}catch(error){$('speechModelStatus').textContent=controller.signal.aborted?'Transcription cancelled.':error.message;}finally{if(speechController===controller)speechController=null;speechControls();}});
$('speechCancel').addEventListener('click',()=>speechController?.abort());
$('speechAdd').addEventListener('click',()=>{const item=speechClip();if(!item||!speechResult||speechSnapshot(item)!==speechBasis){clearSpeech();return $('speechModelStatus').textContent='The clip changed. Transcribe it again.';}try{addSubtitles(speechResult);clearSpeech();$('speechModelStatus').textContent='Editable subtitles added; review their timing and words on the timeline.';}catch(error){$('speechModelStatus').textContent=error.message;}});
$('subtitlesDialog').addEventListener('close',()=>speechController?.abort());
for(const [id,format]of [['subtitleExportVtt','vtt'],['subtitleExportSrt','srt']])$(id).addEventListener('click',()=>{try{const result=ClipSubtitles.serialize(state.titles,format),url=URL.createObjectURL(new Blob([result.text],{type:format==='vtt'?'text/vtt':'text/plain'})),link=document.createElement('a');link.href=url;link.download=(state.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-').slice(0,120)||'subtitles')+'.'+format;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);$('subtitleStatus').textContent='Exported '+result.count+' subtitle(s). '+result.warnings.join(' ');}catch(error){$('subtitleStatus').textContent=error.message;}});
$('removeBtn').addEventListener('click', () => change(() => { if (!selected) return; if (selected.type === 'clip') state.clips = state.clips.filter(c => c.id !== selected.id); if (selected.type === 'title') state.titles = state.titles.filter(t => t.id !== selected.id); if (selected.type === 'audio') state.audioClips = state.audioClips.filter(c => c.id !== selected.id); selected = null; }));
$('duplicateBtn').addEventListener('click', () => change(() => {
  const item = selectedItem(); if (!item) return;
  const copy = { ...item, id: uid() };
  if (Array.isArray(item.keyframes)) copy.keyframes = item.keyframes.map(frame => ({ ...frame }));
  if (selected.type === 'clip' || selected.type === 'audio') { copy.start = T.end(item); delete copy.transitionFrom; (selected.type === 'clip' ? state.clips : state.audioClips).push(copy); currentTime = copy.start; }
  else state.titles.push(copy);
  selected = { type: selected.type, id: copy.id };
}));
$('splitBtn').addEventListener('click', () => {
  const item = selectedItem(); if (!item || !['clip', 'audio'].includes(selected.type)) return;
  let second = null;
  change(() => {
    second = T.split(state, item.id, selected.type === 'audio' ? 'audio' : 'video', currentTime, uid);
    if (second) selected = { type:selected.type, id:second.id };
  });
  if (!second) notify('Move the playhead inside the selected clip to split it.');
});
$('inspectorBody').addEventListener('click', e => {
  const item = selectedItem(); if (!item || !['clip', 'audio'].includes(selected?.type)) return;
  if(e.target.id==='importClipMask'&&selected.type==='clip'){pendingClipMask={projectId,clipId:item.id,channel:$('clipMaskChannel').value};$('clipColorMaskInput').click();return;}
  if(e.target.id==='removeClipMask'&&selected.type==='clip'){change(()=>{delete item.gradeMask;});notify('Color region removed.');return;}
  if (e.target.id === 'addKeyframeBtn') {
    if (currentTime < item.start || currentTime > T.end(item)) return notify('Move the playhead inside the selected clip first.');
    const time = Math.round(T.sourceAt(item, currentTime) * 1000) / 1000;
    const existing = (item.keyframes || []).findIndex(frame => Math.abs(frame.time - time) < .0005);
    if (existing >= 0) { keyframeClipId = item.id; keyframeIndex = existing; renderInspector(); return; }
    const values = T.animatedValues(item, currentTime);
    change(() => {
      item.keyframes ||= [];
      item.keyframes.push(selected.type === 'audio' ? { id:uid(), time, volume:values.volume } : { id:uid(), time, ...values });
      item.keyframes.sort((a,b) => a.time - b.time);
      keyframeClipId = item.id; keyframeIndex = item.keyframes.findIndex(frame => frame.time === time);
    });
    notify('Keyframe added. Adjust its values in the inspector.'); return;
  }
  if (e.target.id === 'deleteKeyframeBtn') {
    change(() => { if (item.keyframes) item.keyframes.splice(keyframeIndex, 1); keyframeIndex = Math.max(0, keyframeIndex - 1); }); return;
  }
  if(e.target.id==='captureCreativeKeyframe'){if(selected.type!=='clip')return;const frame=item.keyframes?.[keyframeIndex];if(!frame)return;const creativeLook=ClipLookFrames.snapshot(item.colorGrade?.look),candidate=clone(state),clip=candidate.clips.find(value=>value.id===item.id),target=clip?.keyframes?.[keyframeIndex];if(!target)return;target.creativeLook=creativeLook;candidate.version=5;if(new TextEncoder().encode(JSON.stringify({baseRevision:revision,state:candidate})).length>2*1024*1024)return notify('This keyframe would exceed the project save limit.',7000);change(()=>{frame.creativeLook=creativeLook;state.version=5;});notify('Creative look captured. LUTs remain fixed on the clip.');return;}
  if(e.target.id==='clearCreativeKeyframe'){const frame=item.keyframes?.[keyframeIndex];if(!frame?.creativeLook)return;change(()=>{delete frame.creativeLook;});notify('Captured creative look removed.');return;}
  if (e.target.id === 'gotoKeyframeBtn') {
    const frame = item.keyframes?.[keyframeIndex]; if (!frame) return;
    if (frame.time < item.in || frame.time > item.out) return notify('This keyframe is outside the current trim.');
    stopPlayback(); seek(item.start + (frame.time - item.in) / T.rate(item)); return;
  }
  if (e.target.id === 'placeAtPlayheadBtn') change(() => { item.start = currentTime; });
  if (e.target.id === 'resetColorBtn') { change(() => { RoomGrade.writeTarget(item,'clip',{},100,true,RoomGrade.Look.neutral); }); if(item.keyframes?.length)notify('Color keyframes remain; edit or remove them separately.',6000); }
  if (e.target.id === 'fitAudioBtn' && selected.type === 'audio') {
    const pictureEnd = Math.max(0, ...state.clips.map(T.end));
    if (!pictureEnd) return notify('Add a video or photo before fitting audio.');
    const rate = T.rateForDuration(item, pictureEnd);
    if (rate === null) return notify('Trim the audio first: fitting requires a speed between 0.5× and 4×.', 7000);
    change(() => { item.start = 0; item.rate = rate; item.fadeIn = Math.min(item.fadeIn || 0, T.length(item)); item.fadeOut = Math.min(item.fadeOut || 0, T.length(item)); currentTime = 0; });
    notify(`Audio fitted to the video at ${rate.toFixed(2)}×.`);
  }
  if (e.target.id === 'dissolveBtn') {
    let result;
    change(() => { result = T.dissolve(state, item.id, selected.type === 'audio' ? 'audio' : 'video', item.fadeIn || 1); if (result) currentTime = item.start; });
    notify(result ? `Transition added · ${result.duration.toFixed(1)} seconds.` : 'Add another clip earlier on this track first.');
  }
});
$('inspectorBody').addEventListener('change', e => {
  const id = e.target.id, value = e.target.value; let invalidDuration = false;
  if (id === 'keyframeSelect') { keyframeIndex = Number(value) || 0; renderInspector(); return; }
  if (id.startsWith('keyframe')) {
    const item = selectedItem(), frame = item?.keyframes?.[keyframeIndex];
    if (!item || !frame) return;
    let duplicateTime = false;
    change(() => {
      if (id === 'keyframeTime') {
        const source = asset(item.assetId), max = source?.kind === 'image' ? 3600 : number(source?.duration, 0);
        const time = clamp(number(value, frame.time), 0, max);
        if (item.keyframes.some(other => other !== frame && Math.abs(other.time - time) < .0005)) { duplicateTime = true; return; }
        frame.time = time; item.keyframes.sort((a,b) => a.time - b.time); keyframeIndex = item.keyframes.indexOf(frame);
      }
      const properties = { keyframeScale:['scale',.1,2,100], keyframeX:['x',-100,200,1], keyframeY:['y',-100,200,1], keyframeOpacity:['opacity',0,1,100],
        keyframeRotation:['rotation',-36000,36000,1], keyframeBrightness:['brightness',0,200,1], keyframeContrast:['contrast',0,200,1], keyframeSaturation:['saturation',0,200,1], keyframeVolume:['volume',0,1,100] };
      const spec = properties[id]; if (spec) frame[spec[0]] = clamp(number(value) / spec[3], spec[1], spec[2]);
      if(id.startsWith('keyframeGrade_')){const key=id.slice('keyframeGrade_'.length),range=RoomGrade.specs[key];if(RoomGrade.advanced.includes(key))frame[key]=clamp(number(value),range[0],range[1]);}
      if(id.startsWith('keyframeEffect_')){const key=id.slice('keyframeEffect_'.length),range=RoomGrade.Look.effectSpecs[key];if(range)frame[key]=clamp(number(value),range[0],range[1]);}
    });
    if (duplicateTime) { renderInspector(); notify('Choose a time that does not already have a keyframe.'); }
    return;
  }
  change(() => {
    const item = selectedItem(), total = totalDuration();
    if (id === 'projectAspect') state.aspect = value; if (id === 'projectQuality') state.quality = value;if(id==='projectBackground'&&/^#[0-9a-f]{6}$/i.test(value))state.background=value;
    if (!item) return;
    if (selected.type === 'clip' || selected.type === 'audio') {
      const source = asset(item.assetId), max = source.kind === 'image' ? 3600 : source.duration;
      const tracks = selected.type === 'clip' ? state.videoTracks : state.audioTracks;
      if (id === 'itemTrack' && tracks.some(t => t.id === value)) item.trackId = value;
      if (id === 'itemIn') item.in = clamp(number(value, item.in), 0, Math.max(0, item.out - .05));
      if (id === 'itemOut') item.out = clamp(number(value, item.out), item.in + .05, max);
      if (id === 'itemStart') item.start = clamp(number(value, item.start), 0, 86400);
      if (id === 'itemRate') item.rate = clamp(number(value, T.rate(item)), T.MIN_RATE, T.MAX_RATE);
      if (id === 'itemDuration') {
        const rate = T.rateForDuration(item, number(value));
        if (rate === null) { invalidDuration = true; return; }
        item.rate = rate;
      }
      if (id === 'itemVolume') item.volume = clamp(number(value) / 100, 0, 1);
      if (id === 'itemFadeIn') item.fadeIn = clamp(number(value, item.fadeIn), 0, T.length(item));
      if (id === 'itemFadeOut') item.fadeOut = clamp(number(value, item.fadeOut), 0, T.length(item));
      item.fadeIn = Math.min(item.fadeIn, T.length(item)); item.fadeOut = Math.min(item.fadeOut, T.length(item));
      if (selected.type === 'clip') {
        if (id === 'clipFit') item.fit = value;
        if (id === 'clipScale') item.scale = clamp(number(value) / 100, .1, 2);
        if (id === 'clipOpacity') item.opacity = clamp(number(value) / 100, 0, 1);
        if (id === 'clipX') item.x = clamp(number(value, item.x), -100, 200);
        if (id === 'clipY') item.y = clamp(number(value, item.y), -100, 200);
        if (id === 'clipRotation') item.rotation = T.normalizeRotation(number(value));
        if (id === 'clipFlip') item.flipX = e.target.checked;
        if (id === 'clipBrightness') item.brightness = clamp(number(value, 100), 0, 200);
        if (id === 'clipContrast') item.contrast = clamp(number(value, 100), 0, 200);
        if (id === 'clipSaturation') item.saturation = clamp(number(value, 100), 0, 200);
      }
    }
    if (selected.type === 'title') {
      if (id === 'titleText') item.text = value.slice(0, 240);
      if (id === 'titleStart') item.start = clamp(number(value, item.start), 0, Math.max(0, item.end - (item.subtitle ? .001 : .05)));
      if (id === 'titleEnd') item.end = clamp(number(value, item.end), item.start + (item.subtitle ? .001 : .05), Math.max(total, item.start + (item.subtitle ? .001 : .05)));
      if (id === 'titlePosition' && ['top','middle','bottom','custom'].includes(value)) { item.position = value; if (value !== 'custom') { item.x = 50; item.y = value === 'top' ? 18 : value === 'bottom' ? 82 : 50; } }
      if (id === 'titleX') { item.x = clamp(number(value, item.x), 0, 100); item.position = 'custom'; }
      if (id === 'titleY') { item.y = clamp(number(value, item.y), 0, 100); item.position = 'custom'; }
      if (id === 'titleColor') item.color = value;
      if (id === 'titleSize') item.size = clamp(number(value, 6), 2, 30);
      if (id === 'titleWidth') item.width = clamp(number(value, 84), 10, 100);
      if (id === 'titleFont' && TITLE_FONTS.some(font => font.id === value)) item.font = value;
      if (id === 'titleRotation') item.rotation = T.normalizeRotation(number(value));
      if (id === 'titleBold') item.bold = e.target.checked;
      if (id === 'titleItalic') item.italic = e.target.checked;
    }
  });
  if (invalidDuration) { renderInspector(); notify('Choose a duration that keeps speed between 0.5× and 4×.', 7000); }
});
$('zoomInBtn').addEventListener('click', () => { timelineZoom = Math.min(8, timelineZoom * 2); renderTimeline(); });
$('waveformBtn').addEventListener('click',()=>{showWaveforms=!showWaveforms;$('waveformBtn').setAttribute('aria-pressed',String(showWaveforms));$('waveformBtn').textContent=showWaveforms?'Hide waveforms':'Show waveforms';renderTimeline();if(showWaveforms){if(!state.audioClips.length&&!state.clips.some(clip=>asset(clip.assetId)?.kind==='video'))notify('Add an audio or video clip to see its waveform.');else void buildWaveforms();}});
$('zoomOutBtn').addEventListener('click', () => { timelineZoom = Math.max(1, timelineZoom / 2); renderTimeline(); });
$('zoomFitBtn').addEventListener('click', () => { timelineZoom = 1; $('timelineScroll').scrollLeft = 0; renderTimeline(); });
function stageItemAt(x, y, at) {
  for (const item of [...state.titles].reverse()) {
    if (at >= item.start && at < item.end && T.insideRotatedBox(x, y, titleLayout(item), item.rotation)) return { type:'title', item };
  }
  for (const track of [...state.videoTracks].reverse()) {
    if (track.hidden) continue;
    const visible = state.clips.filter(item => item.trackId === track.id && T.active(item, at)).sort(T.order).reverse();
    for (const item of visible) { const visual = { ...item, ...T.animatedValues(item, at) }; if (T.insideRotatedBox(x, y, videoLayout(visual), visual.rotation)) return { type:'clip', item }; }
  }
  return null;
}
$('canvasFrame').addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary || stageDrag || recording || exportPreparing || event.target.closest('#stageEmpty')) return;
  const rect = canvas.getBoundingClientRect(), onSelection = !!event.target.closest('#stageSelection');
  const resize = !!event.target.closest('.stage-resize'), rotate = !!event.target.closest('.stage-rotate');
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!rect.width || !rect.height || (!inside && !onSelection)) return;
  const px = (event.clientX - rect.left) / rect.width * canvas.width, py = (event.clientY - rect.top) / rect.height * canvas.height;
  const at = currentTime >= totalDuration() && totalDuration() > 0 ? Math.max(0, totalDuration() - .001) : currentTime;
  const existing = onSelection && ['title','clip'].includes(selected?.type) ? { type:selected.type, item:selectedItem() } : null;
  const hit = resize || rotate ? existing : (inside ? stageItemAt(px, py, at) : null) || existing;
  if (!hit?.item) return;
  const item = hit.item; selected = { type:hit.type, id:item.id }; stopPlayback(); render();
  if (hit.type === 'clip' && item.keyframes?.length) { notify('Use the keyframe controls in the inspector to change animated placement.'); return; }
  const centerX = rect.left + rect.width * number(item.x, 50) / 100, centerY = rect.top + rect.height * number(item.y, 50) / 100;
  stageDrag = { id:item.id, type:hit.type, pointerId:event.pointerId, before:JSON.stringify(state), mode:rotate ? 'rotate' : resize ? 'resize' : 'move', x:event.clientX, y:event.clientY,
    centerX, centerY, angle:Math.atan2(event.clientY - centerY, event.clientX - centerX),
    distance:Math.max(10, Math.hypot(event.clientX - centerX, event.clientY - centerY)),
    original:{ x:number(item.x, 50), y:number(item.y, 50), size:item.size, width:item.width, scale:number(item.scale, 1), rotation:T.normalizeRotation(item.rotation) }, rect, moved:false };
  $('canvasFrame').setPointerCapture(event.pointerId); event.preventDefault();
});
$('canvasFrame').addEventListener('pointermove', event => {
  if (!stageDrag || event.pointerId !== stageDrag.pointerId) return;
  const item = (stageDrag.type === 'title' ? state.titles : state.clips).find(entry => entry.id === stageDrag.id); if (!item) return;
  const dx = event.clientX - stageDrag.x, dy = event.clientY - stageDrag.y;
  if (Math.hypot(dx,dy) < 3 && !stageDrag.moved) return;
  stageDrag.moved = true;
  if (stageDrag.mode === 'move') {
    const low = stageDrag.type === 'clip' ? -100 : 0, high = stageDrag.type === 'clip' ? 200 : 100;
    item.x = clamp(stageDrag.original.x + dx / stageDrag.rect.width * 100, low, high);
    item.y = clamp(stageDrag.original.y + dy / stageDrag.rect.height * 100, low, high);
    if (stageDrag.type === 'title') item.position = 'custom';
  } else if (stageDrag.mode === 'rotate') {
    const angle = Math.atan2(event.clientY - stageDrag.centerY, event.clientX - stageDrag.centerX);
    let degrees = T.normalizeRotation(stageDrag.original.rotation + (angle - stageDrag.angle) * 180 / Math.PI);
    if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    item.rotation = Math.round(T.normalizeRotation(degrees) * 10) / 10;
  } else {
    const factor = Math.hypot(event.clientX - stageDrag.centerX, event.clientY - stageDrag.centerY) / stageDrag.distance;
    if (stageDrag.type === 'title') {
      item.size = Math.round(clamp(stageDrag.original.size * factor, 2, 30) * 10) / 10;
      item.width = Math.round(clamp(stageDrag.original.width * factor, 10, 100));
    } else item.scale = Math.round(clamp(stageDrag.original.scale * factor, .1, 2) * 1000) / 1000;
  }
  renderFrame();
});
$('canvasFrame').addEventListener('pointerup', event => {
  if (!stageDrag || event.pointerId !== stageDrag.pointerId) return; const before = stageDrag.before; stageDrag = null; commitPrevious(before);
});
$('canvasFrame').addEventListener('pointercancel', event => {
  if (!stageDrag || event.pointerId !== stageDrag.pointerId) return; state = JSON.parse(stageDrag.before); stageDrag = null; render();
});
$('exportBtn').addEventListener('click', showExport); $('exportMode').addEventListener('change', updateExportFormat); $('exportFormatChoice').addEventListener('change', updateExportFormat); $('exportAudio').addEventListener('change', updateExportFormat); $('startExportBtn').addEventListener('click', () => { exportToShared=false; exportVideo(); });
function updateFastColorButton(){$('fastColorBtn').setAttribute('aria-pressed',String(fastColorPreview));$('fastColorBtn').textContent='Fast color preview: '+(fastColorPreview?'on':'off');}
$('fastColorBtn').addEventListener('click',()=>{fastColorPreview=!fastColorPreview;try{localStorage.setItem('cliproom.fastColorPreview',fastColorPreview?'1':'0');}catch{}updateFastColorButton();renderFrame();notify(fastColorPreview?'Fast color preview uses a smaller image while editing. Exports use full quality.':'Full-quality color preview restored.',6000);});updateFastColorButton();
if (window.RoomShared) {
  $('openSharedMedia').hidden=false; $('sharedExportBtn').hidden=false; $('openSharedMedia').classList.remove('hidden'); $('sharedExportBtn').classList.remove('hidden');
  $('openSharedMedia').addEventListener('click',async()=>{try{const file=await RoomShared.choose(['image/*','audio/*','video/*']);if(file)await importFiles([file]);}catch(error){notify(error.message,7000);}});
  $('sharedExportBtn').addEventListener('click',()=>{exportToShared=true;exportVideo();});
}
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.close === 'exportDialog' && (recording || exportPreparing)) {
    cancelRecording = true; if (exportPreparing) { offlineExportAbort?.abort(); exportGeneration++; exportPreparing = false; updateExportFormat(); }
    stopPlayback(); if (recorder && recorder.state !== 'inactive') recorder.stop();
  }
  $(button.dataset.close).close();
}));
$('exportDialog').addEventListener('cancel', e => { if (recording || exportPreparing) { e.preventDefault(); notify('Use Cancel export to stop the current render.'); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && (recording || exportPreparing)) { cancelRecording = true; if (exportPreparing) { offlineExportAbort?.abort(); exportGeneration++; exportPreparing = false; updateExportFormat(); } stopPlayback(); if (recorder && recorder.state !== 'inactive') recorder.stop(); notify('Export stopped because the tab was hidden. Keep it visible while exporting.', 7000); } });
document.addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector('dialog[open]')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); applyHistory(e.shiftKey ? 'redo' : 'undo'); }
  else if (e.code === 'Space') { e.preventDefault(); $('playBtn').click(); }
  else if (e.key === 'Delete' && selected) $('removeBtn').click();
  else if (['title','clip'].includes(selected?.type) && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault(); const item = selectedItem();
    if (selected.type === 'clip' && item?.keyframes?.length) return notify('Use the keyframe controls in the inspector to change animated placement.');
    const step = e.shiftKey ? 5 : 1, low = selected.type === 'clip' ? -100 : 0, high = selected.type === 'clip' ? 200 : 100;
    change(() => { if (e.key === 'ArrowLeft') item.x = clamp(item.x - step, low, high); if (e.key === 'ArrowRight') item.x = clamp(item.x + step, low, high); if (e.key === 'ArrowUp') item.y = clamp(item.y - step, low, high); if (e.key === 'ArrowDown') item.y = clamp(item.y + step, low, high); if (selected.type === 'title') item.position = 'custom'; });
  }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stopPlayback(); seek(currentTime + (e.key === 'ArrowRight' ? 1/30 : -1/30)); }
});
window.addEventListener('resize', () => { renderTimeline(); updateStageSelection(); }); window.addEventListener('beforeunload', e => { if (dirty || mediaBusy || recording || exportPreparing || proxyBusy) { e.preventDefault(); e.returnValue = ''; } });
render();

// A room may explicitly upload media and open a new Cliproom tab with its ID.
// The asset remains in the normal Cliproom library; other open tabs are untouched.
async function importRoomHandoff() {
  const params = new URLSearchParams(location.search);
  const id = params.get('asset');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return;
  const suppliedDuration = Number(params.get('duration')),sourceId=params.get('source_asset'),processing=params.get('processing'),audioId=params.get('audio_asset');
  window.history.replaceState(null, '', location.pathname);
  mediaBusy = true; $('importBtn').disabled = true; $('emptyImportBtn').disabled = true;
  try {
    notify('Opening media from your other room…', 30000);
    const uploaded = await request('/api/assets/' + id + '/metadata');
    const kind = uploaded.type.startsWith('audio/') ? 'audio' : uploaded.type.startsWith('video/') ? 'video' : uploaded.type.startsWith('image/') ? 'image' : null;
    if (!kind) throw new Error('This media type is not supported.');
    let info;
    if (kind === 'image') {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('The image could not be opened.')); image.src = '/api/assets/' + id; });
      info = { duration: 5, width: image.naturalWidth, height: image.naturalHeight };
    } else {
      const media = document.createElement(kind);
      media.preload = 'metadata';
      info = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Reading this media timed out.')), 20000);
        media.onloadedmetadata = () => {
          clearTimeout(timer);
          const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : suppliedDuration;
          if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) reject(new Error('The media duration could not be read.'));
          else resolve({ duration, width: media.videoWidth || 0, height: media.videoHeight || 0 });
        };
        media.onerror = () => { clearTimeout(timer); reject(new Error('Your browser cannot decode this recording.')); };
        media.src = '/api/assets/' + id;
      });
      media.removeAttribute('src'); media.load();
    }
    let linked=null,sourceAsset=null;if(sourceId||processing){if(kind!=='audio'||!sourceId||!processing||processing.length>4096)throw new Error('The editable SoundRoom handoff is invalid.');let parsed;try{parsed=JSON.parse(processing);}catch{throw new Error('The editable SoundRoom settings are invalid.');}linked=SoundSettings.link({sourceAssetId:sourceId,processing:parsed});if(sourceId===id)throw new Error('The editable source must be separate from the processed audio.');const sourceMeta=await request('/api/assets/'+sourceId+'/metadata');if(!sourceMeta.type.startsWith('audio/'))throw new Error('The editable SoundRoom source is not audio.');const probe=document.createElement('audio');probe.preload='metadata';const sourceDuration=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Reading the editable source timed out.')),20000);probe.onloadedmetadata=()=>{clearTimeout(timer);resolve(probe.duration);};probe.onerror=()=>{clearTimeout(timer);reject(new Error('The editable source cannot be decoded.'));};probe.src='/api/assets/'+sourceId;});probe.removeAttribute('src');probe.load();if(!Number.isFinite(sourceDuration)||Math.abs(sourceDuration-info.duration)>.05)throw new Error('The editable source duration does not match the processed audio.');sourceAsset={...sourceMeta,duration:sourceDuration,width:0,height:0,kind:'audio'};}
    let accompanyingAudio=null;if(audioId){if(kind!=='video'||audioId===id||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(audioId))throw new Error('The accompanying audio handoff is invalid.');const meta=await request('/api/assets/'+audioId+'/metadata');if(!meta.type.startsWith('audio/'))throw new Error('The accompanying asset is not audio.');const probe=document.createElement('audio');probe.preload='metadata';const duration=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Reading the accompanying audio timed out.')),20000);probe.onloadedmetadata=()=>{clearTimeout(timer);resolve(probe.duration);};probe.onerror=()=>{clearTimeout(timer);reject(new Error('The accompanying audio cannot be decoded.'));};probe.src='/api/assets/'+audioId;});probe.removeAttribute('src');probe.load();if(!Number.isFinite(duration)||duration<=0||duration>86400)throw new Error('The accompanying audio duration is invalid.');accompanyingAudio={...meta,duration,width:0,height:0,kind:'audio'};}
    change(() => { if(sourceAsset&&!state.assets.some(item=>item.id===sourceAsset.id))state.assets.push(sourceAsset);state.assets.push({ ...uploaded, ...info, kind });if(accompanyingAudio)state.assets.push(accompanyingAudio); });
    addMedia(uploaded.id,linked);
    if(accompanyingAudio){addMedia(accompanyingAudio.id);change(()=>{const clip=state.audioClips.findLast(item=>item.assetId===accompanyingAudio.id);if(clip){clip.out=Math.min(clip.out,info.duration);clip.volume=1;}});}
    notify(uploaded.name + (accompanyingAudio?' and its audio':'') + ' added to the timeline.');
  } catch (error) { notify('Could not open the media: ' + error.message, 8000); }
  finally { mediaBusy = false; $('importBtn').disabled = false; $('emptyImportBtn').disabled = false; }
}
const launchParams = new URLSearchParams(location.search);
if (launchParams.get('projects') === '1' && !launchParams.has('asset')) {
  window.history.replaceState(null, '', location.pathname);
  showProjects();
} else if (launchParams.has('shared_file') && window.RoomShared) {
  const isGrade=/\.roomgrade$/i.test(launchParams.get('shared_file')||'');
  RoomShared.fromQuery(isGrade?{maxBytes:RoomGrade.maxBytes}:{}).then(async file=>{if(!file)return;if(isGrade){await RoomGradeUI.importFile(file);notify('Preset imported. Select a clip to use it.',7000);}else await importFiles([file]);}).catch(error=>notify(error.message,7000));
} else importRoomHandoff();
