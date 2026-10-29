'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ClipTimeline = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const MIN_RATE = .5, MAX_RATE = 4;
  const rate = clip => Number.isFinite(clip.rate) && clip.rate > 0 ? clip.rate : 1;
  const length = clip => Math.max(0, clip.out - clip.in) / rate(clip);
  const end = clip => clip.start + length(clip);
  const limit = (n, low, high) => Math.min(high, Math.max(low, n));
  const active = (clip, time) => time >= clip.start && time < end(clip);
  const order = (a, b) => a.start - b.start || (a.transitionFrom === b.id ? 1 : b.transitionFrom === a.id ? -1 : 0);
  const sourceAt = (clip, time) => clip.in + limit(time - clip.start, 0, length(clip)) * rate(clip);
  function normalizeRotation(value) {
    const degrees = Number(value);
    return Number.isFinite(degrees) ? ((degrees + 180) % 360 + 360) % 360 - 180 : 0;
  }
  function insideRotatedBox(x, y, box, degrees) {
    const angle = normalizeRotation(degrees) * Math.PI / 180, dx = x - box.centerX, dy = y - box.centerY;
    const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
    const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(localX) <= box.width / 2 && Math.abs(localY) <= box.height / 2;
  }
  function rateForDuration(clip, duration) {
    const requested = (clip.out - clip.in) / duration;
    return Number.isFinite(requested) && requested >= MIN_RATE && requested <= MAX_RATE ? requested : null;
  }
  function createAudioClickGesture({ onCut, onOptions, schedule = setTimeout, clear = clearTimeout, delay = 550 }) {
    let pending = null;
    function cancel() { if (pending) clear(pending.timer); pending = null; }
    function click(clipId, time, x, y) {
      if (pending && pending.clipId === clipId && Math.hypot(pending.x - x, pending.y - y) <= 30) {
        cancel(); onOptions(clipId, time); return;
      }
      cancel();
      const entry = { clipId, time, x, y, timer:null };
      pending = entry;
      entry.timer = schedule(() => { if (pending !== entry) return; pending = null; onCut(clipId, time); }, delay);
    }
    return { click, cancel, pendingClipId:() => pending?.clipId || null };
  }
  const videoDefaults = clip => ({ rate:1, brightness:100, contrast:100, saturation:100, rotation:0, flipX:false, ...clip });
  const audioDefaults = clip => ({ rate:1, ...clip });
  function titleDefaults(title) {
    const y = title.position === 'top' ? 18 : title.position === 'bottom' ? 82 : 50;
    return { x:50, y, width:84, rotation:0, font:'sans-serif', bold:true, italic:false, ...title };
  }

  function empty(id) {
    return { version: 3, name: 'Untitled story', aspect: '16:9', quality: '720p',
      assets: [], videoTracks: [{ id: id(), name: 'Video 1', muted:false, hidden:false }], audioTracks: [{ id: id(), name: 'Audio 1', muted:false }],
      clips: [], audioClips: [], titles: [] };
  }
  function migrate(old, id) {
    if (!old || typeof old !== 'object') throw new Error('This project is invalid.');
    if (old.version === 2 || old.version === 3) {
      if (!Array.isArray(old.videoTracks) || !old.videoTracks.length || !Array.isArray(old.audioTracks) || !old.audioTracks.length ||
          !Array.isArray(old.clips) || !Array.isArray(old.audioClips) || !Array.isArray(old.titles) || !Array.isArray(old.assets)) {
        throw new Error('This project is missing timeline data.');
      }
      if (old.version === 3) return old;
      return { ...old, version:3,
        videoTracks:old.videoTracks.map(track => ({ muted:false, hidden:false, ...track })),
        audioTracks:old.audioTracks.map(track => ({ muted:false, ...track })),
        clips:old.clips.map(videoDefaults), audioClips:old.audioClips.map(audioDefaults), titles:old.titles.map(titleDefaults) };
    }
    if (old.version !== 1 || !Array.isArray(old.clips) || !Array.isArray(old.assets) || !Array.isArray(old.titles)) throw new Error('This project version is not supported.');
    const project = empty(id); let cursor = 0;
    project.name = old.name; project.aspect = old.aspect; project.quality = old.quality; project.assets = old.assets; project.titles = old.titles.map(titleDefaults);
    project.clips = old.clips.map(clip => {
      const result = videoDefaults({ ...clip, start: cursor, trackId: project.videoTracks[0].id, fadeIn: 0, fadeOut: 0, opacity: 1, scale: 1, x: 50, y: 50 });
      cursor += length(clip); return result;
    });
    if (old.music) {
      // Version 1 stopped the soundtrack at the picture's end. Keep that
      // audible range when it is opened in a multitrack project.
      const musicOut = Math.min(old.music.out, old.music.in + Math.max(0, cursor - old.music.start));
      if (musicOut > old.music.in) project.audioClips = [audioDefaults({ ...old.music, out: musicOut, id: id(), trackId: project.audioTracks[0].id, fadeIn: 0, fadeOut: 0 })];
    }
    return project;
  }
  function duration(project) {
    return Math.max(0, ...project.clips.map(end), ...project.audioClips.map(end));
  }
  function envelope(clip, time) {
    if (!active(clip, time)) return 0;
    const inside = time - clip.start, remaining = end(clip) - time;
    const fadeIn = Math.max(0, Number(clip.fadeIn) || 0), fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
    return Math.min(1, fadeIn ? limit(inside / fadeIn, 0, 1) : 1, fadeOut ? limit(remaining / fadeOut, 0, 1) : 1);
  }
  function visualOpacity(project, clip, time) {
    if (!active(clip, time)) return 0;
    const incoming = project.clips.find(next => next.transitionFrom === clip.id && next.trackId === clip.trackId &&
      next.fadeIn > 0 && active(next, time) && time < next.start + next.fadeIn && next.start < end(clip));
    const fadeIn = Math.max(0, Number(clip.fadeIn) || 0), fadeOut = Math.max(0, Number(clip.fadeOut) || 0);
    const inFactor = fadeIn ? limit((time - clip.start) / fadeIn, 0, 1) : 1;
    // The incoming picture is drawn over an opaque outgoing picture during a
    // dissolve. Fading both pictures to the canvas would introduce a dark dip.
    const outFactor = incoming ? 1 : fadeOut ? limit((end(clip) - time) / fadeOut, 0, 1) : 1;
    return limit(Number.isFinite(clip.opacity) ? clip.opacity : 1, 0, 1) * Math.min(inFactor, outFactor);
  }
  function dissolve(project, clipId, kind, requested = 1) {
    const clips = kind === 'audio' ? project.audioClips : project.clips;
    const current = clips.find(c => c.id === clipId);
    if (!current) return null;
    const previous = clips.filter(c => c.id !== current.id && c.trackId === current.trackId && c.start < current.start)
      .sort((a, b) => b.start - a.start)[0];
    if (!previous) return null;
    const overlap = Math.min(Math.max(0.05, requested), length(current), length(previous));
    if (overlap < 0.05) return null;
    current.start = end(previous) - overlap; current.fadeIn = overlap; previous.fadeOut = overlap;
    current.transitionFrom = previous.id;
    return { previous: previous.id, duration: overlap };
  }
  function split(project, clipId, kind, time, id) {
    const clips = kind === 'audio' ? project.audioClips : project.clips;
    const clip = clips.find(item => item.id === clipId);
    if (!clip || time - clip.start < .05 || end(clip) - time < .05) return null;
    const splitAt = sourceAt(clip, time);
    const next = { ...clip, id:id(), start:time, in:splitAt, fadeIn:0 };
    delete next.transitionFrom;
    clip.out = splitAt; clip.fadeOut = 0; clip.fadeIn = Math.min(clip.fadeIn || 0, length(clip)); next.fadeOut = Math.min(next.fadeOut || 0, length(next));
    for (const later of clips) if (later.transitionFrom === clip.id) later.transitionFrom = next.id;
    clips.push(next); return next;
  }
  return { MIN_RATE, MAX_RATE, rate, rateForDuration, sourceAt, normalizeRotation, insideRotatedBox, createAudioClickGesture, empty, migrate, length, end, active, order, duration, envelope, visualOpacity, dissolve, split };
});
