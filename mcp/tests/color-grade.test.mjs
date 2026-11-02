import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url)), port=26000+Math.floor(Math.random()*15000), base='http://127.0.0.1:'+port;
let temp,work,server,client,browser,page,projectId,clipIds,pixelRevision,pixelLayer,referencePixel,roundTripId;
async function call(name,args={}) { const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw Object.assign(new Error(result.content?.map(item=>item.text).join(' ')||'Tool failed'),{detail:result.structuredContent});return result.structuredContent; }
async function errorCall(name,args) { const result=await client.callTool({name,arguments:args},{timeout:180000});assert.equal(result.isError,true);return result.structuredContent.error; }
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-grade-test-'));work=path.join(temp,'workspace');await fs.mkdir(work);
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  client=new Client({name:'grade-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
  await page.goto(base+'/pixelroom/');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='rgb(80,120,160)';x.fillRect(0,0,64,64);return c.toDataURL('image/png').split(',')[1];});
  await fs.writeFile(path.join(work,'source.png'),Buffer.from(png,'base64'));
});
after(async()=>{
  if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-grade-test-'));await fs.rm(actual,{recursive:true,force:true});}
});
test('human makes an editable look, shares it, and exports an image',async()=>{
  await page.locator('#imageInput').setInputFiles(path.join(work,'source.png'));await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Photo opened'));
  await page.locator('[data-grade-details="advanced"] summary').click();
  for(const [key,value] of [['exposure_ev','.5'],['temperature','24'],['shadows','18'],['vibrance','25']])await page.locator(`[data-grade-key="${key}"]`).evaluate((input,next)=>{input.value=next;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);
  await page.locator('[data-grade-details="library"] summary').click();await page.locator('[data-grade-name]').fill('Summer');await page.locator('[data-grade-tags]').fill('warm, holiday');await page.locator('[data-grade-action="save"]').click();
  await page.locator('[data-grade-action="save-shared"]').click();await page.locator('.shared-name input').fill('Summer.roomgrade');await page.locator('.shared-save').click();await page.locator('.shared-picker').waitFor({state:'detached'});
  const shared=await call('roomsuite_shared_download',{path:'Summer.roomgrade',output:'Summer.roomgrade'});assert.ok(shared.bytes>0);
  const preset=await call('roomsuite_preset_get',{path:'Summer.roomgrade'});assert.equal(preset.preset.name,'Summer');assert.equal(preset.preset.adjustments.temperature,24);
  const [projectDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#saveProjectBtn').click()]);await projectDownload.saveAs(path.join(work,'source.pixelroom'));
  assert.equal(JSON.parse(await fs.readFile(path.join(work,'source.pixelroom'),'utf8')).version,2);
  const inspect=await call('pixelroom_project_inspect',{path:'source.pixelroom'});pixelRevision=inspect.revision;pixelLayer=inspect.layers[0].id;assert.equal(inspect.layers[0].grade.adjustments.exposure_ev,.5);
  await page.locator('[data-grade-compare]').selectOption('before');
  await page.locator('#exportBtn').click();const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#downloadBtn').click()]);await download.saveAs(path.join(work,'reference.png'));
  referencePixel=await page.evaluate(async()=>{const file=await (await fetch('/api/workspace/file?path=Summer.roomgrade')).blob();return file.size;});assert.ok(referencePixel>0);
  referencePixel=await pixelFromFile(path.join(work,'reference.png'));
  assert.ok(referencePixel[0]>80,'the export keeps the grade while before comparison is shown');
});
async function pixelFromFile(file) {
  await page.evaluate(()=>{let input=document.querySelector('#pixel-probe');if(!input){input=document.createElement('input');input.type='file';input.id='pixel-probe';document.body.append(input);}});
  await page.locator('#pixel-probe').setInputFiles(file);
  return page.evaluate(async()=>{const image=await createImageBitmap(document.querySelector('#pixel-probe').files[0]),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();return [...ctx.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data];});
}
test('MCP updates an editable image project with a checked revision',async()=>{
  const preview=await call('pixelroom_apply_preset',{project_path:'source.pixelroom',layer_id:pixelLayer,base_revision:pixelRevision,preset_path:'Summer.roomgrade',strength:50,dry_run:true});assert.equal(preview.after.strength,50);assert.equal(preview.dry_run,true);
  const saved=await call('pixelroom_apply_preset',{project_path:'source.pixelroom',layer_id:pixelLayer,base_revision:pixelRevision,preset_path:'Summer.roomgrade',strength:50,output:'copy.pixelroom'});assert.equal(saved.after.strength,50);
  const reopened=await call('pixelroom_project_inspect',{path:'copy.pixelroom'});assert.equal(reopened.layers[0].grade.strength,50);
  const stale=await errorCall('pixelroom_apply_preset',{project_path:'source.pixelroom',layer_id:pixelLayer,base_revision:'0'.repeat(64),output:'stale.pixelroom',strength:20});assert.equal(stale.code,'REVISION_CONFLICT');
});
test('MCP applies a shared preset to two selected clips with revision protection',async()=>{
  const png=await fs.readFile(path.join(work,'source.png'));
  const uploaded=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'source.png'},body:png});assert.equal(uploaded.status,201);const asset=await uploaded.json();
  await page.goto(base+'/cliproom/');
  const made=await page.evaluate(meta=>{const id=()=>crypto.randomUUID(),project=T.empty(id);project.name='Grade test';project.assets=[{...meta,kind:'image',width:64,height:64}];const clips=[0,.4].map(start=>({id:id(),assetId:meta.id,trackId:project.videoTracks[0].id,start,in:0,out:.4,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}));project.clips=clips;return {project,ids:clips.map(clip=>clip.id),id:id()};},asset);
  projectId=made.id;clipIds=made.ids;const created=await fetch(base+'/api/projects/'+projectId,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,state:made.project})});assert.equal(created.status,200);
  const preview=await call('cliproom_apply_preset',{project_id:projectId,base_revision:1,clip_ids:clipIds,preset_path:'Summer.roomgrade',dry_run:true});assert.equal(preview.changes.length,2);assert.equal(preview.revision,1);
  const saved=await call('cliproom_apply_preset',{project_id:projectId,base_revision:1,clip_ids:clipIds,preset_path:'Summer.roomgrade'});assert.equal(saved.revision,2);assert.equal(saved.changes.length,2);
  assert.equal((await call('cliproom_get_project',{project_id:projectId})).project.state.version,5);
  const stale=await errorCall('cliproom_apply_preset',{project_id:projectId,base_revision:1,clip_ids:clipIds,strength:50});assert.equal(stale.code,'REVISION_CONFLICT');
  const again=await call('cliproom_apply_preset',{project_id:projectId,base_revision:2,clip_ids:clipIds,preset_path:'Summer.roomgrade'});assert.equal(again.changed,false);assert.equal(again.revision,2);
});
test('PixelRoom export and Cliproom preview share the same grade',async()=>{
  await page.goto(base+'/cliproom/');
  const preview=await page.evaluate(async id=>{const saved=await (await fetch('/api/projects/'+id)).json();setState(saved.state,id,saved.revision);const image=imageFor(asset(saved.state.assets[0].id));await image.decode();currentTime=.1;renderFrame();return [...context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];},projectId);
  for(let i=0;i<3;i++)assert.ok(Math.abs(referencePixel[i]-preview[i])<=2,`channel ${i}: ${referencePixel} versus ${preview}`);
  const grade=await page.evaluate(()=>RoomGrade.readTarget(state.clips[0],'clip'));assert.equal(grade.adjustments.temperature,24);
});
test('a person can apply one look to a track and undo the batch',async()=>{
  await page.locator('.timeline-clip').first().click();const panel=page.locator('#clipGradePanel');await panel.locator('[data-grade-details="library"] summary').click();
  await panel.locator('[data-grade-library]').selectOption('b:1');await panel.locator('[data-grade-action="apply-track"]').click();
  assert.deepEqual(await page.evaluate(()=>state.clips.map(clip=>RoomGrade.readTarget(clip,'clip').adjustments.temperature)),[-22,-22]);
  await page.locator('#undoBtn').click();assert.deepEqual(await page.evaluate(()=>state.clips.map(clip=>RoomGrade.readTarget(clip,'clip').adjustments.temperature)),[24,24]);
});
test('local audio waveforms match the MCP peak envelope',async()=>{
  const rate=8000,frames=rate*2,wav=Buffer.alloc(44+frames*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40);
  for(let i=rate;i<frames;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*16000),44+i*2);await fs.writeFile(path.join(work,'wave.wav'),wav);
  const result=await call('cliproom_analyze_waveform',{input:'wave.wav',bins:8});assert.equal(result.peaks.length,8);assert.ok(result.peaks[0]<.01);assert.ok(result.peaks[7]>.4);
  const uploaded=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'audio/wav','X-File-Name':'wave.wav'},body:wav});const audio=await uploaded.json();
  await page.evaluate(meta=>{state.assets.push({...meta,kind:'audio',duration:2});state.audioClips.push({id:crypto.randomUUID(),assetId:meta.id,trackId:state.audioTracks[0].id,start:0,in:0,out:2,rate:1,volume:1,fadeIn:0,fadeOut:0});render();},audio);
  await page.locator('#waveformBtn').click();await page.locator('.audio-waveform').waitFor({timeout:30000});assert.equal(await page.locator('#waveformBtn').getAttribute('aria-pressed'),'true');
  const visible=await page.locator('.audio-waveform').evaluate(canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;return [...data].some((value,index)=>index%4===3&&value>0);});assert.equal(visible,true);
});
test('headless export retains the look and rejects malformed presets',async()=>{
  const output=await call('cliproom_render_project',{project_id:projectId,output:'graded.webm',render_mode:'offline'});assert.ok(output.bytes>100);
  await page.evaluate(()=>{const input=document.createElement('input');input.id='video-probe';input.type='file';document.body.append(input);});await page.locator('#video-probe').setInputFiles(output.path);
  const encoded=await page.evaluate(async()=>{const url=URL.createObjectURL(document.querySelector('#video-probe').files[0]),v=document.createElement('video');v.muted=true;v.src=url;await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(new Error('Could not decode the rendered video.'));});v.currentTime=.1;await new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=reject;});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const pixel=[...x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data];URL.revokeObjectURL(url);return pixel;});
  for(let i=0;i<3;i++)assert.ok(Math.abs(referencePixel[i]-encoded[i])<=20,`encoded channel ${i}: ${referencePixel} versus ${encoded}`);
  await fs.writeFile(path.join(work,'bad.roomgrade'),JSON.stringify({format:'roomsuite.color-preset',schema_version:1,color_pipeline_version:1,name:'bad',adjustments:{temperature:999}}));
  await assert.rejects(call('roomsuite_preset_get',{path:'bad.roomgrade'}),/temperature/);
  const analysis=await call('roomsuite_color_analyze',{input:'source.png'});assert.deepEqual(analysis.mean_rgb,[80,120,160]);assert.equal(analysis.pixels,4096);
});
test('a shared human look survives an agent edit and a human strength adjustment and export',async()=>{
  const assembled=await call('cliproom_render',{output:'workflow-ungraded.webm',render_mode:'offline',save_project:true,media:[{input:'source.png',duration:.5},{input:'source.png',duration:.5}]});
  roundTripId=assembled.project.id;const assembledProject=(await call('cliproom_get_project',{project_id:roundTripId})).project,ids=assembledProject.state.clips.map(clip=>clip.id);
  const applied=await call('cliproom_apply_preset',{project_id:roundTripId,base_revision:1,clip_ids:ids,preset_path:'Summer.roomgrade'});assert.equal(applied.changes.length,2);assert.equal(applied.revision,2);
  const agent=await call('cliproom_render_project',{project_id:roundTripId,output:'workflow-agent.webm',render_mode:'offline'});assert.ok(agent.bytes>100);
  await page.evaluate(async id=>{const project=await(await fetch('/api/projects/'+id)).json();setState(project.state,id,project.revision);await imageFor(asset(project.state.assets[0].id)).decode();},roundTripId);
  await page.locator('.timeline-clip').first().click();const strength=page.locator('#clipGradePanel [data-grade-key="strength"]');
  await strength.evaluate(input=>{input.value='60';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.deepEqual(await page.evaluate(()=>state.clips.map(clip=>RoomGrade.readTarget(clip,'clip').strength)),[60,100]);
  const beforeExport=await page.evaluate(()=>{currentTime=.1;renderFrame();return [...context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>revision===3);
  await page.locator('#exportBtn').click();await page.locator('#exportFormatChoice').selectOption('webm');const [download]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.locator('#startExportBtn').click()]);await download.saveAs(path.join(work,'workflow-human.webm'));
  await page.locator('#video-probe').setInputFiles(path.join(work,'workflow-human.webm'));
  const encoded=await page.evaluate(async()=>{const url=URL.createObjectURL(document.querySelector('#video-probe').files[0]),v=document.createElement('video');v.muted=true;v.src=url;await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});v.currentTime=.1;await new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=reject;});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const pixel=[...x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data];URL.revokeObjectURL(url);return pixel;});
  for(let i=0;i<3;i++)assert.ok(Math.abs(beforeExport[i]-encoded[i])<=25,`human export differs: ${beforeExport} versus ${encoded}`);
});
test('a short 1080p two-track graded video project renders offline',{timeout:120000},async t=>{
  const recorded=await page.evaluate(async()=>{
    const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d'),stream=c.captureStream(15),parts=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};recorder.start();
    for(let i=0;i<10;i++){x.fillStyle=`rgb(${70+i*3},120,160)`;x.fillRect(0,0,c.width,c.height);await new Promise(resolve=>setTimeout(resolve,70));}
    await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop();});stream.getTracks().forEach(track=>track.stop());
    const blob=await RoomWebM.withDuration(new Blob(parts,{type:'video/webm'}),.7);return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(blob);});
  });
  const video=Buffer.from(recorded,'base64'),uploaded=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'video/webm','X-File-Name':'moving.webm'},body:video});assert.equal(uploaded.status,201);const media=await uploaded.json();
  const original=await (await fetch(base+'/api/projects/'+projectId)).json(),state=structuredClone(original.state),id=crypto.randomUUID(),track=crypto.randomUUID();
  state.assets=[{...media,kind:'video',duration:.7,width:1920,height:1080}];state.quality='1080p';state.videoTracks.push({id:track,name:'Video 2',muted:false,hidden:false});state.clips.forEach(clip=>{clip.assetId=media.id;});state.clips[1].trackId=track;state.clips[1].start=0;
  const saved=await fetch(base+'/api/projects/'+id,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,state})});assert.equal(saved.status,200);
  const start=Date.now(),output=await call('cliproom_render_project',{project_id:id,output:'graded-1080.webm',render_mode:'offline'});assert.ok(output.bytes>100);t.diagnostic('Short 1080p two-track export: '+((Date.now()-start)/1000).toFixed(2)+' seconds on this machine.');
  await page.locator('#video-probe').setInputFiles(output.path);
  const dimensions=await page.evaluate(async()=>{const url=URL.createObjectURL(document.querySelector('#video-probe').files[0]),v=document.createElement('video');v.src=url;await new Promise((resolve,reject)=>{v.onloadedmetadata=resolve;v.onerror=reject;});const size=[v.videoWidth,v.videoHeight];URL.revokeObjectURL(url);return size;});assert.deepEqual(dimensions,[1920,1080]);
});
test('FilesRoom and MCP can recover the same shared file',async()=>{
  await page.goto(base+'/files/');const row=page.locator('.file-row').filter({hasText:'Summer.roomgrade'});await row.waitFor();
  const destinations=await row.locator('select option').allTextContents();assert.ok(destinations.includes('PixelRoom'));assert.ok(destinations.includes('Cliproom'));
  page.once('dialog',dialog=>dialog.accept());await row.getByRole('button',{name:'Move to trash'}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Moved to trash'));
  const listed=await call('roomsuite_trash_list');const entry=listed.entries.find(item=>item.originalPath==='Summer.roomgrade');assert.ok(entry);
  await call('roomsuite_trash_restore',{id:entry.id});assert.ok((await (await fetch(base+'/api/workspace/list?path=')).json()).entries.some(item=>item.name==='Summer.roomgrade'));
  const moved=await call('roomsuite_shared_trash',{path:'Summer.roomgrade'});await page.locator('#openTrash').click();await page.getByText('Summer.roomgrade',{exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.accept('Summer.roomgrade'));await page.getByRole('button',{name:'Restore',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#trashStatus').textContent.includes('Restored'));
  assert.ok(!(await call('roomsuite_trash_list')).entries.some(item=>item.id===moved.id));
  await page.goto(base+'/pixelroom/?shared_file=Summer.roomgrade');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Preset imported'));
  await page.goto(base+'/cliproom/?shared_file=Summer.roomgrade');await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Preset imported'));
});
test('saved looks and editable clip values survive a server restart',async()=>{
  server.kill();await new Promise(resolve=>server.once('exit',resolve));
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server restart timed out.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  const saved=await call('cliproom_get_project',{project_id:projectId});assert.equal(saved.project.revision,2);assert.equal(saved.project.state.clips[1].colorGrade.temperature,24);
  const roundTrip=await call('cliproom_get_project',{project_id:roundTripId});assert.equal(roundTrip.project.revision,3);assert.deepEqual(roundTrip.project.state.clips.map(clip=>clip.colorGrade.strength),[60,100]);
  const list=await call('roomsuite_shared_list');assert.ok(list.entries.some(item=>item.name==='Summer.roomgrade'));
});
test('grading controls remain usable at a phone-sized viewport',async()=>{
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{await mobile.goto(base+'/pixelroom/');await mobile.locator('#imageInput').setInputFiles(path.join(work,'source.png'));await mobile.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Photo opened'));
    await mobile.locator('[data-grade-details="advanced"] summary').click();assert.equal(await mobile.locator('[data-grade-key="temperature"]').count(),1);
    await mobile.locator('[data-grade-key="temperature"]').evaluate(input=>{input.value='20';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await mobile.evaluate(()=>PixelRoomGrade.get().adjustments.temperature),20);
    if(process.env.ROOMSUITE_GRADE_QA_DIR){await fs.mkdir(process.env.ROOMSUITE_GRADE_QA_DIR,{recursive:true});await mobile.screenshot({path:path.join(process.env.ROOMSUITE_GRADE_QA_DIR,'mobile-grade.png')});}
  }finally{await mobile.close();}
});
test('PixelRoom still runs when only its static dist directory is served',async()=>{
  const dist=path.join(root,'PixelRoom','dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.wasm':'application/wasm'};
  const staticServer=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,relative=pathname==='/'?'index.html':pathname.slice(1),file=path.resolve(dist,relative);if(!file.startsWith(dist+path.sep)){res.writeHead(404).end();return;}const stream=createReadStream(file);stream.on('error',()=>{if(!res.headersSent)res.writeHead(404);res.end();});res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');stream.pipe(res);});
  await new Promise(resolve=>staticServer.listen(0,'127.0.0.1',resolve));const standalone=await browser.newPage();
  try{await standalone.goto('http://127.0.0.1:'+staticServer.address().port+'/');await standalone.locator('#imageInput').setInputFiles(path.join(work,'source.png'));await standalone.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Photo opened'));await standalone.evaluate(()=>PixelRoomGrade.apply({temperature:20}));assert.equal(await standalone.evaluate(()=>PixelRoomGrade.get().adjustments.temperature),20);}
  finally{await standalone.close();await new Promise(resolve=>staticServer.close(resolve));}
});
