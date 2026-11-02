'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Look = require('../public/color-look.js');
const Frames = require('../public/look-keyframes.js');
const T = require('../public/timeline.js');

test('creative keyframes interpolate curves, hue and wheel colors while keeping the clip LUT and effects', () => {
  const lut={size:2,data:Array.from({length:24},(_,i)=>(i%3)/2)};
  const base=Look.validate({lut,grain:17,wheels:{shadows:{color:'#000000',amount:0}}});
  const clip={colorGrade:{look:base},keyframes:[
    {time:0,creativeLook:{wheels:{shadows:{color:'#000000',amount:0}}}},
    {time:4,creativeLook:{curves:{master:[0,.4,.8,.9,1]},hsl:{red:{hue:20,saturation:40}},wheels:{shadows:{color:'#ffffff',amount:60}}}}
  ]};
  const middle=Frames.at(clip,2);
  assert.equal(middle.curves.master[2],.65);
  assert.equal(middle.hsl.red.hue,10);
  assert.equal(middle.hsl.red.saturation,20);
  assert.deepEqual(middle.wheels.shadows,{color:'#808080',amount:30});
  assert.equal(middle.lut,base.lut);
  assert.equal(middle.grain,17);
  assert.equal(Frames.at(clip,5).hsl.red.hue,20);
  assert.equal(clip.keyframes[1].creativeLook.wheels.shadows.color,'#ffffff');
});

test('creative keyframes follow source time after retiming, trimming, splitting and migration', () => {
  let next=0;const id=()=>String(++next),project=T.empty(id);
  project.version=5;
  project.clips.push({id:'clip',trackId:project.videoTracks[0].id,start:2,in:1,out:9,rate:2,keyframes:[{time:0,creativeLook:{}},{time:8,creativeLook:{hsl:{red:{hue:24}}}}]});
  const clip=project.clips[0];
  assert.equal(Frames.at(clip,T.sourceAt(clip,3.5)).hsl.red.hue,12);
  const second=T.split(project,'clip','video',3.5,id);
  assert.equal(Frames.at(second,T.sourceAt(second,4)).hsl.red.hue,15);
  assert.equal(T.migrate(project,id).version,5);
  assert.equal(T.migrate(T.empty(id),id).version,4);
  assert.throws(()=>Frames.validate({lut:{}}),/curves, HSL and color wheels/);
  assert.throws(()=>Frames.validate({hsl:{red:{hue:100}}}),/Invalid HSL hue/);
});
