'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {dilate,feather,plan}=require('../PixelRoom/dist/cleanup');

test('mask expansion is bounded and feathering only changes selected pixels',()=>{
  const w=9,h=7,input=new Uint8Array(w*h);input[3*w+4]=1;
  const expanded=dilate(input,w,h,2);assert.equal(expanded.reduce((a,b)=>a+b,0),25);
  assert.equal(expanded[3*w+4],1);assert.equal(expanded[0],0);
  const alpha=feather(expanded,w,h,1);assert.equal(alpha[3*w+4],255);assert.ok(alpha[1*w+2]>0&&alpha[1*w+2]<255);assert.equal(alpha[0],0);
  assert.deepEqual([...dilate(input,w,h,0)],[...input]);
});
test('cleanup tiles cover long and large selections with a bounded number of overlapping tiles',()=>{
  for(const bounds of [{minX:10,minY:20,maxX:2009,maxY:59},{minX:0,minY:0,maxX:4095,maxY:4095},{minX:2,minY:3,maxX:2,maxY:3}]){
    const {side,tiles}=plan(bounds);assert.ok(tiles.length<=16);assert.ok(side>=256);
    for(let y=bounds.minY;y<=bounds.maxY;y+=Math.max(1,Math.floor((bounds.maxY-bounds.minY)/20)))for(let x=bounds.minX;x<=bounds.maxX;x+=Math.max(1,Math.floor((bounds.maxX-bounds.minX)/20)))assert.ok(tiles.some(t=>x>=t.left&&x<t.left+side&&y>=t.top&&y<t.top+side),`uncovered ${x},${y}`);
    assert.ok(tiles.some(t=>bounds.maxX>=t.left&&bounds.maxX<t.left+side&&bounds.maxY>=t.top&&bounds.maxY<t.top+side));
  }
});
