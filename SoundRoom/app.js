'use strict';
const $ = id => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const canvas = $('waveform'), ctx = canvas.getContext('2d');
let audioContext, buffer = null, title = 'audio', cursor = 0, selection = null, markers = [], undo = [];
let activeSource = null, animation = 0, playStart = 0, playOffset = 0, playEnd = 0, playSerial = 0;
let recorder = null, microphone = null, recordingChunks = [], pointerStart = null;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function context() { return audioContext || (audioContext = new (window.AudioContext || window.webkitAudioContext)()); }
function time(n) { n = Math.max(0, n || 0); return String(Math.floor(n / 60)).padStart(2, '0') + ':' + (n % 60).toFixed(1).padStart(4, '0'); }
function safeName(value) { return (value || 'audio').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'audio'; }
function settings() { return { gain: Number($('gain').value) / 100, fadeIn: Math.max(0, Number($('fadeIn').value) || 0), fadeOut: Math.max(0, Number($('fadeOut').value) || 0) }; }
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
  for (const id of ['play','export','normalize','selectAll','selectionStart','selectionEnd','playhead','split','send']) $(id).disabled = !has;
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
  try {
    status('Reading audio…'); stop();
    const data = await blob.arrayBuffer();
    const decoded = await context().decodeAudioData(data);
    if (!Number.isFinite(decoded.duration) || !decoded.length) throw new Error('This file has no audio.');
    buffer = decoded; title = safeName(name); cursor = 0; selection = null; markers = []; undo = [];
    $('gain').value = 100; $('gainValue').textContent = '100%'; $('fadeIn').value = 0; $('fadeOut').value = 0;
    $('openCliproom').classList.add('hidden'); status('Audio ready. Drag on the waveform to select a range.'); render();
  } catch (error) { status('Could not open this audio: ' + error.message, true); }
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
  buffer = next; cursor = 0; selection = null; markers = []; render(); status('Edit applied. You can undo it.');
}
function partRange() {
  if (selection) return selection;
  const boundaries = [0, ...markers, buffer.duration];
  const index = boundaries.findIndex((n, i) => i < boundaries.length - 1 && cursor >= n && cursor < boundaries[i + 1]);
  return index >= 0 ? [boundaries[index], boundaries[index + 1]] : [boundaries[boundaries.length - 2], buffer.duration];
}
function makeWav(range) {
  const [start, end] = range, rate = buffer.sampleRate, channels = buffer.numberOfChannels;
  const first = Math.floor(start * rate), last = Math.min(buffer.length, Math.floor(end * rate)), frames = last - first;
  if (frames <= 0) throw new Error('Choose a longer selection.');
  const byteLength = 44 + frames * channels * 2;
  if (byteLength > 0x7fffffff) throw new Error('This audio is too large to export as one WAV.');
  const bytes = new ArrayBuffer(byteLength), view = new DataView(bytes);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  const source = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel)), s = settings(); let offset = 44;
  for (let i = 0; i < frames; i++) {
    const factor = envelope((first + i) / rate, buffer.duration, s);
    for (let channel = 0; channel < channels; channel++) {
      const sample = clamp(source[channel][first + i] * factor, -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
    }
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('audioFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) openBlob(file, file.name); event.target.value = ''; });
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
$('undo').addEventListener('click', () => { if (!undo.length) return; stop(); ({ buffer, cursor, selection, markers } = undo.pop()); render(); status('Edit undone.'); });
$('gain').addEventListener('input', () => { $('gainValue').textContent = $('gain').value + '%'; if (activeSource) stop(); });
for (const id of ['fadeIn','fadeOut']) $(id).addEventListener('change', stop);
$('normalize').addEventListener('click', () => {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const sample of buffer.getChannelData(ch)) peak = Math.max(peak, Math.abs(sample));
  if (peak < .000001) return status('This audio is silent, so there is nothing to normalize.', true);
  $('gain').value = String(Math.round(Math.min(3, .98 / peak) * 100)); $('gain').dispatchEvent(new Event('input')); status('Volume set for a peak near full scale.');
});
$('play').addEventListener('click', async () => {
  if (activeSource) { stop(); return; }
  if (!buffer) return;
  try {
    await context().resume();
    const [a,b] = selection || [cursor >= buffer.duration ? 0 : cursor, buffer.duration]; if (b <= a) return;
    const source = context().createBufferSource(), gain = context().createGain(), s = settings(), now = context().currentTime;
    source.buffer = buffer; source.connect(gain); gain.connect(context().destination);
    const points = [a, s.fadeIn, buffer.duration - s.fadeOut, buffer.duration * s.fadeIn / (s.fadeIn + s.fadeOut || 1), b].filter(t => t >= a && t <= b).sort((x,y) => x-y);
    gain.gain.setValueAtTime(envelope(a, buffer.duration, s), now);
    for (const t of points) if (t > a) gain.gain.linearRampToValueAtTime(envelope(t, buffer.duration, s), now + t - a);
    const serial = ++playSerial; activeSource = source; playOffset = a; playStart = now; playEnd = b; cursor = a;
    source.onended = () => { if (serial === playSerial) { cursor = playEnd; stop(); render(); } };
    source.start(now, a, b - a); $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pause');
    const tick = () => { if (serial !== playSerial) return; cursor = Math.min(playEnd, playOffset + context().currentTime - playStart); $('position').textContent = time(cursor); draw(); animation = requestAnimationFrame(tick); }; tick();
  } catch (error) { stop(); status('Playback failed: ' + error.message, true); }
});
$('export').addEventListener('click', () => { try { download(makeWav([0, buffer.duration]), title + '.wav'); status('WAV exported.'); } catch (error) { status(error.message, true); } });
$('exportPart').addEventListener('click', () => { try { download(makeWav(partRange()), title + '-part.wav'); status('Current part exported.'); } catch (error) { status(error.message, true); } });
$('send').addEventListener('click', async () => {
  try { $('send').disabled = true; status('Preparing WAV…'); await new Promise(resolve => setTimeout(resolve, 20)); const wav = makeWav([0, buffer.duration]); await RoomHandoff.send(wav, title + '.wav', buffer.duration, $('status'), $('openCliproom')); }
  catch (error) { status(error.message, true); } finally { $('send').disabled = !buffer; }
});
window.addEventListener('beforeunload', event => { if (buffer || recorder?.state === 'recording') { event.preventDefault(); event.returnValue = ''; } });
render();
