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
test('legacy projects migrate while stage dimensions and exact frame times remain independent',()=>{
  const original=Motion.create(vector());original.version=1;delete original.fps;delete original.holdFrames;delete original.fonts;delete original.assets;for(const layer of original.layers){delete layer.id;delete layer.kind;}
  const project=Motion.validate(original);assert.equal(project.version,3);project.width=1080;project.height=1920;project.fps=12;const at=1/12;Motion.setFrame(project.layers[0],at,frame(20),'hold');const reopened=Motion.validate(project);assert.equal(reopened.width,1080);assert.equal(reopened.height,1920);assert.equal(reopened.layers[0].keyframes[0].time,at);assert.equal(reopened.source.objects[0].x,20);
});
test('artwork can be added behind existing layers without changing the stage',()=>{
  const project=Motion.empty({width:1080,height:1920});project.layers=[{id:'source-0',kind:'lens',name:'Lens',visible:true,lens:{x:100,y:100,radius:30,zoom:2,offsetX:0,offsetY:0,stroke:'#000000',strokeWidth:0},keyframes:[]}];assert.equal(Motion.attachSource(project,vector()),1);const reopened=Motion.validate(project);assert.equal(reopened.width,1080);assert.equal(reopened.height,1920);assert.equal(reopened.layers[0].kind,'vector');assert.equal(reopened.layers[1].kind,'lens');assert.notEqual(reopened.layers[0].id,reopened.layers[1].id);assert.throws(()=>Motion.attachSource(project,vector()),/already/i);
});
test('native text, lens and large batches are validated without losing their data',()=>{
  const project=Motion.empty({width:1080,height:1920,fps:12});project.layers=[{id:'title',kind:'text',name:'Title',visible:true,text:{content:'Find what’s next',x:540,y:200,fontSize:96,font:'Gelasio',weight:'bold',style:'italic',align:'center',lineHeight:1.2,color:'#112233'},keyframes:[]},{id:'lens',kind:'lens',name:'Lens',visible:true,lens:{x:540,y:900,radius:130,zoom:2,offsetX:0,offsetY:0,stroke:'#aabb00',strokeWidth:12},keyframes:[]}];
  for(let i=0;i<96;i++)Motion.setFrame(project.layers[1],i/20,{...Motion.defaults,x:i,zoom:2+i/100},'hold');const result=Motion.validate(project);assert.equal(result.layers[1].keyframes.length,96);assert.equal(Motion.sample(result.layers[1],.025).x,0);assert.equal(Motion.sample(result.layers[1],.05).x,1);
  const bad=structuredClone(project);bad.layers[0].text.font='unregistered-font';assert.throws(()=>Motion.validate(bad),/text layer/i);bad.layers[0].text.font='Gelasio';bad.layers[1].lens.zoom=0;assert.throws(()=>Motion.validate(bad),/lens layer/i);
});
test('compositions accept more than the old 10,000-keyframe ceiling',()=>{
  const project=Motion.empty({duration:60,fps:60});project.layers=[{id:'title',kind:'text',name:'Title',visible:true,text:{content:'Hello',x:10,y:10,fontSize:30,font:'Bricolage Grotesque',weight:'normal',style:'normal',align:'left',lineHeight:1.2,color:'#112233'},keyframes:Array.from({length:10001},(_,i)=>({time:i/200,x:0,y:0,scale:1,rotation:0,opacity:1,easing:'hold'}))}];assert.equal(Motion.validate(project).layers[0].keyframes.length,10001);
});
test('v2 projects migrate while cyclic relationships and unsafe linked paths are rejected',()=>{
  const old=Motion.empty({width:320,height:240,duration:1});old.version=2;delete old.symbols;delete old.behaviors;const migrated=Motion.validate(old);assert.equal(migrated.version,3);assert.deepEqual(migrated.symbols,[]);assert.deepEqual(migrated.behaviors,[]);
  const project=Motion.empty({width:320,height:240,duration:1});project.layers=[{id:'a',kind:'group',name:'A',visible:true,group:{x:0,y:0},parentId:'b',keyframes:[]},{id:'b',kind:'group',name:'B',visible:true,group:{x:0,y:0},parentId:'a',keyframes:[]}];assert.throws(()=>Motion.validate(project),/cycle/i);project.layers=[];project.assets=[{id:'bad',sharedPath:'../secret.png'}];assert.throws(()=>Motion.validate(project),/asset/i);
});
test('normalized behaviors add reusable motion without modifying base keyframes',()=>{
  const layer={kind:'shape',keyframes:[],effects:[{behaviorId:'sweep',start:1,duration:2,amountX:200,amountY:100}]},behavior={id:'sweep',keyframes:[{at:0,...Motion.defaults,easing:'linear'},{at:1,...Motion.defaults,x:1,y:1,easing:'linear'}]},project={behaviors:[behavior]};assert.equal(Motion.sample(layer,2).x,0);const value=Motion.sampleAnimated(layer,2,project);assert.equal(value.x,100);assert.equal(value.y,50);
});
