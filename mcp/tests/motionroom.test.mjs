import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
let temp,server,browser,page;
const paint={format:'paintroom-project',version:1,name:'Motion test',width:120,height:80,background:'#ffffff',layers:[
  {id:'red',name:'Red layer',visible:true,opacity:1,x:0,y:0,scale:1,rotation:0,objects:[{id:'r',type:'rect',x:10,y:10,x2:30,y2:30,color:'#ff0000',width:1,opacity:1,fill:'#ff0000',stroke:false}]},
  {id:'blue',name:'Blue layer',visible:true,opacity:1,x:0,y:0,scale:1,rotation:0,mask:{mode:'show',points:[{x:60,y:10},{x:80,y:10},{x:80,y:30},{x:60,y:30}]},objects:[{id:'b',type:'rect',x:55,y:5,x2:85,y2:35,color:'#0000ff',width:1,opacity:1,fill:'#0000ff',stroke:false}]}
]};
const file=(name,data)=>({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
const input=async(selector,value)=>page.locator(selector).evaluate((node,next)=>{node.value=String(next);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));},value);
const pixel=async(x,y)=>page.evaluate(([x,y])=>[...document.querySelector('#stage').getContext('2d').getImageData(x,y,1,1).data],[x,y]);
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-motion-test-'));
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1500,height:1000},acceptDownloads:true});
});
after(async()=>{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-motion-test-'));await fs.rm(actual,{recursive:true,force:true});}});

test('PaintRoom layers animate independently and an editable motion project reopens',async()=>{
  await page.goto(base+'/motionroom/');await page.locator('#artworkFile').setInputFiles(file('art.paintroom',paint));await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));
  const bounds=await page.locator('#stage').boundingBox();assert.ok(Math.abs(bounds.width/bounds.height-1.5)<.01);assert.ok(bounds.width>200,'small artwork should fill the preview');
  assert.deepEqual(await pixel(20,20),[255,0,0,255]);assert.deepEqual(await pixel(65,20),[0,0,255,255]);assert.deepEqual(await pixel(57,20),[255,255,255,255]);
  await page.getByRole('button',{name:'Red layer'}).click();await page.locator('#addKey').click();await input('#seek',1);await input('#x',40);await input('#seek',.5);
  assert.deepEqual(await pixel(20,20),[255,255,255,255]);assert.deepEqual(await pixel(40,20),[255,0,0,255]);assert.deepEqual(await pixel(65,20),[0,0,255,255]);
  if(process.env.MOTION_SCREENSHOT)await page.screenshot({path:process.env.MOTION_SCREENSHOT,fullPage:true});
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#saveProject').click()]);const saved=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(saved.source.layers[0].objects[0].fill,'#ff0000');assert.equal(saved.layers[0].keyframes.length,2);
  await page.locator('#projectFile').setInputFiles(file('reopen.motionroom',saved));await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));await page.getByRole('button',{name:'Red layer'}).click();await input('#seek',.5);assert.deepEqual(await pixel(40,20),[255,0,0,255]);
});
test('VectorRoom projects keep objects independent in the animation',async()=>{
  const vector={format:'vectorroom',version:1,objects:[{id:'rect',type:'rect',x:20,y:20,width:60,height:60,fillMode:'solid',fill:'#00aa00',fill2:'#ffffff',stroke:'#000000',strokeWidth:0},{id:'circle',type:'ellipse',x:120,y:20,width:60,height:60,fillMode:'solid',fill:'#0000ff',fill2:'#ffffff',stroke:'#000000',strokeWidth:0},{id:'offscreen',type:'rect',x:-100,y:120,width:60,height:60,fillMode:'solid',fill:'#ff0000',fill2:'#ffffff',stroke:'#000000',strokeWidth:0}]};
  await page.locator('#artworkFile').setInputFiles(file('art.vectorroom',vector));await page.waitForFunction(()=>document.querySelector('#sourceLabel').textContent.includes('VECTORROOM'));
  assert.deepEqual(await pixel(40,40),[0,170,0,255]);assert.deepEqual(await pixel(150,50),[0,0,255,255]);
  await page.getByRole('button',{name:'Rect 1'}).click();await page.locator('#addKey').click();await input('#seek',1);await input('#x',100);assert.deepEqual(await pixel(40,40),[255,255,255,255]);assert.deepEqual(await pixel(150,50),[0,0,255,255]);
  await page.getByRole('button',{name:'Rect 3'}).click();await input('#x',140);assert.deepEqual(await pixel(60,150),[255,0,0,255]);
});
test('PaintRoom and VectorRoom can send editable artwork to MotionRoom through shared files',async()=>{
  for(const kind of ['paint','vector']){
    const sender=await browser.newPage({viewport:{width:1600,height:1000}}),receiver=await browser.newPage({viewport:{width:1500,height:1000}});
    try{
      if(kind==='paint'){await sender.goto(base+'/paintroom/');await sender.locator('#projectFile').setInputFiles(file('source.paintroom',paint));await sender.waitForFunction(()=>document.querySelector('#status').textContent.includes('Editable artwork opened'));}
      else{await sender.goto(base+'/vectorroom/');const doc={format:'vectorroom',version:1,objects:[{id:'a',type:'rect',x:20,y:20,width:60,height:60,fillMode:'solid',fill:'#00aa00',fill2:'#ffffff',stroke:'#000000',strokeWidth:0}]};await sender.locator('#openProject').setInputFiles(file('source.vectorroom',doc));await sender.waitForFunction(()=>document.querySelector('#status').textContent==='Project opened.');}
      await sender.locator('#sendMotion').click();await sender.locator('.shared-name input').fill('handoff-'+kind+(kind==='paint'?'.paintroom':'.vectorroom'));await sender.locator('.shared-save').click();await sender.waitForFunction(()=>!document.querySelector('#openMotion').classList.contains('hidden'));
      const href=await sender.locator('#openMotion').getAttribute('href');await receiver.goto(base+href);await receiver.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));assert.equal(await receiver.locator('#layerCount').textContent(),kind==='paint'?'2':'1');
    }finally{await sender.close();await receiver.close();}
  }
});
test('vector gradients, combined shapes and embedded images match VectorRoom at rest',async()=>{
  const source=await browser.newPage({viewport:{width:1500,height:1000}}),motion=await browser.newPage({viewport:{width:1500,height:1000}});
  try{
    await source.goto(base+'/vectorroom/');const imageData=await source.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=8;const x=c.getContext('2d');x.fillStyle='#00ffff';x.fillRect(0,0,8,8);return c.toDataURL('image/png');});
    const rect=(id,x,y,width,height,fill)=>({id,type:'rect',x,y,width,height,fillMode:'solid',fill,fill2:fill,stroke:'#000000',strokeWidth:0});
    const gradient={...rect('gradient',20,20,100,100,'#ff0000'),fillMode:'gradient',fill2:'#0000ff'},lower=rect('lower',160,20,100,100,'#00aa00'),upper=rect('upper',210,20,50,100,'#00aa00'),combined={id:'combined',type:'boolean',operation:'subtract',children:[lower,upper],fillMode:'solid',fill:'#00aa00',fill2:'#00aa00',stroke:'#000000',strokeWidth:0},image={...rect('image',300,20,60,60,'#000000'),type:'image',data:imageData};
    const doc={format:'vectorroom',version:1,objects:[gradient,combined,image]};await source.locator('#openProject').setInputFiles(file('detail.vectorroom',doc));await source.waitForFunction(()=>document.querySelector('#status').textContent==='Project opened.');
    const expected=await source.evaluate(async()=>{const bitmap=await createImageBitmap(await pngBlob()),c=document.createElement('canvas');c.width=1000;c.height=700;const x=c.getContext('2d');x.fillStyle='#ffffff';x.fillRect(0,0,1000,700);x.drawImage(bitmap,0,0);return [[45,45],[95,95],[180,50],[230,50],[320,40]].map(([a,b])=>[...x.getImageData(a,b,1,1).data]);});
    await motion.goto(base+'/motionroom/');await motion.locator('#artworkFile').setInputFiles(file('detail.vectorroom',doc));await motion.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));const actual=await motion.evaluate(()=>{const x=document.querySelector('#stage').getContext('2d');return [[45,45],[95,95],[180,50],[230,50],[320,40]].map(([a,b])=>[...x.getImageData(a,b,1,1).data]);});for(let i=0;i<expected.length;i++)for(let channel=0;channel<4;channel++)assert.ok(Math.abs(actual[i][channel]-expected[i][channel])<=2,`pixel ${i}, channel ${channel}`);
  }finally{await source.close();await motion.close();}
});
test('the timeline and animation controls remain usable on a narrow viewport',async()=>{
  const mobile=await browser.newPage({viewport:{width:390,height:844}});
  try{await mobile.goto(base+'/motionroom/');await mobile.locator('#artworkFile').setInputFiles(file('mobile.paintroom',paint));await mobile.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));await mobile.getByRole('button',{name:'Red layer'}).click();await mobile.locator('#x').fill('18');await mobile.locator('#x').dispatchEvent('change');assert.equal(await mobile.locator('#x').inputValue(),'18');const dimensions=await mobile.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1,'the mobile editor should not overflow horizontally');}finally{await mobile.close();}
});
test('dragging a layer creates a keyframe and supports undo and redo',async()=>{
  const editor=await browser.newPage({viewport:{width:1500,height:1000}});
  try{await editor.goto(base+'/motionroom/');await editor.locator('#artworkFile').setInputFiles(file('drag.paintroom',paint));await editor.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));await editor.getByRole('button',{name:'Red layer'}).click();const box=await editor.locator('#stage').boundingBox(),startX=box.x+box.width*.3,startY=box.y+box.height*.3;await editor.mouse.move(startX,startY);await editor.mouse.down();await editor.mouse.move(startX+box.width/12,startY,{steps:4});await editor.mouse.up();assert.ok(Math.abs(Number(await editor.locator('#x').inputValue())-10)<.1);await editor.locator('#undo').click();assert.equal(await editor.locator('#x').inputValue(),'0');await editor.locator('#redo').click();assert.ok(Math.abs(Number(await editor.locator('#x').inputValue())-10)<.1);}finally{await editor.close();}
});
test('a square artwork keeps its proportions when the preview is height-limited',async()=>{
  const editor=await browser.newPage({viewport:{width:1500,height:700}}),square=structuredClone(paint);square.width=square.height=1000;
  try{await editor.goto(base+'/motionroom/');await editor.locator('#artworkFile').setInputFiles(file('square.paintroom',square));await editor.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));const box=await editor.locator('#stage').boundingBox();assert.ok(Math.abs(box.width/box.height-1)<.01,'the canvas element must preserve its aspect ratio');}finally{await editor.close();}
});
test('playback reaches the final keyframe and a recording can be cancelled',async()=>{
  const editor=await browser.newPage({viewport:{width:1500,height:1000}});
  try{
    await editor.goto(base+'/motionroom/');await editor.locator('#artworkFile').setInputFiles(file('play.paintroom',paint));await editor.waitForFunction(()=>document.querySelector('#status').textContent.includes('Artwork ready'));
    await editor.getByRole('button',{name:'Red layer'}).click();await editor.locator('#duration').fill('0.25');await editor.locator('#duration').dispatchEvent('change');await editor.locator('#addKey').click();
    await editor.locator('#seek').evaluate(node=>{node.value='.25';node.dispatchEvent(new Event('input',{bubbles:true}));});await editor.locator('#x').fill('40');await editor.locator('#x').dispatchEvent('change');
    assert.equal(await editor.evaluate(()=>project.layers[0].keyframes.at(-1).x),40,'editing the final keyframe must preserve the value');
    await editor.locator('#seek').evaluate(node=>{node.value='0';node.dispatchEvent(new Event('input',{bubbles:true}));});await editor.locator('#play').click();await editor.waitForFunction(()=>!playing&&time===project.duration);
    assert.equal(await editor.locator('#x').inputValue(),'40');await editor.locator('#duration').fill('2');await editor.locator('#duration').dispatchEvent('change');await editor.locator('#exportVideo').click();await editor.locator('#cancelExport').click();await editor.waitForFunction(()=>document.querySelector('#status').textContent.includes('cancelled'));assert.equal(await editor.locator('#exportVideo').isEnabled(),true);
  }finally{await editor.close();}
});
test('WebM handoff uploads playable video to Cliproom', {timeout:60000},async()=>{
  await input('#duration',1);await page.locator('#sendCliproom').click();await page.waitForFunction(()=>!document.querySelector('#openCliproom').classList.contains('hidden'),null,{timeout:30000});
  const href=await page.locator('#openCliproom').getAttribute('href'),asset=new URL(href,base).searchParams.get('asset');assert.ok(asset);
  const response=await fetch(base+'/api/assets/'+asset+'/metadata'),metadata=await response.json();assert.equal(metadata.type,'video/webm');
  const result=await page.evaluate(async id=>{const video=document.createElement('video');video.muted=true;video.src='/api/assets/'+id;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('Could not decode exported video'));});const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;const ctx=c.getContext('2d');async function sample(time){await new Promise((resolve,reject)=>{video.onseeked=resolve;video.onerror=()=>reject(new Error('Could not seek exported video'));video.currentTime=time;});ctx.drawImage(video,0,0);return [...ctx.getImageData(40,40,1,1).data];}return {width:video.videoWidth,height:video.videoHeight,early:await sample(.1),late:await sample(.9)};},asset);
  assert.equal(result.width,1000);assert.equal(result.height,700);assert.ok(result.early[1]>100&&result.early[0]<80,'the early frame contains the green rectangle');assert.ok(result.late[0]>200&&result.late[1]>200,'the rectangle moves away in the late frame');
  await page.goto(base+href);await page.waitForFunction(id=>state.assets.some(item=>item.id===id)&&state.clips.some(clip=>clip.assetId===id),asset,{timeout:15000});
});
