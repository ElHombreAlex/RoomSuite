import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright';

const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*20000),base='http://127.0.0.1:'+port;
let temp,work,server,client,browser;
async function call(name,args){const r=await client.callTool({name,arguments:args},{timeout:180000});if(r.isError)throw new Error(r.content.map(x=>x.text).join(' '));return r.structuredContent||JSON.parse(r.content[0].text);}
async function pixels(filename,points,time=null){const page=await browser.newPage();try{await page.goto(base+'/cliproom/');await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='qaFile';document.body.append(input);});await page.locator('#qaFile').setInputFiles(path.join(work,filename));return await page.evaluate(async({points,time})=>{const file=document.querySelector('#qaFile').files[0],url=URL.createObjectURL(file);let source;
  try{if(time===null){source=new Image();source.src=url;await source.decode();}else{source=document.createElement('video');source.src=url;source.muted=true;await new Promise((resolve,reject)=>{source.onloadedmetadata=resolve;source.onerror=reject;});source.currentTime=time;await new Promise((resolve,reject)=>{source.onseeked=resolve;source.onerror=reject;});}
    const canvas=document.createElement('canvas');canvas.width=source.naturalWidth||source.videoWidth;canvas.height=source.naturalHeight||source.videoHeight;const ctx=canvas.getContext('2d');ctx.drawImage(source,0,0);return points.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data]);
  }finally{URL.revokeObjectURL(url);}}, {points,time});}finally{await page.close();}}
function wav(){const rate=48000,count=rate*2,b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)b.writeInt16LE(Math.round(Math.sin(i*440*2*Math.PI/rate)*10000),44+i*2);return b;}
async function peakDb(file){const b=await fs.readFile(path.join(work,file));let peak=0;for(let i=44;i+1<b.length;i+=2)peak=Math.max(peak,Math.abs(b.readInt16LE(i)));return 20*Math.log10(peak/32768);}
before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-feedback-'));work=path.join(temp,'agent');await fs.mkdir(work);await fs.writeFile(path.join(work,'tone.wav'),wav());server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('server exited '+code)));server.stdout.on('data',v=>{if(String(v).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'});client=new Client({name:'creative-feedback',version:'1.0.0'});await client.connect(transport);browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}const rel=path.relative(os.tmpdir(),temp||'');if(temp&&rel.startsWith('roomsuite-feedback-')&&!rel.includes(path.sep))await fs.rm(temp,{recursive:true,force:true});});

test('filled PaintRoom and thin VectorRoom shapes use their requested colors',async()=>{
  const art=await call('paintroom_create',{name:'Frame',width:200,height:120,transparent:true,elements:[{type:'ellipse',x:20,y:20,x2:100,y2:100,fill:'#a89472'}]});
  await call('paintroom_export',{project_id:art.project_id,format:'png',output:'paint.png'});const [outside,inside]=await pixels('paint.png',[[16,60],[60,60]]);assert.equal(outside[3],0);assert.deepEqual(inside,[168,148,114,255]);
  await call('vectorroom_create',{output:'vector.png',elements:[{type:'rect',x:0,y:0,width:1000,height:700,fill:'#e0d0b0'},{type:'rect',x:50,y:100,width:200,height:2,fill_mode:'solid',fill:'#a89472'}]});
  const [line,above]=await pixels('vector.png',[[100,100],[100,99]]);assert.deepEqual(line,[168,148,114,255]);assert.deepEqual(above,[224,208,176,255]);
});
test('SoundRoom normalizes with a configurable peak and headroom',async()=>{
  await call('soundroom_edit',{input:'tone.wav',output:'default.wav',normalize:true});const peak=await peakDb('default.wav');assert.ok(peak<=-3&&peak>-3.2,'default peak '+peak);
  await call('soundroom_edit',{input:'tone.wav',output:'minus6.wav',normalize_peak_dbfs:-6});const alternate=await peakDb('minus6.wav');assert.ok(alternate<=-6&&alternate>-6.2,'custom peak '+alternate);
});
test('CaptureRoom fits a scene and exports a WebM Cliproom can import',async()=>{
  const scene=await call('captureroom_record_scene',{output:'capture',image:'vector.png',text:'This long heading wraps across multiple lines safely',text_box:{x:160,y:30,width:300,height:300},font_size:64,color:'#000000',duration:1.3});assert.ok(scene.bytes>1000);
  const name=path.basename(scene.path),info=await call('roomsuite_media_info',{input:name});assert.ok(info.duration_seconds>1&&info.duration_seconds<2,'capture duration '+info.duration_seconds);
  const [bar,plate]=await pixels(name,[[20,400],[200,400]],.5);assert.ok(bar[0]<70&&bar[1]<70&&bar[2]<80,'letterbox '+bar);assert.ok(plate[0]>180&&plate[1]>160&&plate[2]>120,'image '+plate);
  const imported=await call('cliproom_import_media',{input:name});assert.ok(imported.asset.duration>1&&imported.asset.duration<2);
  const output=await call('cliproom_render',{output:'capture-in-cliproom',render_mode:'offline',media:[{input:name,source_out:1}]});assert.ok(output.bytes>1000);
});
test('Cliproom can read recordings made before duration metadata was added',async()=>{
  const page=await browser.newPage({acceptDownloads:true});try{await page.goto(base+'/captureroom/');await page.evaluate(()=>{RoomWebM.withDuration=async blob=>blob;});await page.locator('#addText').click();await page.locator('#record').click();await page.waitForTimeout(1200);await page.locator('#record').click();await page.waitForSelector('#result:not(.hidden)');const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);await download.saveAs(path.join(work,'legacy.webm'));}finally{await page.close({runBeforeUnload:false});}
  const info=await call('roomsuite_media_info',{input:'legacy.webm'});assert.ok(info.duration_seconds>1&&info.duration_seconds<2,'legacy duration '+info.duration_seconds);
  const asset=await call('cliproom_import_media',{input:'legacy.webm'});assert.ok(asset.asset.duration>1&&asset.asset.duration<2);
});
test('Cliproom repeats a 10-second frame sequence using two unique assets',async()=>{
  const output=await call('cliproom_render',{output:'loop',save_project:true,render_mode:'offline',background:'#000000',media:[{input:'tone.wav'}],frame_sequence:{frames:['vector.png','paint.png'],fps:12,duration:10}});assert.ok(Math.abs(output.duration_seconds-10)<1e-9);
  const project=await (await fetch(base+'/api/projects/'+output.project.id)).json();assert.equal(project.state.assets.filter(a=>a.kind==='image').length,2);assert.equal(project.state.assets.length,3);assert.equal(project.state.clips.length,120);assert.equal(project.state.background,'#000000');assert.ok(Math.abs(project.state.clips.at(-1).start+project.state.clips.at(-1).out-10)<1e-9);
  const info=await call('roomsuite_media_info',{input:path.basename(output.path)});assert.ok(Math.abs(info.duration_seconds-10)<.01,'video duration '+info.duration_seconds);
  const first=await pixels(path.basename(output.path),[[700,350]],.02),second=await pixels(path.basename(output.path),[[700,350]],.12);assert.notDeepEqual(first,second);
});
test('a configurable black Cliproom background makes a dark fade darken',async()=>{
  await call('vectorroom_create',{output:'dark.png',elements:[{type:'rect',x:0,y:0,width:1000,height:700,fill:'#202020'}]});
  const result=await call('cliproom_render',{output:'dark-fade',render_mode:'offline',background:'#000000',media:[{input:'dark.png',duration:1,fade_out:1}]});
  const name=path.basename(result.path),early=(await pixels(name,[[640,360]],.1))[0],late=(await pixels(name,[[640,360]],.8))[0];assert.ok(late[0]<early[0]-5,'fade '+early+' -> '+late);
});
test('repeated ordinary media entries reuse the same imported asset',async()=>{
  const result=await call('cliproom_render',{output:'reused',render_mode:'offline',save_project:true,media:[{input:'paint.png',duration:.3},{input:'paint.png',duration:.3}]});const project=await (await fetch(base+'/api/projects/'+result.project.id)).json();assert.equal(project.state.assets.length,1);assert.equal(project.state.clips.length,2);assert.equal(project.state.clips[0].assetId,project.state.clips[1].assetId);
});
