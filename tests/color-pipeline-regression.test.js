'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Grade=require('../cliproom/public/color-grade.js');
const {pixels,cases,variedCases}=require('./color-pipeline-fixtures.js');

// Recorded from the v3.0.0 renderer before its performance changes. These
// snapshots include transparent pixels, narrow images, LUTs and mixed looks.
const expected={
  identity:'ec6a4d757571d9831800f693ee59254cbb8b53b779acd21316bf94b7d10b9df8',
  primaries:'59637dffcc577a4ebee441bd27d1e1160133f03a627277dde10ed6dfd9dc1ab7',
  'primary-no-tones':'daba907c7ad3d85d08dece5239c46b475c1886abcfecac2238f19a24933e2cb4',
  curves:'69ed1614a49bd3ab6dc87642ad04477781b6307edb3f824aaf2d039ac9d20734',
  hsl:'18ade1c3cb1067e522fdff00f63c73b7d7d4d0ff6407bf93e1e0c55d6f403087',
  wheels:'11b82fbb9cf954489574945fac9c138c38ed1e0e3d6748c917797ba6bcd60c4e',
  lut:'06bca8f9e7e5ea18e9bd2c42f7f5a0d9d2a60ddef85a828ca53108724a17b0db',
  finishing:'4f272fbf7c3a04b4dd3ddbea654d5964a96db51ffafe9d6e01ab4d0dc82edf52',
  'all-half-strength':'13d0e07f61bf3334230b28fa468ba049b246faacf890d7bd9d459dc56202bb89',
  'all-full-strength':'6bbb133ec7af539ffc6ad4493efe2932af0877b38ed68fb1933561a98be689c1',
  'opaque-sharpen':'03b99d39c1fcb850bd35fe58265ed93c054a5ec0b3ca28ca1303fb7d411135d4',
  'narrow-sharpen':'418d33a86316a38785c4e89130f3e88b5a859a6c64a7e795dd589e9d58b4b896'
};
for(const scenario of cases(Grade.Look))test('v3.0 color output stays unchanged: '+scenario.name,()=>{
  const data=pixels(scenario.width,scenario.height);if(scenario.opaque)for(let i=3;i<data.length;i+=4)data[i]=255;const original=data.slice();
  const values={...Grade.adjustments(scenario.adjustments),look:Grade.Look.validate(scenario.look),lookMix:scenario.mix??1};
  Grade.applyPixels(data,values,scenario.width,scenario.height);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'),expected[scenario.name]);
  for(let i=3;i<data.length;i+=4)assert.equal(data[i],original[i],'alpha must remain unchanged');
});
test('the exported pixel helper still clamps non-byte input',()=>{
  const data=new Float64Array([-10,260,2,255]);
  Grade.applyPixels(data,Grade.adjustments());
  assert.deepEqual([...data],[0,255,2,255]);
});
test('varied opaque and transparent grades match the v3.0 renderer',()=>{
  const hash=crypto.createHash('sha256');let pixelsChecked=0;
  for(const scenario of variedCases(Grade.Look)){
    Grade.applyPixels(scenario.data,{...Grade.adjustments(scenario.adjustments),look:Grade.Look.validate(scenario.look),lookMix:scenario.mix},scenario.width,scenario.height);
    hash.update(scenario.data);pixelsChecked+=scenario.width*scenario.height;
  }
  assert.equal(pixelsChecked,122222);
  assert.equal(hash.digest('hex'),'f8db821530d6f3651fad4f05b5562c2ba2a82b22635c79bc29b6310f99b07544');
});
