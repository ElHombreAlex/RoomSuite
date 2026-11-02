'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../cliproom/public/color-grade.js');
const T = require('../cliproom/public/timeline.js');
const Waveform = require('../cliproom/public/waveform.js');
const Region = require('../cliproom/public/region-grade.js');
const fs = require('node:fs');
const path = require('node:path');

test('portable presets validate versions, limits, unknown fields and unsupported effects', () => {
  const look = G.makePreset('Summer', {exposure_ev:.5, temperature:25, saturation:12}, 'Warm', ['summer']);
  assert.deepEqual(G.parse(JSON.stringify(look)), look);
  assert.throws(() => G.parse('x'.repeat(G.maxBytes + 1)), /2 MiB/);
  assert.throws(() => G.preset({...look,schema_version:2}), /version/);
  assert.throws(() => G.preset({...look,adjustments:{temperature:101}}), /temperature/);
  assert.throws(() => G.preset({...look,adjustments:{temperature:'2'}}), /temperature/);
  assert.throws(() => G.preset({...look,effects:[{type:'lut',path:'../../x'}]}), /effects/);
  assert.throws(() => G.preset({...look,script:'anything'}), /Unsupported/);
});
test('standalone PixelRoom ships the identical shared color engine and UI assets',()=>{
  for(const file of ['color-look.js','color-grade.js','color-grade-ui.js','color-grade.css'])assert.equal(fs.readFileSync(path.join(__dirname,'..','PixelRoom','dist',file),'utf8'),fs.readFileSync(path.join(__dirname,'..','cliproom','public',file),'utf8'),file);
});
test('image and video targets share color values, strength and enable semantics', () => {
  const values = {brightness:15, contrast:-12, saturation:20, exposure_ev:.5, temperature:25, shadows:30, vibrance:15};
  const image = {}, video = {};
  G.writeTarget(image,'pixel',values,65,true); G.writeTarget(video,'clip',values,65,true);
  assert.equal(video.brightness,115); assert.equal(video.contrast,88);
  assert.deepEqual(G.readTarget(image,'pixel'),G.readTarget(video,'clip'));
  const full = G.effective(G.readTarget(image,'pixel'));
  assert.equal(full.brightness,9.75); assert.equal(full.exposure_ev,.325);
  assert.equal(G.effective({...G.readTarget(image,'pixel'),enabled:false}).temperature,0);
  assert.equal(G.effective(G.readTarget(image,'pixel'),true).brightness,0);
  assert.throws(() => G.readTarget({colorGrade:{temperature:1,script:'x'}},'pixel'), /Unsupported/);
});
test('primary grading preserves alpha, treats neutral as identity and changes color deterministically', () => {
  const original = new Uint8ClampedArray([50,100,150,255, 220,180,100,128, 3,4,5,0]);
  const neutral = new Uint8ClampedArray(original); G.applyPixels(neutral,G.adjustments()); assert.deepEqual(neutral,original);
  const pixels = new Uint8ClampedArray(original), grade = G.adjustments({exposure_ev:1,temperature:30,shadows:20,vibrance:30});
  G.applyPixels(pixels,grade); assert.ok(pixels[0]>original[0]); assert.equal(pixels[3],255); assert.equal(pixels[7],128); assert.deepEqual([...pixels.slice(8)],[3,4,5,0]);
  const other = new Uint8ClampedArray(original); G.applyPixels(other,grade); assert.deepEqual(other,pixels);
});
test('advanced color keyframes follow source time through moves and speed changes', () => {
  const clip={start:10,in:2,out:6,rate:2,colorGrade:{exposure_ev:0,temperature:10},keyframes:[{time:4,exposure_ev:1,temperature:50}]};
  const values=T.animatedValues(clip,10.5);assert.equal(values.exposure_ev,.75);assert.equal(values.temperature,40);
  clip.start=20;assert.deepEqual(T.animatedValues(clip,20.5),values);
  clip.rate=1;assert.equal(T.animatedValues(clip,21).temperature,40);
});
test('waveform peaks combine channels and follow the trimmed source interval',()=>{
  const data=Waveform.peaks([Float32Array.from([0,.25,0,.5,0,.75,0,1]),Float32Array.from([0,0,0,0,0,0,0,.8])],4);
  assert.deepEqual(data,[.25,.5,.75,1]);assert.deepEqual(Waveform.segment(data,8,4,8,2),[.75,1]);
  assert.throws(()=>Waveform.peaks([new Float32Array(1)],513),/Invalid/);
});

test('waveform reads enforce the size limit even for a streamed response without a length header',async()=>{
  const small=new Response(new Uint8Array([1,2,3]));assert.deepEqual([...new Uint8Array(await Waveform.readResponse(small))],[1,2,3]);
  let sent=0;const tooLarge=new Response(new ReadableStream({pull(controller){if(sent++<21)controller.enqueue(new Uint8Array(1024*1024));else controller.close();}}));
  await assert.rejects(Waveform.readResponse(tooLarge),/size limit/);
});

test('Cliproom and PixelRoom share the mask format and reject malformed or oversized masks',()=>{
  assert.equal(fs.readFileSync(path.join(__dirname,'../cliproom/public/layer-mask.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../PixelRoom/dist/layer-mask.js'),'utf8'));
  assert.throws(()=>Region.validate({version:1,width:1,height:1,image:'data:image/png;base64,abcd'}),/PNG/);
  assert.throws(()=>Region.validateProject([{gradeMask:{version:2}}]),/mask/i);
});
