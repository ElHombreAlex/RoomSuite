'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Mask=require('../PixelRoom/dist/layer-mask');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXz8AAAAASUVORK5CYII=';
test('editable cutout masks validate their format, PNG dimensions and bounds',()=>{
  const mask={version:1,width:1,height:1,image:png};assert.deepEqual(Mask.validate(mask),mask);assert.equal(Mask.compatible(100,50,2000,1000),true);assert.equal(Mask.compatible(100,50,1000,1000),false);
  assert.throws(()=>Mask.validate({...mask,width:2}),/dimensions/);assert.throws(()=>Mask.validate({...mask,version:2}),/Invalid/);assert.throws(()=>Mask.validate({...mask,image:'data:image/png;base64,AAAA'}),/PNG/);assert.throws(()=>Mask.dimensions(2048,2048),/4 megapixels/);assert.throws(()=>Mask.validate({...mask,extra:true}),/Invalid/);
});
