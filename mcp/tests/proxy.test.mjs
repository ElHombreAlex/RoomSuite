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
let temp,server,browser,page,client,assetId,uploaded,initialVersion;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-proxy-'));const work=path.join(temp,'work');await fs.mkdir(work);server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',chunk=>{if(String(chunk).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});client=new Client({name:'proxy-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});await page.goto(base+'/cliproom/');});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-proxy-'));await fs.rm(actual,{recursive:true,force:true});}});

test('browser generates a bounded playable proxy with audio while retaining the original',async()=>{
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff2200';ctx.fillRect(0,0,canvas.width,canvas.height);const stream=canvas.captureStream(15),audio=new AudioContext(),osc=audio.createOscillator(),destination=audio.createMediaStreamDestination();osc.frequency.value=440;osc.connect(destination);osc.start();await audio.resume();stream.addTrack(destination.stream.getAudioTracks()[0]);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus'}),chunks=[];recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};const stopped=new Promise(resolve=>recorder.onstop=resolve);let frame=0;const draw=setInterval(()=>{ctx.fillStyle=frame++%2?'#ff2200':'#cc4400';ctx.fillRect(0,0,canvas.width,canvas.height);},80);recorder.start(200);await new Promise(resolve=>setTimeout(resolve,1400));clearInterval(draw);recorder.stop();await stopped;osc.stop();await audio.close();stream.getTracks().forEach(track=>track.stop());let blob=new Blob(chunks,{type:'video/webm'});blob=await RoomWebM.withDuration(blob,1.4);
    const uploaded=await (await fetch('/api/assets',{method:'POST',headers:{'X-Cliproom-Request':'1','X-File-Type':'video/webm','X-File-Name':'source.webm'},body:blob})).json();const mod=await import('/proxy.js');const proxy=await mod.createProxy(uploaded.id);return {uploaded,proxy};
  });
  uploaded=result.uploaded;assetId=uploaded.id;initialVersion=result.proxy.version;assert.equal(result.proxy.exists,true);assert.equal(result.proxy.width,640);assert.equal(result.proxy.height,360);assert.ok(result.proxy.bytes>0);const original=await fs.stat(path.join(temp,'data','assets',assetId));assert.equal(original.size,result.uploaded.size);const response=await page.request.get(base+'/api/proxies/'+assetId);assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'video/webm');const tracks=await page.evaluate(async id=>{const {Input,UrlSource,ALL_FORMATS}=await import('/api/render/mediabunny.mjs'),input=new Input({formats:ALL_FORMATS,source:new UrlSource(new URL('/api/proxies/'+id,location.href).href)});try{const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();return {video:!!video,audio:!!audio,canDecodeAudio:audio?await audio.canDecode():false};}finally{input.dispose();}},assetId);assert.deepEqual(tracks,{video:true,audio:true,canDecodeAudio:true});assert.equal((await call('cliproom_create_proxy',{asset_id:assetId})).already_exists,true);
});

test('editor preview uses the proxy and export returns to the original',async()=>{
  await page.evaluate(item=>{state.assets.push({...item,kind:'video',duration:1.3,width:1280,height:720});addMedia(item.id);},uploaded);
  await page.locator('#proxyBtn').click();await page.getByRole('button',{name:'Remove optimized preview for source.webm'}).waitFor();await page.locator('#useProxyPreview').check();await page.locator('#proxyDialog [data-close=proxyDialog]').first().click();await page.waitForFunction(id=>[...elements.values()].some(entry=>entry.url.startsWith('/api/proxies/'+id+'?v=')&&entry.el.videoWidth===640),assetId);
  await page.locator('#exportBtn').click();await page.locator('#exportFormatChoice').selectOption('webm');const download=page.waitForEvent('download',{timeout:30000});await page.locator('#startExportBtn').click();await page.waitForFunction(id=>recording&&[...elements.values()].some(entry=>entry.url==='/api/assets/'+id&&entry.el.currentSrc.endsWith('/api/assets/'+id)&&entry.el.videoWidth===1280),assetId,{timeout:10000});const saved=await download;assert.ok((await fs.stat(await saved.path())).size>0);assert.equal((await call('cliproom_proxy_status',{asset_id:assetId})).exists,true);
});

test('video audio waveforms agree between the timeline, a library asset and a workspace file',async()=>{
  await fs.copyFile(path.join(temp,'data','assets',assetId),path.join(temp,'work','source.webm'));
  const byAsset=await call('cliproom_analyze_waveform',{asset_id:assetId,bins:512}),byFile=await call('cliproom_analyze_waveform',{input:'source.webm',bins:512});
  assert.deepEqual(byAsset.peaks,byFile.peaks);assert.ok(byAsset.peaks.some(value=>value>.05));assert.match(byAsset.note,/approximate/);
  await assert.rejects(call('cliproom_analyze_waveform',{asset_id:assetId,input:'source.webm'}),/exactly one/);
  await page.locator('#waveformBtn').click();await page.locator('.timeline-clip:not(.audio-clip) .audio-waveform').waitFor({timeout:30000});
  const displayed=await page.evaluate(id=>waveforms.get(id).peaks,assetId);assert.deepEqual(displayed,byAsset.peaks);
});

test('MCP and editor can remove and recreate a shared derived preview',async()=>{
  await page.locator('#proxyBtn').click();await page.getByRole('button',{name:'Remove optimized preview for source.webm'}).click();await page.waitForFunction(()=>document.querySelector('#proxyStatus').textContent.includes('removed'));assert.equal((await call('cliproom_proxy_status',{asset_id:assetId})).exists,false);await page.getByRole('button',{name:'Create optimized preview for source.webm'}).click();await page.waitForFunction(()=>document.querySelector('#proxyStatus').textContent.includes('ready'),null,{timeout:30000});const status=await call('cliproom_proxy_status',{asset_id:assetId});assert.equal(status.exists,true);assert.notEqual(status.version,initialVersion);assert.equal((await page.request.get(base+'/api/proxies/'+assetId+'?v='+initialVersion)).status(),409);assert.equal((await call('cliproom_delete_proxy',{asset_id:assetId})).removed,true);const created=await call('cliproom_create_proxy',{asset_id:assetId});assert.equal(created.exists,true);assert.equal(created.already_exists,false);assert.equal((await call('cliproom_proxy_status',{asset_id:assetId})).exists,true);assert.equal((await call('cliproom_delete_proxy',{asset_id:assetId})).removed,true);assert.equal((await call('cliproom_delete_proxy',{asset_id:assetId})).removed,false);assert.equal((await fs.stat(path.join(temp,'data','assets',assetId))).size,uploaded.size);
});

test('an invalid cached preview falls back to the original and cannot overwrite it',async()=>{
  const response=await page.evaluate(async id=>{const bytes=new Uint8Array([0x1a,0x45,0xdf,0xa3,...new Array(32).fill(0)]);const result=await fetch('/api/proxies/'+id,{method:'POST',headers:{'Content-Type':'video/webm','X-Cliproom-Request':'1'},body:bytes});return {status:result.status,body:await result.json()};},assetId);assert.equal(response.status,200);assert.equal(response.body.exists,true);
  await page.locator('#proxyDialog [data-close=proxyDialog]').first().click();await page.locator('#proxyBtn').click();await page.getByRole('button',{name:'Remove optimized preview for source.webm'}).waitFor();await page.locator('#proxyDialog [data-close=proxyDialog]').first().click();await page.locator('#startBtn').click();await page.waitForFunction(id=>proxyStatuses.get(id)?.broken===true&&[...elements.values()].some(entry=>entry.url==='/api/assets/'+id),assetId,{timeout:15000});assert.equal((await fs.stat(path.join(temp,'data','assets',assetId))).size,uploaded.size);await call('cliproom_delete_proxy',{asset_id:assetId});
});

test('moving original media to trash removes its derived preview and restoring keeps the source',async()=>{
  await call('cliproom_create_proxy',{asset_id:assetId});const old=new Date(Date.now()-26*60*60*1000);await fs.utimes(path.join(temp,'data','assets',assetId),old,old);await fs.utimes(path.join(temp,'data','assets',assetId+'.json'),old,old);
  await call('cliproom_media_trash',{asset_id:assetId,confirm_unsaved:true});await assert.rejects(fs.stat(path.join(temp,'data','proxies',assetId+'.webm')),{code:'ENOENT'});await call('cliproom_media_restore',{asset_id:assetId});assert.equal((await fs.stat(path.join(temp,'data','assets',assetId))).size,uploaded.size);assert.equal((await call('cliproom_proxy_status',{asset_id:assetId})).exists,false);
});
