import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
let temp,server,client,browser,page,projectId,clipId,splitId;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-timeline-edit-'));const work=path.join(temp,'work');await fs.mkdir(work);
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  client=new Client({name:'timeline-edit-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+'/cliproom/');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='#6688aa';x.fillRect(0,0,32,32);return c.toDataURL().split(',')[1];});
  const upload=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'source.png'},body:Buffer.from(png,'base64')});assert.equal(upload.status,201);const asset=await upload.json();
  const state=await page.evaluate(asset=>{const project=T.empty(()=>crypto.randomUUID());project.name='Timeline edit';project.assets=[{...asset,kind:'image',width:32,height:32}];project.clips=[{id:crypto.randomUUID(),assetId:asset.id,trackId:project.videoTracks[0].id,start:0,in:0,out:4,rate:1,volume:1,fadeIn:0,fadeOut:0,fit:'contain',opacity:1,scale:1,x:50,y:50,rotation:0,flipX:false,brightness:100,contrast:100,saturation:100,keyframes:[{id:crypto.randomUUID(),time:0,x:10},{id:crypto.randomUUID(),time:4,x:90}]}];return project;},asset);
  clipId=state.clips[0].id;projectId=crypto.randomUUID();const saved=await fetch(base+'/api/projects/'+projectId,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,state})});assert.equal(saved.status,200);
});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-timeline-edit-'));await fs.rm(actual,{recursive:true,force:true});}});

test('timeline updates preview safely, enforce revisions and reuse completed operation IDs',async()=>{
  const args={project_id:projectId,base_revision:1,clip_id:clipId,action:'update',properties:{start:2,source_in:1,source_out:3,speed:2,volume:.8,fade_in:5}};
  const preview=await call('cliproom_edit_timeline',{...args,dry_run:true});assert.equal(preview.after.fade_in,1);assert.ok(preview.warnings.some(value=>value.includes('shortened')));assert.equal((await call('cliproom_get_project',{project_id:projectId})).project.revision,1);
  const id=crypto.randomUUID(),saved=await call('cliproom_edit_timeline',{...args,operation_id:id});assert.equal(saved.revision,2);assert.equal(saved.already_applied,false);
  assert.equal((await call('cliproom_get_project',{project_id:projectId})).project.state.version,5);
  const retry=await call('cliproom_edit_timeline',{...args,operation_id:id});assert.equal(retry.already_applied,true);assert.equal(retry.applied_revision,2);assert.equal(retry.revision,2);
  await assert.rejects(call('cliproom_edit_timeline',{...args,operation_id:id,properties:{start:5}}),/operation ID.*different/);
  await assert.rejects(call('cliproom_edit_timeline',{...args,operation_id:crypto.randomUUID()}),/changed/);
  await assert.rejects(call('cliproom_edit_timeline',{...args,base_revision:2,operation_id:crypto.randomUUID(),properties:{source_in:3,source_out:1}}),/source range/);
  assert.equal((await call('cliproom_get_project',{project_id:projectId})).project.revision,2);
});
test('concurrent split retries create one clip and preserve source-time motion',async()=>{
  splitId=crypto.randomUUID();const args={project_id:projectId,base_revision:2,clip_id:clipId,action:'split',timeline_time:2.5,operation_id:splitId};
  const pair=await Promise.all([call('cliproom_edit_timeline',args),call('cliproom_edit_timeline',args)]);assert.deepEqual(pair.map(item=>item.already_applied).sort(),[false,true]);assert.ok(pair.every(item=>item.new_clip.id===splitId));
  const saved=(await call('cliproom_get_project',{project_id:projectId})).project;assert.equal(saved.revision,3);assert.equal(saved.state.clips.length,2);assert.equal(saved.state.clips[0].out,2);assert.equal(saved.state.clips[1].in,2);
  await page.evaluate(project=>{setState(project.state,project.id,project.revision);},saved);assert.equal(await page.evaluate(()=>T.animatedValues(state.clips[1],2.75).x),60);
  await assert.rejects(call('cliproom_edit_timeline',{project_id:projectId,base_revision:3,clip_id:clipId,action:'split',operation_id:crypto.randomUUID()}),/timeline_time/);
});
test('creative keyframes are editable and a completed split remains retry-safe after later edits',async()=>{
  const id=crypto.randomUUID(),added=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:3,clip_id:clipId,action:'set_keyframe',timeline_time:2.25,operation_id:id,keyframe:{creative_look:{hsl:{red:{hue:20}}},grain:30}});assert.equal(added.revision,4);assert.equal(added.keyframe.time,1.5);
  const saved=(await call('cliproom_get_project',{project_id:projectId})).project;assert.equal(saved.state.version,5);assert.equal(saved.state.clips[0].keyframes.find(frame=>frame.id===id).creativeLook.hsl.red.hue,20);
  const retry=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:2,clip_id:clipId,action:'split',timeline_time:2.5,operation_id:splitId});assert.equal(retry.already_applied,true);assert.equal(retry.applied_revision,3);assert.equal(retry.revision,4);
  const deleted=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:4,clip_id:clipId,action:'delete_keyframe',source_time:1.5,operation_id:crypto.randomUUID()});assert.equal(deleted.revision,5);assert.equal(deleted.keyframe_removed.id,id);
});
test('duplicate, dissolve and remove update the saved timeline without deleting source media',async()=>{
  const duplicateId=crypto.randomUUID(),duplicate=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:5,clip_id:splitId,action:'duplicate',operation_id:duplicateId});assert.equal(duplicate.new_clip.id,duplicateId);assert.equal(duplicate.new_clip.start,3);assert.equal(duplicate.revision,6);
  const transition=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:6,clip_id:duplicateId,action:'dissolve',duration_seconds:.2,operation_id:crypto.randomUUID()});assert.equal(transition.revision,7);assert.equal(transition.transition.previous,splitId);
  const removed=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:7,clip_id:splitId,action:'remove',operation_id:crypto.randomUUID()});assert.equal(removed.revision,8);assert.ok(removed.warnings.some(message=>message.includes('source remains')));
  const saved=(await call('cliproom_get_project',{project_id:projectId})).project;assert.equal(saved.state.assets.length,1);assert.equal(saved.state.clips.length,2);
  await page.evaluate(project=>{setState(project.state,project.id,project.revision);},saved);assert.equal(await page.evaluate(()=>state.clips.length),2);
});
test('audio clips reject picture edits and keep volume keyframes on source time',async()=>{
  const wav=Buffer.alloc(44+8000*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const upload=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'audio/wav','X-File-Name':'audio.wav'},body:wav});assert.equal(upload.status,201);const asset=await upload.json();
  const state=await page.evaluate(asset=>{const project=T.empty(()=>crypto.randomUUID());project.name='Audio timeline';project.assets=[{...asset,kind:'audio',duration:1}];project.audioClips=[{id:crypto.randomUUID(),assetId:asset.id,trackId:project.audioTracks[0].id,start:2,in:0,out:1,rate:1,volume:1,fadeIn:0,fadeOut:0}];return project;},asset),audioProject=crypto.randomUUID(),audioId=state.audioClips[0].id;
  const response=await fetch(base+'/api/projects/'+audioProject,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,state})});assert.equal(response.status,200);
  const common={project_id:audioProject,base_revision:1,clip_id:audioId,operation_id:crypto.randomUUID()};
  await assert.rejects(call('cliproom_edit_timeline',{...common,action:'update',properties:{opacity:.5}}),/Picture properties/);
  await assert.rejects(call('cliproom_edit_timeline',{...common,action:'set_keyframe',timeline_time:2.5,keyframe:{grain:20}}),/volume only/);
  const frame=await call('cliproom_edit_timeline',{...common,action:'set_keyframe',timeline_time:2.5,keyframe:{volume:.3}});assert.equal(frame.keyframe.time,.5);assert.equal(frame.revision,2);
  const saved=(await call('cliproom_get_project',{project_id:audioProject})).project;assert.equal(saved.state.audioClips[0].keyframes[0].volume,.3);
});
