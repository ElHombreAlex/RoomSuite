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
let temp,work,server,client,browser,page,projectId,clipId,assetId,trackId,titleId,revision=1;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
const edit=(action,fields={},id=crypto.randomUUID())=>call('cliproom_edit_structure',{project_id:projectId,base_revision:revision,action,operation_id:id,...fields});
before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-clip-structure-'));work=path.join(temp,'work');await fs.mkdir(work);server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});client=new Client({name:'clip-structure-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+'/cliproom/');
  const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.fillStyle='#6688aa';x.fillRect(0,0,32,32);return c.toDataURL().split(',')[1];});const response=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'photo.png'},body:Buffer.from(image,'base64')});assert.equal(response.status,201);const asset=await response.json();assetId=asset.id;
  const made=await page.evaluate(meta=>{const id=()=>crypto.randomUUID(),state=T.empty(id);state.assets=[{...meta,kind:'image',width:32,height:32}];const clip={id:id(),assetId:meta.id,trackId:state.videoTracks[0].id,start:0,in:0,out:3,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0};state.clips=[clip];return {state,id:id(),clip:clip.id};},asset);projectId=made.id;clipId=made.clip;const saved=await fetch(base+'/api/projects/'+projectId,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,state:made.state})});assert.equal(saved.status,200);
});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-clip-structure-'));await fs.rm(actual,{recursive:true,force:true});}});

test('people and agents add, rename and toggle tracks with retry-safe writes',async()=>{
  const operation=crypto.randomUUID(),args={project_id:projectId,base_revision:1,action:'add_track',kind:'video',track:{name:'Overlay'},operation_id:operation};const preview=await call('cliproom_edit_structure',{...args,dry_run:true});assert.equal(preview.track.name,'Overlay');assert.equal((await call('cliproom_get_project',{project_id:projectId})).project.revision,1);
  const added=await call('cliproom_edit_structure',args);revision=added.revision;trackId=added.track.id;assert.equal(trackId,operation);const retry=await call('cliproom_edit_structure',args);assert.equal(retry.already_applied,true);assert.equal(retry.applied_revision,2);await assert.rejects(call('cliproom_edit_structure',{...args,track:{name:'Different'}}),/different/);
  const current=(await call('cliproom_get_project',{project_id:projectId})).project;assert.equal(current.state.version,5);await page.evaluate(project=>setState(project.state,project.id,project.revision),current);page.once('dialog',dialog=>dialog.accept('Renamed overlay'));await page.getByRole('button',{name:'Rename Overlay'}).click();await page.locator('#saveBtn').click();await page.waitForFunction(()=>revision===3);revision=3;
  const changed=await edit('update_track',{track_id:trackId,track:{hidden:true,muted:true}});revision=changed.revision;assert.equal(changed.track.name,'Renamed overlay');assert.equal(changed.track.hidden,true);assert.equal(changed.track.muted,true);
  await assert.rejects(edit('update_track',{track_id:crypto.randomUUID(),track:{muted:true}}),/track ID/);
});

test('agents create and position titles that a person can edit and save',async()=>{
  const added=await edit('add_title',{title:{text:'Agent title',start:.2,end:2,x:35,y:65,font:'georgia',size:9,color:'#ffffff'}});revision=added.revision;titleId=added.title.id;assert.equal(added.title.position,'custom');assert.equal(added.title.x,35);
  const changed=await edit('update_title',{title_id:titleId,title:{text:'Adjusted title',rotation:370,bold:false}});revision=changed.revision;assert.equal(changed.title.rotation,10);assert.equal(changed.title.bold,false);
  await assert.rejects(edit('update_title',{title_id:titleId,title:{start:2,end:1}}),/timing/);await assert.rejects(edit('update_title',{title_id:titleId,title:{position:'top',x:20}}),/custom/);
  const current=(await call('cliproom_get_project',{project_id:projectId})).project;await page.evaluate(project=>{setState(project.state,project.id,project.revision);selected={type:'title',id:project.state.titles[0].id};render();},current);assert.equal(await page.locator('#titleText').inputValue(),'Adjusted title');await page.locator('#titleText').fill('Human edited');await page.locator('#titleText').press('Tab');await page.locator('#saveBtn').click();await page.waitForFunction(expected=>revision===expected,revision+1);revision++;assert.equal((await call('cliproom_get_project',{project_id:projectId})).project.state.titles[0].text,'Human edited');
});

test('removing tracks and titles respects explicit clip removal and keeps source media',async()=>{
  const title=await edit('remove_title',{title_id:titleId});revision=title.revision;
  const moved=await call('cliproom_edit_timeline',{project_id:projectId,base_revision:revision,clip_id:clipId,action:'update',operation_id:crypto.randomUUID(),properties:{track_id:trackId}});revision=moved.revision;
  await assert.rejects(edit('remove_track',{track_id:trackId}),/contains clips/);const removed=await edit('remove_track',{track_id:trackId,remove_clips:true});revision=removed.revision;assert.deepEqual(removed.removed_clips,[clipId]);assert.match(removed.warnings.join(' '),/source media/);assert.equal((await fetch(base+'/api/assets/'+assetId)).status,200);
  const current=(await call('cliproom_get_project',{project_id:projectId})).project;assert.equal(current.state.clips.length,0);await assert.rejects(edit('remove_track',{track_id:current.state.videoTracks[0].id}),/at least one/);
});

test('concurrent retries add only one track',async()=>{
  const id=crypto.randomUUID(),args={project_id:projectId,base_revision:revision,action:'add_track',kind:'audio',track:{name:'Voice'},operation_id:id};const pair=await Promise.all([call('cliproom_edit_structure',args),call('cliproom_edit_structure',args)]);assert.deepEqual(pair.map(item=>item.already_applied).sort(),[false,true]);assert.ok(pair.every(item=>item.track.id===id));const saved=(await call('cliproom_get_project',{project_id:projectId})).project;assert.equal(saved.state.audioTracks.filter(item=>item.id===id).length,1);
});
