'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const G=require('../cliproom/public/color-grade.js'),L=G.Look;
const timeline=require('../cliproom/public/timeline.js');
function cube(transform=(r,g,b)=>[r,g,b]){const lines=['TITLE "Example"','LUT_3D_SIZE 2','DOMAIN_MIN 0 0 0','DOMAIN_MAX 1 1 1'];for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++)lines.push(transform(r,g,b).join(' '));return lines.join('\n');}
test('3D cube import validates bounds, red-fastest ordering and trilinear interpolation',()=>{
  const look=L.validate({lut:L.parseCube(cube())}),pixel=new Uint8ClampedArray([64,128,192,123]);L.apply(pixel,1,1,look,1);
  assert.ok(Math.abs(pixel[0]-64)<=1&&Math.abs(pixel[1]-128)<=1&&Math.abs(pixel[2]-192)<=1);assert.equal(pixel[3],123);
  const inverted=L.validate({lut:L.parseCube(cube((r,g,b)=>[1-r,1-g,1-b]))}),changed=new Uint8ClampedArray([64,128,192,255]);L.apply(changed,1,1,inverted,1);assert.deepEqual([...changed],[191,127,63,255]);
  assert.throws(()=>L.parseCube('LUT_1D_SIZE 2\n0 0 0\n1 1 1'),/Only 3D LUTs/);
  assert.throws(()=>L.parseCube(cube()+'\n0 0 0'),/too many/);
  assert.throws(()=>L.parseCube(cube().replace('LUT_3D_SIZE 2','LUT_3D_SIZE 34')),/sizes/);
  assert.throws(()=>L.parseCube(cube().replace('DOMAIN_MAX 1 1 1','DOMAIN_MAX 0 1 1')),/minimum/);
  assert.throws(()=>L.parseCube('x'.repeat(L.maxCubeBytes+1)),/2 MiB/);
});
test('version 2 presets carry editable creative looks and old presets remain valid',()=>{
  const look=L.validate({curves:{master:[0,.15,.65,.85,1]},hsl:{red:{hue:15,saturation:20}},wheels:{shadows:{color:'#ff8040',amount:30}},vignette:20,grain:10,sharpen:15,lut:L.parseCube(cube())});
  const preset=G.makePreset('Creative',{exposure_ev:.2},'test',['creative'],look);assert.equal(preset.schema_version,2);assert.deepEqual(G.parse(JSON.stringify(preset)),preset);
  const image={},clip={};G.writeTarget(image,'pixel',preset.adjustments,70,true,preset.look);G.writeTarget(clip,'clip',preset.adjustments,70,true,preset.look);assert.deepEqual(G.readTarget(image,'pixel'),G.readTarget(clip,'clip'));
  G.writeTarget(image,'pixel',{exposure_ev:.5},70,true);assert.equal(G.readTarget(image,'pixel').look.lut.size,2,'adjusting primaries preserves the look');
  assert.equal(G.makePreset('Old',{}).schema_version,1);assert.throws(()=>G.preset({...G.makePreset('Old',{}),look:{grain:1}}),/Version 1/);
});
test('creative transforms are deterministic, strength-aware, and preserve transparency',()=>{
  const look=L.validate({curves:{red:[0,.3,.65,.85,1]},hsl:{red:{hue:20,saturation:20,luminance:10}},wheels:{midtones:{color:'#80bfff',amount:40}},grain:25,grain_seed:42,vignette:30,sharpen:20});
  const source=new Uint8ClampedArray([180,60,50,255,30,70,140,128,0,0,0,0,140,160,50,255]),a=new Uint8ClampedArray(source),b=new Uint8ClampedArray(source),off=new Uint8ClampedArray(source);
  L.apply(a,2,2,look,1);L.apply(b,2,2,look,1);L.apply(off,2,2,look,0);assert.deepEqual(a,b);assert.deepEqual(off,source);assert.notDeepEqual(a,source);assert.equal(a[3],255);assert.equal(a[7],128);assert.equal(a[11],0);
  const target={};G.writeTarget(target,'pixel',{},0,true,look);assert.equal(G.hasAdvanced(G.effective(G.readTarget(target,'pixel'))),false);
});
test('finishing effects interpolate in source time with a retimed clip',()=>{
  const clip={start:10,in:2,out:6,rate:2,colorGrade:{look:{grain:20,vignette:-20,sharpen:10}},keyframes:[{time:4,grain:60,vignette:20,sharpen:50}]};
  const value=timeline.animatedValues(clip,10.5);assert.equal(value.grain,50);assert.equal(value.vignette,10);assert.equal(value.sharpen,40);
  clip.start=20;assert.equal(timeline.animatedValues(clip,20.5).grain,50);
});
