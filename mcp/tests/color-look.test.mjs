import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
let temp,work,server,client,browser,page,preset,reference,clipProjectId,clipIds;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-look-test-'));work=path.join(temp,'workspace');await fs.mkdir(work);
  const lines=['TITLE "Swap red and blue"','LUT_3D_SIZE 2','DOMAIN_MIN 0 0 0','DOMAIN_MAX 1 1 1'];for(let b=0;b<2;b++)for(let g=0;g<2;g++)for(let r=0;r<2;r++)lines.push([b,g,r].join(' '));await fs.writeFile(path.join(work,'swap.cube'),lines.join('\n'));
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timed out.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  client=new Client({name:'advanced-look-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});await page.goto(base+'/pixelroom/');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='rgb(180,90,50)';x.fillRect(0,0,64,64);x.clearRect(0,0,8,8);return c.toDataURL().split(',')[1];});await fs.writeFile(path.join(work,'source.png'),Buffer.from(png,'base64'));
});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-look-test-'));await fs.rm(actual,{recursive:true,force:true});}});
async function change(selector,value){await page.locator(selector).evaluate((input,next)=>{input.value=String(next);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function pixels(file){await page.evaluate(()=>{let input=document.querySelector('#look-probe');if(!input){input=document.createElement('input');input.id='look-probe';input.type='file';document.body.append(input);}});await page.locator('#look-probe').setInputFiles(file);return page.evaluate(async()=>{const image=await createImageBitmap(document.querySelector('#look-probe').files[0]),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(image,0,0);image.close();return [...x.getImageData(0,0,c.width,c.height).data];});}
test('grading sections stay open when a range changes before toggle events run',async()=>{
  const editor=await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await editor.goto(base+'/pixelroom/');await editor.locator('#imageInput').setInputFiles(path.join(work,'source.png'));await editor.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Photo opened'));
    const state=await editor.evaluate(()=>{
      const find=name=>document.querySelector(`[data-grade-details="${name}"]`);
      find('creative').open=true;find('wheels').open=true;
      const select=document.querySelector('[data-look-select="wheel"]');select.focus();select.value='midtones';select.dispatchEvent(new Event('change',{bubbles:true}));
      const current=document.querySelector('[data-look-select="wheel"]');return {creative:find('creative').open,wheels:find('wheels').open,range:current.value,focused:document.activeElement===current};
    });
    assert.deepEqual(state,{creative:true,wheels:true,range:'midtones',focused:true});
    await editor.locator('[data-look-wheel]').click({position:{x:110,y:64}});
    assert.notEqual(await editor.evaluate(()=>PixelRoomGrade.get().look.wheels.midtones.color),'#ffffff');
    assert.equal(await editor.locator('[data-grade-details="wheels"]').evaluate(detail=>detail.open),true);
    const switched=await editor.evaluate(()=>{
      const find=name=>document.querySelector(`[data-grade-details="${name}"]`);
      find('wheels').open=false;find('curves').open=true;
      const select=document.querySelector('[data-look-select="curve"]');select.value='red';select.dispatchEvent(new Event('change',{bubbles:true}));
      return {creative:find('creative').open,curves:find('curves').open,wheels:find('wheels').open};
    });
    assert.deepEqual(switched,{creative:true,curves:true,wheels:false});
    await editor.waitForTimeout(0);await editor.locator('[data-look-select="curve"]').selectOption('blue');
    assert.equal(await editor.locator('[data-grade-details="wheels"]').evaluate(detail=>detail.open),false,'a queued toggle from the old panel must not reopen it');

    const png=await fs.readFile(path.join(work,'source.png'));
    const response=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'race.png'},body:png});assert.equal(response.status,201);const asset=await response.json();
    await editor.goto(base+'/cliproom/');await editor.evaluate(meta=>{
      const project=T.empty(()=>crypto.randomUUID()),id=crypto.randomUUID();project.assets=[{...meta,kind:'image',width:64,height:64}];
      project.clips=[{id,assetId:meta.id,trackId:project.videoTracks[0].id,start:0,in:0,out:1,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}];
      setState(project,crypto.randomUUID(),0);selected={type:'clip',id};render();
    },asset);
    const clipState=await editor.evaluate(()=>{
      const find=name=>document.querySelector(`[data-grade-details="${name}"]`);find('creative').open=true;find('wheels').open=true;
      const select=document.querySelector('[data-look-select="wheel"]');select.focus();select.value='midtones';select.dispatchEvent(new Event('change',{bubbles:true}));
      const current=document.querySelector('[data-look-select="wheel"]');return {creative:find('creative').open,wheels:find('wheels').open,range:current.value,focused:document.activeElement===current};
    });
    assert.deepEqual(clipState,{creative:true,wheels:true,range:'midtones',focused:true});
    await editor.locator('[data-look-wheel]').click({position:{x:110,y:64}});
    assert.notEqual(await editor.evaluate(()=>RoomGrade.readTarget(state.clips[0],'clip').look.wheels.midtones.color),'#ffffff');
    await editor.evaluate(async()=>{document.querySelector('[data-grade-details="wheels"]').open=false;document.querySelector('[data-grade-details="creative"]').open=false;await new Promise(resolve=>setTimeout(resolve,30));});
    const afterInspectorRebuild=await editor.evaluate(()=>{
      const find=name=>document.querySelector(`[data-grade-details="${name}"]`);find('creative').open=true;find('wheels').open=true;
      const amount=document.querySelector('[data-look-key="wheel-amount"]');amount.value='30';amount.dispatchEvent(new Event('input',{bubbles:true}));amount.dispatchEvent(new Event('change',{bubbles:true}));
      return {creative:find('creative').open,wheels:find('wheels').open,amount:Number(document.querySelector('[data-look-key="wheel-amount"]').value)};
    });
    assert.deepEqual(afterInspectorRebuild,{creative:true,wheels:true,amount:30},'a Cliproom inspector rebuild must preserve live section state');
  } finally {await editor.close();}
});
test('a slow real-time export warns that frames may be missing',{timeout:60000},async()=>{
  const png=await fs.readFile(path.join(work,'source.png'));
  const response=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'slow.png'},body:png});assert.equal(response.status,201);const asset=await response.json();
  const editor=await browser.newPage({acceptDownloads:true,viewport:{width:1440,height:1000}});
  try {
    await editor.goto(base+'/cliproom/');await editor.evaluate(async meta=>{
      const project=T.empty(()=>crypto.randomUUID());project.assets=[{...meta,kind:'image',width:64,height:64}];
      project.clips=[{id:crypto.randomUUID(),assetId:meta.id,trackId:project.videoTracks[0].id,start:0,in:0,out:1.2,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}];
      setState(project,crypto.randomUUID(),0);await imageFor(asset(meta.id)).decode();const draw=renderFrame,capture=canvas.captureStream.bind(canvas);window.frameRequests=0;window.canCountFrameRequests=false;
      canvas.captureStream=function(...args){const stream=capture(...args),track=stream.getVideoTracks()[0];if(track?.requestFrame){const request=track.requestFrame.bind(track);track.requestFrame=()=>{window.frameRequests++;return request();};window.canCountFrameRequests=true;}return stream;};
      renderFrame=function(...args){if(recording){const until=performance.now()+200;while(performance.now()<until){}}return draw(...args);};
    },asset);
    await editor.locator('#exportBtn').click();assert.match(await editor.locator('#exportModeHint').textContent(),/may drop frames/i);
    await editor.locator('#exportFormatChoice').selectOption('webm');const [download]=await Promise.all([editor.waitForEvent('download'),editor.locator('#startExportBtn').click()]);assert.ok((await fs.stat(await download.path())).size>100);
    assert.match(await editor.locator('#toast').textContent(),/may be missing frames/i);
    const requests=await editor.evaluate(()=>({supported:window.canCountFrameRequests,count:window.frameRequests}));if(requests.supported)assert.ok(requests.count>0,'completed draws should request capture frames when supported');
  } finally {await editor.close();}
});
test('an empty browser recording reports a recoverable export error',{timeout:60000},async()=>{
  const png=await fs.readFile(path.join(work,'source.png'));
  const response=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'empty.png'},body:png});assert.equal(response.status,201);const asset=await response.json();
  const editor=await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await editor.addInitScript(()=>{window.MediaRecorder=class EmptyRecorder{static isTypeSupported(){return true;}constructor(stream,options){this.state='inactive';window.testRecorderMime=options.mimeType;}start(){this.state='recording';}stop(){this.state='inactive';setTimeout(()=>this.onstop?.(),0);}};});
    await editor.goto(base+'/cliproom/');await editor.evaluate(async meta=>{
      const project=T.empty(()=>crypto.randomUUID());project.assets=[{...meta,kind:'image',width:64,height:64}];
      project.clips=[{id:crypto.randomUUID(),assetId:meta.id,trackId:project.videoTracks[0].id,start:0,in:0,out:.6,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}];
      setState(project,crypto.randomUUID(),0);await imageFor(asset(meta.id)).decode();
    },asset);
    await editor.locator('#exportBtn').click();await editor.locator('#exportFormatChoice').selectOption('webm');await editor.locator('#startExportBtn').click();
    await editor.waitForFunction(()=>exportFailure.includes('did not produce a video'));
    assert.match(await editor.locator('#exportStatus').textContent(),/Try Every frame export/i);assert.equal(await editor.locator('#exportDialog').evaluate(dialog=>dialog.open),true);assert.equal(await editor.evaluate(()=>window.testRecorderMime),'video/webm;codecs=vp8,opus');
  } finally {await editor.close();}
});
test('a person edits creative controls and shares an embedded LUT preset',async()=>{
  const info=await call('roomsuite_lut_inspect',{path:'swap.cube'});assert.equal(info.size,2);assert.equal(info.entries,8);
  await page.locator('#imageInput').setInputFiles(path.join(work,'source.png'));await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Photo opened'));
  await page.locator('[data-grade-details="creative"] > summary').click();await page.locator('[data-grade-details="curves"] > summary').click();await change('[data-look-key="curve"][data-look-index="2"]',65);
  await page.locator('[data-grade-details="hsl"] summary').click();await change('[data-look-key="hsl-hue"]',15);await change('[data-look-key="hsl-saturation"]',20);
  await page.locator('[data-grade-details="wheels"] summary').click();await page.locator('[data-look-select="wheel"]').selectOption('midtones');await page.locator('[data-look-wheel]').click({position:{x:110,y:64}});assert.notEqual(await page.evaluate(()=>PixelRoomGrade.get().look.wheels.midtones.color),'#ffffff');await change('[data-look-key="wheel-color"]','#80bfff');await change('[data-look-key="wheel-amount"]',35);
  await page.locator('[data-grade-details="effects"] summary').click();await change('[data-look-key="effect-grain"]',12);await change('[data-look-key="effect-vignette"]',20);await change('[data-look-key="effect-sharpen"]',15);
  await page.locator('[data-grade-details="lut"] summary').click();await page.locator('[data-grade-cube]').setInputFiles(path.join(work,'swap.cube'));await page.waitForFunction(()=>PixelRoomGrade.get().look.lut?.size===2);
  const state=await page.evaluate(()=>PixelRoomGrade.get());assert.equal(state.look.curves.master[2],.65);assert.equal(state.look.hsl.red.hue,15);assert.equal(state.look.wheels.midtones.amount,35);assert.equal(state.look.grain,12);
  await page.locator('[data-grade-details="library"] summary').click();await page.locator('[data-grade-name]').fill('Advanced look');await page.locator('[data-grade-action="save"]').click();await page.locator('[data-grade-action="save-shared"]').click();await page.locator('.shared-name input').fill('Advanced.roomgrade');await page.locator('.shared-save').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Preset saved to shared files:'));
  await call('roomsuite_shared_download',{path:'Advanced.roomgrade',output:'Advanced.roomgrade'});preset=(await call('roomsuite_preset_get',{path:'Advanced.roomgrade'})).preset;assert.equal(preset.schema_version,2);assert.equal(preset.look.lut.size,2);
  await page.locator('#exportBtn').click();const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#downloadBtn').click()]);await download.saveAs(path.join(work,'reference.png'));reference=await pixels(path.join(work,'reference.png'));assert.equal(reference[3],0);
});
test('MCP creates and applies the same editable advanced look',async()=>{
  const {lut,...look}=preset.look;const created=await call('roomsuite_preset_create',{output:'Agent.roomgrade',name:'Agent',adjustments:preset.adjustments,look,lut_path:'swap.cube'});assert.equal(created.preset.schema_version,2);
  await call('pixelroom_edit',{input:'source.png',output:'agent.png',color_adjustments:preset.adjustments,color_look:look,lut_path:'swap.cube'});
  const rendered=await pixels(path.join(work,'agent.png'));assert.equal(rendered.length,reference.length);let max=0;for(let i=0;i<rendered.length;i++)max=Math.max(max,Math.abs(rendered[i]-reference[i]));assert.ok(max<=1,'UI/MCP image difference '+max);
  const preview=await client.callTool({name:'roomsuite_preset_preview',arguments:{input:'source.png',preset_path:'Advanced.roomgrade'}});assert.equal(preview.isError,undefined);assert.ok(preview.content.some(item=>item.type==='image'&&item.mimeType==='image/png'));assert.notDeepEqual(preview.structuredContent.frames[0].mean_before_rgb,preview.structuredContent.frames[0].mean_after_rgb);assert.equal(preview.structuredContent.grade.look.lut.data,undefined);
  const invalid=await client.callTool({name:'pixelroom_edit',arguments:{input:'source.png',output:'bad.png',preset_path:'Advanced.roomgrade',color_look:{grain:10}}});assert.equal(invalid.isError,true);
});
test('embedded looks survive Cliproom project edits and headless video export',async()=>{
  const png=await fs.readFile(path.join(work,'source.png')),upload=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'source.png'},body:png});assert.equal(upload.status,201);const asset=await upload.json();await page.goto(base+'/cliproom/');
  const made=await page.evaluate(meta=>{const id=()=>crypto.randomUUID(),state=T.empty(id);state.name='Advanced grade';state.assets=[{...meta,kind:'image',width:64,height:64}];state.clips=[0,.4].map(start=>({id:id(),assetId:meta.id,trackId:state.videoTracks[0].id,start,in:0,out:.4,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}));return {state,id:id(),clipIds:state.clips.map(item=>item.id)};},asset);
  clipProjectId=made.id;clipIds=made.clipIds;
  const saved=await fetch(base+'/api/projects/'+made.id,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,state:made.state})});assert.equal(saved.status,200);
  const applied=await call('cliproom_apply_preset',{project_id:made.id,base_revision:1,clip_ids:made.clipIds,preset_path:'Advanced.roomgrade'});assert.equal(applied.revision,2);assert.equal(applied.changes[0].after.look.lut.size,2);assert.equal(applied.changes[0].after.look.lut.data,undefined);
  const persisted=await call('cliproom_get_project',{project_id:made.id});assert.equal(persisted.project.state.clips[1].colorGrade.look.lut.size,2);
  const preview=await page.evaluate(async id=>{const project=await (await fetch('/api/projects/'+id)).json();setState(project.state,id,project.revision);const image=imageFor(asset(project.state.assets[0].id));await image.decode();currentTime=.1;renderFrame();return [...context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];},made.id);
  const center=(32*64+32)*4;for(let i=0;i<3;i++)assert.ok(Math.abs(preview[i]-reference[center+i])<=15,'preview difference '+preview+' '+reference.slice(center,center+4));
  const output=await call('cliproom_render_project',{project_id:made.id,output:'advanced.webm',render_mode:'offline'});assert.ok(output.bytes>100);
  const contact=await client.callTool({name:'roomsuite_preset_preview',arguments:{input:'advanced.webm',preset_path:'Advanced.roomgrade',times:[.1,.3]}});assert.equal(contact.isError,undefined,JSON.stringify(contact.content));assert.equal(contact.structuredContent.frames.length,2);assert.ok(contact.content.some(item=>item.type==='image'));
  await page.evaluate(()=>{const input=document.createElement('input');input.id='video-look-probe';input.type='file';document.body.append(input);});await page.locator('#video-look-probe').setInputFiles(output.path);
  const encoded=await page.evaluate(async()=>{const url=URL.createObjectURL(document.querySelector('#video-look-probe').files[0]),v=document.createElement('video');v.muted=true;v.src=url;await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});v.currentTime=.1;await new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=reject;});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);const pixel=[...x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data];URL.revokeObjectURL(url);return pixel;});
  for(let i=0;i<3;i++)assert.ok(Math.abs(encoded[i]-reference[center+i])<=25,'encoded difference '+encoded+' '+reference.slice(center,center+4));
});
test('finishing effects can be keyframed and preserved through MCP rendering',async()=>{
  const project=(await call('cliproom_get_project',{project_id:clipProjectId})).project;
  project.state.clips[0].keyframes=[{time:0,grain:0,vignette:0,sharpen:0},{time:.4,grain:60,vignette:-40,sharpen:40}];
  const saved=await fetch(base+'/api/projects/'+clipProjectId,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:2,state:project.state})});assert.equal(saved.status,200);
  const interpolated=await page.evaluate(async id=>{const project=await (await fetch('/api/projects/'+id)).json();setState(project.state,id,project.revision);const image=imageFor(asset(project.state.assets[0].id));await image.decode();currentTime=.2;renderFrame();return T.animatedValues(project.state.clips[0],.2);},clipProjectId);
  assert.equal(interpolated.grain,30);assert.equal(interpolated.vignette,-20);assert.equal(interpolated.sharpen,20);
  const preview=await call('cliproom_apply_preset',{project_id:clipProjectId,base_revision:3,clip_ids:[clipIds[0]],strength:50,dry_run:true});assert.ok(preview.warnings.some(message=>message.includes('keyframes')));
  const rendered=await call('cliproom_render',{output:'animated-look.webm',render_mode:'offline',media:[{input:'source.png',duration:.4,color_look:{grain:0,vignette:0},keyframes:[{source_time:0,grain:0},{source_time:.4,grain:60,vignette:-40}]}]});assert.ok(rendered.bytes>100);
});
test('creative keyframes persist, render, validate, and can be captured and undone in the editor',async()=>{
  const animated=await call('cliproom_render',{output:'creative-animation.webm',render_mode:'offline',save_project:true,media:[{input:'source.png',duration:.8,keyframes:[
    {timeline_time:0,creative_look:{}},
    {timeline_time:.8,creative_look:{curves:{master:[0,.1,.2,.5,1]},hsl:{red:{hue:20}},wheels:{midtones:{color:'#ff0000',amount:50}}}}
  ]}]});
  const project=(await call('cliproom_get_project',{project_id:animated.project.id})).project,clip=project.state.clips[0];
  assert.equal(project.state.version,5);assert.equal(clip.keyframes[1].creativeLook.hsl.red.hue,20);assert.equal(clip.keyframes[1].creative_look,undefined);
  const preview=await page.evaluate(async id=>{const project=await(await fetch('/api/projects/'+id)).json();setState(project.state,id,project.revision);const image=imageFor(asset(project.state.assets[0].id));await image.decode();return [.1,.7].map(time=>{currentTime=time;renderFrame();return [...context.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data];});},animated.project.id);
  assert.ok(preview[0][0]-preview[1][0]>30,'the animated curve should visibly darken the image');
  await page.locator('#video-look-probe').setInputFiles(animated.path);
  const encoded=await page.evaluate(async()=>{const url=URL.createObjectURL(document.querySelector('#video-look-probe').files[0]),v=document.createElement('video');v.muted=true;v.src=url;await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject;});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d'),result=[];for(const time of [.1,.7]){v.currentTime=time;await new Promise((resolve,reject)=>{v.onseeked=resolve;v.onerror=reject;});x.drawImage(v,0,0);result.push([...x.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data]);}URL.revokeObjectURL(url);return result;});
  for(let frame=0;frame<2;frame++)for(let channel=0;channel<3;channel++)assert.ok(Math.abs(encoded[frame][channel]-preview[frame][channel])<=25,'encoded/preview mismatch '+JSON.stringify({encoded,preview}));
  const warning=await call('cliproom_apply_preset',{project_id:animated.project.id,base_revision:project.revision,clip_ids:[clip.id],strength:50,dry_run:true});assert.ok(warning.warnings.some(message=>message.includes('keyframes')));
  const invalid=structuredClone(project.state);invalid.version=4;
  const badVersion=await fetch(base+'/api/projects/'+animated.project.id,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,state:invalid})});assert.equal(badVersion.status,400);
  const badAudio=structuredClone(project.state);badAudio.audioClips.push({keyframes:[{time:0,creativeLook:{}}]});
  const badAudioSave=await fetch(base+'/api/projects/'+animated.project.id,{method:'PUT',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,state:badAudio})});assert.equal(badAudioSave.status,400);
  await fs.writeFile(path.join(work,'audio.wav'),Buffer.from('unused'));const rejected=await client.callTool({name:'cliproom_render',arguments:{output:'bad-audio.webm',media:[{input:'audio.wav',keyframes:[{source_time:0,creative_look:{}}]}]}});assert.equal(rejected.isError,true);assert.match(JSON.stringify(rejected.content),/picture clips/);
  await page.evaluate(project=>{const copy=structuredClone(project.state);copy.version=4;delete copy.clips[0].keyframes;setState(copy,crypto.randomUUID(),0);selected={type:'clip',id:copy.clips[0].id};currentTime=.4;render();},project);
  await page.locator('#addKeyframeBtn').click();await page.locator('.grade-keyframes > summary').click();await page.locator('#captureCreativeKeyframe').click();
  assert.equal(await page.evaluate(()=>state.version),5);assert.ok(await page.evaluate(()=>!!state.clips[0].keyframes[0].creativeLook));
  await page.locator('.grade-keyframes > summary').click();await page.locator('#clearCreativeKeyframe').click();assert.equal(await page.evaluate(()=>state.clips[0].keyframes[0].creativeLook),undefined);
  await page.locator('#undoBtn').click();assert.ok(await page.evaluate(()=>!!state.clips[0].keyframes[0].creativeLook));
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>revision===1);assert.equal((await call('cliproom_get_project',{project_id:await page.evaluate(()=>projectId)})).project.state.version,5);
});
test('fast color preview reduces work but both export paths retain full processing size',async t=>{
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d'),gradient=x.createLinearGradient(0,0,c.width,0);gradient.addColorStop(0,'#882833');gradient.addColorStop(1,'#eeaa44');x.fillStyle=gradient;x.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1];});
  const upload=await fetch(base+'/api/assets',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','X-File-Type':'image/png','X-File-Name':'large.png'},body:Buffer.from(png,'base64')});assert.equal(upload.status,201);const meta=await upload.json();
  await page.evaluate(async meta=>{const project=T.empty(()=>crypto.randomUUID());project.quality='1080p';project.assets=[{...meta,kind:'image',width:1920,height:1080}];const clip={id:crypto.randomUUID(),assetId:meta.id,trackId:project.videoTracks[0].id,start:0,in:0,out:.5,rate:1,volume:1,fit:'contain',opacity:1,scale:1,x:50,y:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0};RoomGrade.writeTarget(clip,'clip',{},100,true,{hsl:{red:{hue:12,saturation:25}},grain:8,sharpen:10});project.clips=[clip];setState(project,crypto.randomUUID(),0);await imageFor(asset(meta.id)).decode();const original=RoomGrade.renderSource;window.gradeProbe=[];RoomGrade.renderSource=(source,values,width,height,cacheable)=>{window.gradeProbe.push({width:Math.round(width),height:Math.round(height),recording});return original(source,values,width,height,cacheable);};currentTime=.1;renderFrame();},meta);
  assert.deepEqual(await page.evaluate(()=>[gradeProbe.at(-1).width,gradeProbe.at(-1).height]),[1920,1080]);
  await page.locator('#fastColorBtn').click();assert.equal(await page.locator('#fastColorBtn').getAttribute('aria-pressed'),'true');assert.deepEqual(await page.evaluate(()=>[gradeProbe.at(-1).width,gradeProbe.at(-1).height]),[480,270]);
  const offline=await page.evaluate(()=>{gradeProbe=[];renderFrame(new Map());return gradeProbe.at(-1);});assert.deepEqual([offline.width,offline.height],[1920,1080]);
  const speed=await page.evaluate(()=>{const source=document.createElement('canvas');source.width=1280;source.height=720;const x=source.getContext('2d');x.fillStyle='#b25a45';x.fillRect(0,0,1280,720);const clip=state.clips[0],measure=fast=>{const begin=performance.now();for(let i=0;i<3;i++)drawCover(source,clip,1,'off',fast);return (performance.now()-begin)/3;};measure(false);measure(true);return {full:measure(false),fast:measure(true)};});t.diagnostic('Synthetic 1280×720 graded frame on this machine: full '+speed.full.toFixed(1)+' ms, fast preview '+speed.fast.toFixed(1)+' ms.');
  await page.locator('#exportBtn').click();await page.locator('#exportFormatChoice').selectOption('webm');await page.evaluate(()=>{gradeProbe=[];});
  let download;
  try {[download]=await Promise.all([page.waitForEvent('download',{timeout:30000}),page.locator('#startExportBtn').click()]);}
  catch(error){const status=await page.evaluate(()=>({format:document.querySelector('#exportFormat').textContent,hint:document.querySelector('#exportStatus').textContent,toast:document.querySelector('#toast').textContent,failure:exportFailure,recording,exportPreparing,playing,currentTime,duration:totalDuration(),recorderState:recorder?.state}));throw new Error('Real-time export did not finish: '+JSON.stringify(status),{cause:error});}
  assert.ok((await fs.stat(await download.path())).size>100);const live=await page.evaluate(()=>gradeProbe.filter(value=>value.recording));assert.ok(live.length>0);assert.ok(live.every(value=>value.width===1920&&value.height===1080));
  await page.locator('#fastColorBtn').click();assert.equal(await page.locator('#fastColorBtn').getAttribute('aria-pressed'),'false');
});
test('creative grading controls work at a phone-sized viewport',async()=>{
  const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});try{
    await mobile.goto(base+'/pixelroom/');await mobile.locator('#imageInput').setInputFiles(path.join(work,'source.png'));await mobile.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Photo opened'));
    await mobile.locator('[data-grade-details="creative"] > summary').click();await mobile.locator('[data-grade-details="wheels"] > summary').click();
    const wheel=mobile.locator('[data-look-wheel]');await wheel.scrollIntoViewIfNeeded();await wheel.tap({position:{x:100,y:64}});assert.notEqual(await mobile.evaluate(()=>PixelRoomGrade.get().look.wheels.shadows.color),'#ffffff');
    await mobile.locator('[data-look-key="wheel-amount"]').evaluate(input=>{input.value='25';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await mobile.evaluate(()=>PixelRoomGrade.get().look.wheels.shadows.amount),25);
    if(process.env.ROOMSUITE_LOOK_QA_DIR){await fs.mkdir(process.env.ROOMSUITE_LOOK_QA_DIR,{recursive:true});await mobile.locator('[data-look-wheel]').scrollIntoViewIfNeeded();await mobile.screenshot({path:path.join(process.env.ROOMSUITE_LOOK_QA_DIR,'mobile-color-wheel.png')});}
  }finally{await mobile.close();}
});
