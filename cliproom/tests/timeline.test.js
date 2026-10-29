'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const timeline = require('../public/timeline.js');
let next = 0;
const id = () => `id-${++next}`;

test('version 1 projects retain their timing and audible range', () => {
  const old = { version: 1, name: 'Old', aspect: '16:9', quality: '720p', assets: [], titles: [],
    clips: [{ id: 'a', in: 1, out: 4 }, { id: 'b', in: 0, out: 2 }],
    music: { assetId: 'song', in: 0, out: 12, start: 1, volume: .7 } };
  const project = timeline.migrate(old, id);
  assert.deepEqual(project.clips.map(c => c.start), [0, 3]);
  assert.equal(project.audioClips[0].out, 4);
  assert.equal(timeline.duration(project), 5);
  assert.equal(old.clips[1].start, undefined);
});

test('dissolves overlap same-track clips, blend pictures and fade both audio sources', () => {
  const project = timeline.empty(id), trackId = project.videoTracks[0].id;
  project.clips = [
    { id: 'a', trackId, start: 0, in: 0, out: 4, opacity: 1, fadeIn: 0, fadeOut: 0 },
    { id: 'b', trackId, start: 4, in: 0, out: 4, opacity: 1, fadeIn: 0, fadeOut: 0 }
  ];
  assert.deepEqual(timeline.dissolve(project, 'b', 'video', 2), { previous: 'a', duration: 2 });
  assert.equal(project.clips[1].start, 2);
  assert.equal(timeline.duration(project), 6);
  assert.equal(timeline.envelope(project.clips[0], 3), .5);
  assert.equal(timeline.envelope(project.clips[1], 3), .5);
  assert.equal(timeline.visualOpacity(project, project.clips[0], 3), 1);
  assert.equal(timeline.visualOpacity(project, project.clips[1], 3), .5);
});

test('tracks can overlap independently and audio can extend the timeline', () => {
  const project = timeline.empty(id), video = project.videoTracks[0].id, audio = project.audioTracks[0].id;
  project.clips.push({ id: 'a', trackId: video, start: 0, in: 0, out: 3 });
  project.audioClips.push({ id: 'm', trackId: audio, start: 1, in: 0, out: 6, fadeIn: 2, fadeOut: 1 });
  assert.equal(timeline.duration(project), 7);
  assert.equal(timeline.envelope(project.audioClips[0], 2), .5);
  assert.equal(timeline.envelope(project.audioClips[0], 6.5), .5);
  assert.equal(timeline.dissolve(project, 'a', 'video'), null);
});

test('a full-length dissolve keeps the incoming clip above the outgoing clip', () => {
  const project = timeline.empty(id), trackId = project.videoTracks[0].id;
  const later = { id:'later', trackId, start:2, in:0, out:2, opacity:1, fadeIn:0, fadeOut:0 };
  const earlier = { id:'earlier', trackId, start:0, in:0, out:2, opacity:1, fadeIn:0, fadeOut:0 };
  project.clips = [later, earlier];
  timeline.dissolve(project, later.id, 'video', 2);
  assert.deepEqual([...project.clips].sort(timeline.order).map(c => c.id), ['earlier', 'later']);
});

test('audio crossfade preserves both clips and hands sound between them', () => {
  const project = timeline.empty(id), trackId = project.audioTracks[0].id;
  project.audioClips = [
    { id:'first', trackId, start:0, in:0, out:2, fadeIn:0, fadeOut:0 },
    { id:'second', trackId, start:2, in:0, out:2, fadeIn:0, fadeOut:0 }
  ];
  assert.ok(timeline.dissolve(project, 'second', 'audio', 1));
  assert.deepEqual(project.audioClips.map(c => timeline.envelope(c, 1.25)), [.75, .25]);
  assert.deepEqual(project.audioClips.map(c => timeline.envelope(c, 1.75)), [.25, .75]);
});

test('version 2 projects open with their old timing and title placement', () => {
  const project = timeline.empty(id);
  project.version = 2;
  project.clips.push({ id:'a', start:0, in:1, out:5 });
  project.titles.push({ id:'t', text:'Hello', position:'bottom', size:6 });
  const migrated = timeline.migrate(project, id);
  assert.equal(migrated.version, 4);
  assert.equal(timeline.length(migrated.clips[0]), 4);
  assert.deepEqual([migrated.titles[0].x, migrated.titles[0].y], [50, 82]);
  assert.equal(migrated.titles[0].rotation, 0);
  assert.equal(project.clips[0].rate, undefined);
});

test('retiming changes duration and maps the playhead to source time', () => {
  const clip = { id:'a', start:2, in:1, out:9, rate:2 };
  assert.equal(timeline.length(clip), 4);
  assert.equal(timeline.end(clip), 6);
  assert.equal(timeline.sourceAt(clip, 3.5), 4);
  assert.equal(timeline.rateForDuration(clip, 4), 2);
  assert.equal(timeline.rateForDuration(clip, 20), null);
  assert.equal(timeline.rateForDuration(clip, 1), null);
});

test('splitting a retimed clip keeps the source and timeline continuous', () => {
  const project = timeline.empty(id), trackId = project.audioTracks[0].id;
  project.audioClips.push({ id:'a', trackId, start:2, in:1, out:9, rate:2, fadeIn:0, fadeOut:0 });
  const second = timeline.split(project, 'a', 'audio', 3.5, id);
  assert.equal(project.audioClips[0].out, 4);
  assert.deepEqual([second.start, second.in, timeline.end(second)], [3.5, 4, 6]);
});

test('audio clicks cut once, while a double click opens options without cutting', () => {
  let nextTimer = 0; const timers = new Map(), actions = [];
  const gesture = timeline.createAudioClickGesture({
    onCut:(clip, time) => actions.push(['cut', clip, time]),
    onOptions:(clip, time) => actions.push(['options', clip, time]),
    schedule:(fn, delay) => { assert.equal(delay, 550); const key = ++nextTimer; timers.set(key, fn); return key; },
    clear:key => timers.delete(key)
  });
  gesture.click('a', 1, 100, 10);
  assert.deepEqual(actions, []);
  const first = timers.get(1); timers.delete(1); first();
  assert.deepEqual(actions, [['cut', 'a', 1]]);

  gesture.click('a', 2, 100, 10);
  const stale = timers.get(2);
  gesture.click('a', 2.01, 105, 12);
  stale(); // A canceled timer must not perform a late cut.
  assert.deepEqual(actions, [['cut', 'a', 1], ['options', 'a', 2.01]]);
  assert.equal(gesture.pendingClipId(), null);

  gesture.click('a', 1.5, 100, 10);
  gesture.cancel();
  assert.equal(timers.size, 0);
  assert.deepEqual(actions, [['cut', 'a', 1], ['options', 'a', 2.01]]);
});

test('rotation normalizes angles and hit testing follows a rotated rectangle', () => {
  const box = { centerX:100, centerY:50, width:80, height:20 };
  assert.equal(timeline.normalizeRotation(450), 90);
  assert.equal(timeline.normalizeRotation(-181), 179);
  assert.equal(timeline.insideRotatedBox(135, 50, box, 0), true);
  assert.equal(timeline.insideRotatedBox(135, 50, box, 90), false);
  assert.equal(timeline.insideRotatedBox(100, 85, box, 90), true);
  assert.equal(timeline.insideRotatedBox(120, 70, box, 45), true);
  assert.equal(timeline.insideRotatedBox(120, 30, box, 45), false);
});

test('keyframes interpolate sparse properties in source time', () => {
  const clip = { start:10, in:2, out:8, rate:2, x:20, y:50, scale:1, opacity:1, brightness:100, volume:1,
    keyframes:[{time:6,x:90,scale:2,brightness:60,opacity:.4,volume:.2},{time:2,x:10,scale:1,brightness:100,opacity:1,volume:1}] };
  const middle = timeline.animatedValues(clip, 11);
  assert.equal(middle.x, 50); assert.equal(middle.scale, 1.5); assert.equal(middle.brightness, 80);
  assert.equal(middle.opacity, .7); assert.equal(middle.volume, .6); assert.equal(middle.y, 50);
  assert.equal(timeline.visualOpacity({clips:[clip]}, clip, 11), .7);
  assert.equal(timeline.animatedValues(clip, 12).x, 90);
});

test('keyframes remain attached to source time after splitting and retiming', () => {
  const project = timeline.empty(id), trackId = project.videoTracks[0].id;
  const clip = { id:'a', trackId, start:10, in:2, out:8, rate:2, x:20,
    keyframes:[{time:2,x:10},{time:6,x:90}] };
  project.clips.push(clip);
  const second = timeline.split(project, 'a', 'video', 11, id);
  assert.equal(timeline.animatedValues(second,11.5).x,70);
  second.rate = 1;
  assert.equal(timeline.animatedValues(second,12).x,70);
  second.keyframes[0].x = 99;
  assert.equal(clip.keyframes[0].x,10);
});

test('version 3 projects migrate without changing the original state', () => {
  const old = timeline.empty(id); old.version = 3; old.clips.push({ id:'a', start:0, in:0, out:2, opacity:.8 });
  const migrated = timeline.migrate(old,id);
  assert.equal(migrated.version,4); assert.equal(old.version,3); assert.equal(timeline.animatedValues(migrated.clips[0],1).opacity,.8);
});
