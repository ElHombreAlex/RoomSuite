import { Input, ALL_FORMATS, UrlSource, CanvasSink, Output, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality, canEncodeVideo, canEncodeAudio } from '/api/render/mediabunny.mjs';

// Render the same canvas composition at explicit timestamps, while mixing
// normal-speed audio offline. Retimed media uses the regular exporter to keep
// its pitch-preserving playback behavior.
export async function renderOffline({ project, timeline, canvas, prepareImages, renderAt }) {
  const fps = 30, duration = timeline.duration(project), rate = 48000;
  const videoQuality = new Quality({ bitrate:project.quality === '1080p' ? 8000000 : 4500000 });
  const audioQuality = new Quality({ bitrate:128000 });
  const tracks = new Map(project.audioTracks.map(track => [track.id, track]));
  const videoTracks = new Map(project.videoTracks.map(track => [track.id, track]));
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const audioClips = project.audioClips.filter(clip => !tracks.get(clip.trackId)?.muted);
  const videoClips = project.clips.filter(clip => assets.get(clip.assetId)?.kind === 'video');
  const inputs = new Map(), iterators = new Map();
  try {
  for (const clip of videoClips) {
    let info = inputs.get(clip.assetId);
    if (!info) {
      const url = new URL('/api/assets/' + encodeURIComponent(clip.assetId), location.href).href;
      const input = new Input({ formats:ALL_FORMATS, source:new UrlSource(url, { getRetryDelay:() => null }) });
      inputs.set(clip.assetId, { input });
      const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
      if (!video || !await video.canDecode()) throw new Error('This browser cannot decode a video for offline rendering. Use realtime mode.');
      info = { input, video, audio }; inputs.set(clip.assetId, info);
    }
    if (info.audio && !videoTracks.get(clip.trackId)?.muted) audioClips.push(clip);
    if (!videoTracks.get(clip.trackId)?.hidden) {
      const sink = new CanvasSink(info.video, { poolSize:1 });
      const timestamps = function* () {
        for (let frame = 0; frame < Math.ceil(duration * fps); frame++) {
          const at = frame / fps;
          if (timeline.active(clip, at)) yield timeline.sourceAt(clip, at);
        }
      };
      iterators.set(clip.id, sink.canvasesAtTimestamps(timestamps()));
    }
  }
  if (!await canEncodeVideo('vp8', { width:canvas.width, height:canvas.height, frameRate:fps, quality:videoQuality })) throw new Error('This browser cannot encode VP8 for offline rendering. Use realtime mode.');
  if (audioClips.length && !await canEncodeAudio('opus', { numberOfChannels:2, sampleRate:rate, quality:audioQuality })) throw new Error('This browser cannot encode Opus for offline rendering. Use realtime mode.');
  await prepareImages();
  let mixed = null;
  if (audioClips.length) {
    const audio = new OfflineAudioContext(2, Math.ceil(duration * rate), rate), decoded = new Map();
    for (const clip of audioClips) {
      if (!decoded.has(clip.assetId)) {
        const response = await fetch('/api/assets/' + encodeURIComponent(clip.assetId));
        if (!response.ok) throw new Error('Could not load audio for offline rendering.');
        try { decoded.set(clip.assetId, await audio.decodeAudioData(await response.arrayBuffer())); }
        catch { throw new Error('This audio cannot be decoded for offline rendering. Use realtime mode.'); }
      }
      const source = audio.createBufferSource(), gain = audio.createGain(), length = timeline.length(clip);
      source.buffer = decoded.get(clip.assetId); source.connect(gain); gain.connect(audio.destination);
      const steps = Math.max(1, Math.ceil(length * fps)), curve = new Float32Array(steps + 1);
      for (let i = 0; i <= steps; i++) {
        const at = Math.min(timeline.end(clip) - 1e-7, clip.start + length * i / steps);
        curve[i] = Math.max(0, Math.min(1, timeline.animatedValues(clip, at).volume * timeline.envelope(clip, at)));
      }
      gain.gain.setValueCurveAtTime(curve, clip.start, length);
      source.start(clip.start, clip.in, clip.out - clip.in);
    }
    mixed = await audio.startRendering();
  }
  const output = new Output({ format:new WebMOutputFormat(), target:new BufferTarget() });
  const video = new CanvasSource(canvas, { codec:'vp8', quality:videoQuality });
  output.addVideoTrack(video, { frameRate:fps });
  const audioSource = mixed ? new AudioBufferSource({ codec:'opus', quality:audioQuality }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  await Promise.all([
    (async () => {
      const frames = Math.ceil(duration * fps);
      for (let i = 0; i < frames; i++) {
        const at = i / fps, decodedFrames = new Map();
        for (const clip of videoClips) if (iterators.has(clip.id) && timeline.active(clip, at)) {
          const frame = await iterators.get(clip.id).next();
          if (frame.done || !frame.value) throw new Error('A video frame could not be decoded for offline rendering. Use realtime mode.');
          decodedFrames.set(clip.id, frame.value.canvas);
        }
        renderAt(at, decodedFrames);
        await video.add(at, Math.min(1 / fps, duration - at));
      }
      video.close();
    })(),
    (async () => { if (audioSource) { await audioSource.add(mixed); audioSource.close(); } })()
  ]);
  await output.finalize();
  if (!output.target.buffer?.byteLength) throw new Error('Offline rendering produced an empty video.');
  // Opus packet padding can make the muxed duration exceed the timeline by
  // one packet. Keep the container duration tied to the editable timeline.
  let blob = new Blob([output.target.buffer], { type:'video/webm' });
  try { blob = await RoomWebM.withDuration(blob, duration); } catch { /* Keep the browser's valid muxed file if its metadata cannot safely be changed. */ }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'cliproom.webm'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally { for (const { input } of inputs.values()) input.dispose(); }
}
