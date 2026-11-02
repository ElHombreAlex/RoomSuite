'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Loudness=require('../SoundRoom/loudness.js');
test('K-weighted loudness matches the 997 Hz reference and stereo channel summation',()=>{
  const sine=Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*997*i/48000)),mono=Loudness.measure([sine]),stereo=Loudness.measure([sine,sine]);
  assert.ok(Math.abs(mono.integrated_lufs+3.01)<.05,'mono '+mono.integrated_lufs);assert.ok(Math.abs(stereo.integrated_lufs)<.05,'stereo '+stereo.integrated_lufs);assert.equal(mono.blocks,7);
});
test('silence is gated and unsupported lengths and channels are rejected',()=>{
  const silent=new Float32Array(48000);assert.equal(Loudness.measure([silent]).integrated_lufs,null);assert.throws(()=>Loudness.measure([silent,silent,silent]),/mono or stereo/);assert.throws(()=>Loudness.measure([new Float32Array(100)]),/0.4 seconds/);
});
