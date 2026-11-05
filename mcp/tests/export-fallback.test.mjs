import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url),timeline=require('../../cliproom/public/timeline.js');

test('queued server renders recover empty WebM recordings without nesting the queue',{timeout:120000},async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-export-fallback-')),data=path.join(temp,'data'),preload=path.join(temp,'empty-recorder.cjs'),port=24000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
  let server;
  try{
    const playwright=path.join(root,'mcp','node_modules','playwright');
    await fs.writeFile(preload,`const {chromium}=require(${JSON.stringify(playwright)});\nconst launch=chromium.launch.bind(chromium);\nchromium.launch=async(...args)=>{const browser=await launch(...args),make=browser.newContext.bind(browser);browser.newContext=async(...options)=>{const context=await make(...options);await context.addInitScript(()=>{window.MediaRecorder=class EmptyRecorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';setTimeout(()=>this.onstop?.(),0);}};});return context;};return browser;};\n`);
    server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,NODE_OPTIONS:'--require "'+preload.replaceAll('\\','/')+'"',CLIPROOM_PORT:String(port),CLIPROOM_DATA:data,CLIPROOM_RENDER_CONCURRENCY:'1'},stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out.')),15000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',chunk=>{if(String(chunk).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
    const upload=async(name,type,body)=>{const response=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':type,'X-File-Name':name},body});assert.equal(response.status,201);return response.json();};
    const image=await upload('source.jpg','image/jpeg',await fs.readFile(path.join(root,'PixelRoom','dist','sample.jpg'))),project=timeline.empty(randomUUID);
    project.assets=[{...image,kind:'image',width:100,height:100}];project.clips=[{id:randomUUID(),assetId:image.id,trackId:project.videoTracks[0].id,start:0,in:0,out:.6,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}];
    const render=body=>fetch(base+'/api/render',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const recovered=await render({project,render_mode:'realtime',output_format:'webm',include_audio:false});if(!recovered.ok)throw new Error('Recovery failed: '+await recovered.text());assert.equal(recovered.headers.get('x-cliproom-render-mode'),'offline');assert.equal(recovered.headers.get('x-cliproom-render-warning'),'offline-fallback');assert.equal(recovered.headers.get('x-cliproom-audio-included'),'false');const bytes=Buffer.from(await recovered.arrayBuffer());assert.ok(bytes.length>100);assert.equal(bytes.readUInt32BE(0),0x1a45dfa3);
    const mp4=await render({project,render_mode:'realtime',output_format:'mp4',include_audio:false});assert.equal(mp4.status,422);assert.match((await mp4.json()).error,/did not produce a video/i);
    const rate=48000,frames=rate*2,wav=Buffer.alloc(44+frames*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)wav.writeInt16LE(Math.round(Math.sin(i*440*Math.PI*2/rate)*10000),44+i*2);
    const audio=await upload('tone.wav','audio/wav',wav),unsupported=structuredClone(project);unsupported.assets.push({...audio,kind:'audio',duration:2});unsupported.audioClips=[{id:randomUUID(),assetId:audio.id,trackId:unsupported.audioTracks[0].id,start:0,in:0,out:1.2,rate:2,volume:1,fadeIn:0,fadeOut:0}];
    const rejected=await render({project:unsupported,render_mode:'realtime',output_format:'webm',include_audio:true});assert.equal(rejected.status,422);assert.match((await rejected.json()).error,/Every frame export is unavailable.*normal speed/i);
  }finally{
    if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
    const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-export-fallback-'));await fs.rm(actual,{recursive:true,force:true});
  }
});
