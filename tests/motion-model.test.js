'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Motion=require('../MotionRoom/model');

const paint=()=>({format:'paintroom-project',version:1,name:'Two layers',width:200,height:100,background:'#ffffff',layers:[
  {id:'first',name:'First',visible:true,opacity:1,x:0,y:0,scale:1,rotation:0,objects:[{type:'rect',x:10,y:10,x2:40,y2:40,opacity:1,color:'#000000',width:2,fill:'#ff0000'}]},
  {id:'second',name:'Second',visible:false,opacity:.5,x:5,y:0,scale:1,rotation:0,objects:[]}
]});
const vector=()=>({format:'vectorroom',version:1,objects:[{id:'rect-1',type:'rect',x:20,y:30,width:80,height:50,fillMode:'solid',fill:'#ff0000',fill2:'#ffffff',stroke:'#000000',strokeWidth:0}]});
const frame=(x,opacity=1)=>({x,y:0,scale:1,rotation:0,opacity});

test('imports independent PaintRoom layers while preserving their editable source',()=>{
  const source=paint(),motion=Motion.create(source);assert.equal(motion.layers.length,2);assert.equal(motion.layers[1].visible,false);assert.equal(motion.source.layers[0].objects[0].fill,'#ff0000');
  Motion.setFrame(motion.layers[0],0,frame(0),'linear');Motion.setFrame(motion.layers[0],2,frame(100,.5),'ease-out');assert.equal(source.layers[0].objects[0].id,undefined);
  const restored=Motion.validate(JSON.parse(JSON.stringify(motion)));assert.equal(restored.layers[0].keyframes.length,2);assert.equal(restored.layers[1].keyframes.length,0);assert.equal(restored.source.layers[0].objects[0].fill,'#ff0000');
});
test('interpolates transforms with easing, holds, and exact keyframe boundaries',()=>{
  const layer={keyframes:[]};assert.deepEqual(Motion.sample(layer,3),Motion.defaults);
  Motion.setFrame(layer,0,frame(0),'ease-in');Motion.setFrame(layer,2,frame(100,.5),'hold');Motion.setFrame(layer,4,frame(200,0),'linear');
  assert.equal(Motion.sample(layer,1).x,25);assert.equal(Motion.sample(layer,3).x,100);assert.equal(Motion.sample(layer,4).x,200);assert.equal(Motion.sample(layer,4).opacity,0);
  Motion.setFrame(layer,2,frame(90),'linear');assert.equal(layer.keyframes.length,3);assert.equal(Motion.sample(layer,2).x,90);
});
test('round trips editable vector objects and rejects inconsistent or malformed animation data',()=>{
  const motion=Motion.create(vector());assert.equal(motion.source.objects[0].id,'rect-1');assert.equal(motion.width,1000);assert.equal(Motion.validate(motion).source.objects[0].type,'rect');
  const bad=structuredClone(motion);bad.layers[0].sourceIndex=4;assert.throws(()=>Motion.validate(bad),/layer/i);
  const badFrame=structuredClone(motion);badFrame.layers[0].keyframes=[{time:1,x:0,y:0,scale:1,rotation:0,opacity:1,easing:'unknown'}];assert.throws(()=>Motion.validate(badFrame),/keyframe/i);
  const badVector=structuredClone(motion);badVector.source.objects[0].fill='url(https://example.com)';assert.throws(()=>Motion.validate(badVector),/invalid/i);
});
