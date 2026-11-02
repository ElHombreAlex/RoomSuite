// Reproducible desktop comparison, intentionally separate from pass/fail tests.
// Usage: node mcp/benchmarks/cliproom-performance.mjs <2.5 checkout> [result.json]
import { chromium } from 'playwright';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Supply the path to the unmodified 2.5 checkout.');
const resultFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'roomsuite-performance-'));
const servers = [];
let browser;

async function startServer(directory, port, name) {
  const server = spawn(process.execPath, [path.join(directory, 'server.js')], {
    env:{...process.env, CLIPROOM_PORT:String(port), CLIPROOM_DATA:path.join(temp, name)},
    stdio:['ignore','pipe','pipe']
  });
  servers.push(server);
  let logs = '';
  server.stderr.on('data', data => { logs += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timed out: ' + logs)), 15000);
    server.once('error', reject);
    server.once('exit', code => reject(new Error('Server exited ' + code + ': ' + logs)));
    server.stdout.on('data', data => {
      logs += data;
      if (logs.includes('RoomSuite is running')) { clearTimeout(timer); resolve(); }
    });
  });
  return 'http://127.0.0.1:' + port;
}

async function fixtures(base) {
  const page = await browser.newPage();
  try {
    await page.goto(base + '/cliproom/');
    return await page.evaluate(async () => {
      const {Output,WebMOutputFormat,BufferTarget,CanvasSource,Quality} = await import('/api/render/mediabunny.mjs');
      const result = [];
      for (const {width,height,fps} of [{width:1920,height:1080,fps:24},{width:1280,height:720,fps:30}]) {
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext('2d'), output=new Output({format:new WebMOutputFormat(),target:new BufferTarget()});
        const video=new CanvasSource(canvas,{codec:'vp8',quality:new Quality({bitrate:width===1920?4000000:2000000})});
        output.addVideoTrack(video,{frameRate:fps});await output.start();
        for(let frame=0;frame<fps*4;frame++){
          const g=ctx.createLinearGradient(0,0,width,height);g.addColorStop(0,'#23438c');g.addColorStop(.5,'#de9150');g.addColorStop(1,'#217957');
          ctx.fillStyle=g;ctx.fillRect(0,0,width,height);
          for(let i=0;i<45;i++){
            const x=(i*157+frame*(i%5+2)*3)%width,y=(i*113+frame*(i%3+1))%height;
            ctx.fillStyle=`hsl(${(i*53+frame)%360} 70% ${25+(i%5)*10}%)`;
            ctx.fillRect(x,y,width*(.02+(i%4)*.012),height*(.025+(i%3)*.015));
          }
          ctx.fillStyle='#fff';ctx.font=`bold ${Math.round(height/14)}px sans-serif`;ctx.fillText(`${fps} fps  ${frame}`,width*.04,height*.14);
          await video.add(frame/fps,1/fps);
        }
        video.close();await output.finalize();
        const blob=new Blob([output.target.buffer],{type:'video/webm'});
        const response=await fetch('/api/assets',{method:'POST',headers:{'X-Cliproom-Request':'1','X-File-Type':'video/webm','X-File-Name':`motion-${height}-${fps}.webm`},body:blob});
        if(!response.ok)throw new Error('Fixture upload failed: '+response.status);
        result.push({...await response.json(),kind:'video',width,height,duration:4,fps});
      }
      return result;
    });
  } finally { await page.close(); }
}

async function copyAssets(source, destination, assets) {
  const copied=[];
  for (const asset of assets) {
    const bytes=await (await fetch(source+'/api/assets/'+asset.id)).arrayBuffer();
    const response=await fetch(destination+'/api/assets',{method:'POST',headers:{Origin:destination,'X-Cliproom-Request':'1','X-File-Type':'video/webm','X-File-Name':asset.name},body:bytes});
    if(!response.ok)throw new Error('Could not copy fixture: '+response.status);
    copied.push({...await response.json(),kind:'video',width:asset.width,height:asset.height,duration:asset.duration,fps:asset.fps});
  }
  return copied;
}

async function exportStats(download) {
  const bytes=await fs.readFile(await download.path()),input=new Input({formats:ALL_FORMATS,source:new BufferSource(bytes)});
  try {const video=await input.getPrimaryVideoTrack(),packets=await video.computePacketStats();return {bytes:bytes.length,frames:packets.packetCount,averageFps:packets.averagePacketRate};}
  finally {input.dispose();}
}

async function run(base, assets, grade, fast, sample) {
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  try {
    const start=performance.now();await page.goto(base+'/cliproom/',{waitUntil:'load'});
    await page.waitForFunction(()=>typeof setState==='function'&&typeof T==='object');
    const startupMs=performance.now()-start;
    const prepare=performance.now();
    await page.evaluate(({assets,grade})=>{
      const id=()=>crypto.randomUUID(),project=T.empty(id);project.quality='1080p';
      project.videoTracks.push({id:id(),name:'Video 2',muted:false,hidden:false});project.assets=assets;
      project.clips=assets.map((asset,index)=>({id:id(),assetId:asset.id,trackId:project.videoTracks[index].id,start:0,in:0,out:3.5,rate:1,volume:1,fit:'contain',opacity:index?.82:1,scale:index?.45:1,x:index?73:50,y:index?68:50,brightness:100,contrast:100,saturation:100,rotation:0,flipX:false,fadeIn:0,fadeOut:0}));
      if(grade)for(const clip of project.clips)RoomGrade.writeTarget(clip,'clip',{exposure_ev:.2,temperature:12,vibrance:10},100,true,{hsl:{red:{hue:12,saturation:20}},grain:8,sharpen:10});
      setState(project,id(),0);
    },{assets,grade});
    if (fast) { const button=page.locator('#fastColorBtn');if(await button.getAttribute('aria-pressed')!=='true')await button.click(); }
    else if (grade) { const button=page.locator('#fastColorBtn');if(await button.getAttribute('aria-pressed')==='true')await button.click(); }
    await page.waitForFunction(()=>elements.size===2&&[...elements.values()].every(entry=>entry.el.readyState>=2),null,{timeout:30000});
    await page.evaluate(()=>renderFrame());
    const firstPreviewMs=performance.now()-prepare;
    await page.evaluate(()=>{
      window.benchFrames=[];const original=renderFrame;
      renderFrame=function(...args){const started=performance.now();try{return original(...args);}finally{if(playing&&!recording)window.benchFrames.push(performance.now()-started);}};
    });
    const playedAt=performance.now();await page.locator('#playBtn').click();
    await page.waitForFunction(()=>!playing&&currentTime>=3.49,null,{timeout:45000});
    const playbackWallMs=performance.now()-playedAt;
    const playback=await page.evaluate(()=>({durations:window.benchFrames,video:[...elements.values()].map(entry=>{const q=entry.el.getVideoPlaybackQuality();return {decoded:q.totalVideoFrames,dropped:q.droppedVideoFrames};}),jsHeapBytes:performance.memory?.usedJSHeapSize||null}));
    const sorted=playback.durations.slice().sort((a,b)=>a-b),mean=sorted.reduce((a,b)=>a+b,0)/Math.max(1,sorted.length);
    const stats={startupMs,firstPreviewMs,playbackWallMs,draws:sorted.length,meanDrawMs:mean,p95DrawMs:sorted[Math.floor((sorted.length-1)*.95)]??null,video:playback.video,jsHeapBytes:playback.jsHeapBytes};
    if (sample===0) {
      await page.locator('#exportBtn').click();await page.locator('#exportFormatChoice').selectOption('webm');await page.locator('#exportAudio').selectOption('mute');
      const began=performance.now(),download=page.waitForEvent('download',{timeout:120000});await page.locator('#startExportBtn').click();
      const file=await download;stats.exportMs=performance.now()-began;stats.realtimeExport=await exportStats(file);
      if(grade&&!fast){
        await page.locator('#exportBtn').click();await page.locator('#exportMode').selectOption('offline');
        const started=performance.now(),precise=page.waitForEvent('download',{timeout:180000});await page.locator('#startExportBtn').click();
        const exact=await precise;stats.everyFrameExportMs=performance.now()-started;stats.everyFrameExport=await exportStats(exact);
      }
    }
    return stats;
  } finally {await page.close();}
}

try {
  const seed=24000+Math.floor(Math.random()*12000), current=await startServer(root,seed,'current'),old=await startServer(baseline,seed+1,'baseline');
  browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});
  const currentAssets=await fixtures(current),baselineAssets=await copyAssets(current,old,currentAssets);
  const result={recordedAt:new Date().toISOString(),os:{platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model.trim(),logicalCores:os.cpus().length,memoryBytes:os.totalmem()},browser:browser.version(),fixtures:currentAssets.map(({width,height,fps,size})=>({width,height,fps,bytes:size})),scenario:'3.5 seconds, overlapping full-frame 1080p and scaled 720p VP8 videos; 1080p timeline; no audio',samples:{}};
  for(const [name,base,assets,grade,fast] of [['baseline_neutral',old,baselineAssets,false,false],['current_neutral',current,currentAssets,false,false],['current_advanced',current,currentAssets,true,false],['current_advanced_fast_preview',current,currentAssets,true,true]]){
    result.samples[name]=[];
    for(let i=0;i<2;i++){process.stderr.write(`Measuring ${name}, sample ${i+1}/2\n`);result.samples[name].push(await run(base,assets,grade,fast,i));}
  }
  const json=JSON.stringify(result,null,2)+'\n';if(resultFile)await fs.writeFile(resultFile,json);process.stdout.write(json);
} finally {
  if(browser)await browser.close();
  for(const server of servers)if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());
  if(path.dirname(actual)!==parent||!path.basename(actual).startsWith('roomsuite-performance-'))throw new Error('Refusing to remove unexpected temporary directory.');
  await fs.rm(actual,{recursive:true,force:true});
}
