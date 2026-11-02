'use strict';
// Run against a fresh, disposable Windows installation directory. The test
// installer should use an isolated AppId when running on a developer machine.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const requireMcp = createRequire(path.join(root, 'mcp', 'package.json'));
const { Client } = requireMcp('@modelcontextprotocol/client');
const { StdioClientTransport } = requireMcp('@modelcontextprotocol/client/stdio');
const installer = path.resolve(process.argv[2] || '');
const base = path.resolve(process.argv[3] || '');
let cleanupFailed=false;
if (process.platform !== 'win32' || !process.argv[2] || !process.argv[3]) throw new Error('Usage on Windows: node windows/installer-smoke.cjs <installer.exe> <test-parent-directory>');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(file, args, env = process.env) { const result = spawnSync(file, args, { env, windowsHide:true, encoding:'utf8', timeout:180000 }); if (result.error || result.status !== 0) { const log=args.find(arg=>arg.startsWith('/LOG='));let detail=result.error || result.stderr || result.stdout;if(log)try{detail+='\n'+fsSync.readFileSync(log.slice(5),'utf8').split(/\r?\n/).slice(-30).join('\n');}catch{}throw new Error(`${path.basename(file)} failed (${result.status}): ${detail}`); } }
async function port() { const listener = net.createServer(); await new Promise((resolve,reject) => listener.once('error',reject).listen(0,'127.0.0.1',resolve)); const value = listener.address().port; await new Promise(resolve => listener.close(resolve)); return value; }
async function request(client,name,args) { const indirect=client.roomSuiteTools&&!client.roomSuiteTools.has(name),result=await client.callTool(indirect?{name:'roomsuite_invoke',arguments:{name,arguments:args}}:{name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result; }
function tone(){const rate=48000,frames=rate,b=Buffer.alloc(44+frames*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(Math.sin(i*440*Math.PI*2/rate)*12000),44+i*2);return b;}
async function launchNode(dir, env) {
  const child=spawn(path.join(dir,'runtime','node.exe'),[path.join(dir,'server.js')],{cwd:dir,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  try { await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('RoomSuite server timed out: '+log)),20000);child.once('error',reject);child.once('exit',code=>reject(new Error('RoomSuite exited '+code+': '+log)));for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{log+=data;if(log.includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});return child; }
  catch(error){child.kill();throw error;}
}
async function stop(child) { if (!child || child.exitCode !== null) return; const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await Promise.race([done,sleep(5000)]); }
async function uninstall(dir) { const names=await fs.readdir(dir).catch(()=>[]),name=names.find(item=>/^unins\d+\.exe$/i.test(item));if(name)run(path.join(dir,name),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART']); }
async function scenario(temp, mode) {
  const dir=path.join(temp,mode+'-app'),data=path.join(temp,mode+'-data'),workspace=path.join(data,'agent-workspace'),portNumber=await port(),env={...process.env,ROOMSUITE_APP_DATA:data,CLIPROOM_PORT:String(portNumber),PLAYWRIGHT_BROWSERS_PATH:path.join(dir,'browsers')};
  delete env.ROOMSUITE_BROWSER_PATH;delete env.ROOMSUITE_MCP_MODE;delete env.ROOMSUITE_MCP_GROUPS;
  // Never let an isolated installer test contact a calendar configured by the user.
  for(const key of ['ROOMSUITE_CALDAV_URL','ROOMSUITE_CALDAV_USERNAME','ROOMSUITE_CALDAV_PASSWORD','ROOMSUITE_CALDAV_TOKEN'])delete env[key];
  const group='RoomSuite-Test-'+path.basename(temp);
  try {
    run(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/SP-',`/GROUP=${group}`,`/DIR=${dir}`,`/TYPE=${mode}`,`/LOG=${path.join(temp,mode+'-install.log')}`]);
    await fs.access(path.join(dir,'runtime','node.exe'));await fs.access(path.join(dir,'RoomSuite.exe'));await fs.access(path.join(dir,'PixelRoom','dist','index.html'));await fs.access(path.join(dir,'ProductivitySuite','vendor','exceljs.js'));await fs.access(path.join(dir,'ProductivitySuite','vendor','fflate.js'));
    for(const file of ['RELEASE_NOTES.md','COLOR_GRADING.md','PERFORMANCE.md','UPGRADE_STATUS.md',path.join('workspace','caldav.js')])await fs.access(path.join(dir,file));
    const mcpDir=path.join(dir,'mcp','node_modules');
    if(mode==='typical')await assert.rejects(fs.stat(mcpDir),{code:'ENOENT'});else await fs.access(path.join(mcpDir,'playwright','package.json'));
    run(path.join(dir,'RoomSuite.exe'),['--self-test'],env);
    await fs.access(path.join(data,'data','cliproom','projects'));await fs.access(path.join(data,'data','workspace'));
    const listener=net.createServer();await new Promise((resolve,reject)=>listener.once('error',reject).listen(portNumber,'127.0.0.1',resolve));
    try { const occupied=spawnSync(path.join(dir,'RoomSuite.exe'),['--self-test'],{env,windowsHide:true,timeout:30000});assert.equal(occupied.status,1,'launcher must fail rather than open a different server'); }
    finally { await new Promise(resolve=>listener.close(resolve)); }
    if(mode==='typical'){
      await fs.writeFile(path.join(data,'data','before-upgrade.txt'),'keep');
      run(installer,['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/SP-',`/GROUP=${group}`,`/DIR=${dir}`,'/TYPE=full',`/LOG=${path.join(temp,'upgrade.log')}`]);
      await fs.access(path.join(mcpDir,'playwright','package.json'));await fs.access(path.join(dir,'browsers'));assert.equal(await fs.readFile(path.join(data,'data','before-upgrade.txt'),'utf8'),'keep');
      const upgraded=await launchNode(dir,{...env,CLIPROOM_DATA:path.join(data,'data','cliproom'),ROOMSUITE_DATA:path.join(data,'data','workspace')});
      const upgradeClient=new Client({name:'installer-upgrade-check',version:'2.1.3'});
      try{await upgradeClient.connect(new StdioClientTransport({command:path.join(dir,'runtime','node.exe'),args:[path.join(dir,'mcp','server.mjs')],env:{...env,ROOMSUITE_MCP_WORKSPACE:workspace,ROOMSUITE_MCP_URL:`http://127.0.0.1:${portNumber}`},stderr:'pipe'}));const checked=await request(upgradeClient,'roomsuite_check_deployment',{});assert.equal(checked.structuredContent.ok,true,checked.structuredContent.issues.join('; '));}
      finally{await upgradeClient.close().catch(()=>{});await stop(upgraded);}
    }
    if(mode==='full'){
      const serverEnv={...env,CLIPROOM_DATA:path.join(data,'data','cliproom'),ROOMSUITE_DATA:path.join(data,'data','workspace')},server=await launchNode(dir,serverEnv);
      const client=new Client({name:'installer-smoke',version:'1.0.0'});
      try {
        const configPath=path.join(data,'mcp-config.json');run(path.join(dir,'RoomSuite.exe'),['--export-mcp-config',configPath],env);const config=JSON.parse(await fs.readFile(configPath,'utf8')).mcpServers.roomsuite;assert.equal(config.command,path.join(dir,'runtime','node.exe'));assert.deepEqual(config.args,[path.join(dir,'mcp','server.mjs')]);assert.equal(config.env.ROOMSUITE_MCP_WORKSPACE,workspace);assert.equal(config.env.ROOMSUITE_MCP_URL,`http://127.0.0.1:${portNumber}`);assert.equal(config.env.PLAYWRIGHT_BROWSERS_PATH,path.join(dir,'browsers'));
        await client.connect(new StdioClientTransport({command:config.command,args:config.args,env:{...serverEnv,...config.env},stderr:'pipe'}));
        client.roomSuiteTools=new Set((await client.listTools()).tools.map(tool=>tool.name));assert.ok(client.roomSuiteTools.size<=25);assert.ok(client.roomSuiteTools.has('roomsuite_invoke'));
        const checked=await request(client,'roomsuite_check_deployment',{});assert.equal(checked.structuredContent.ok,true,checked.structuredContent.issues.join('; '));
        const calendar=await request(client,'plansuite_create',{path:'installer.plansuite',title:'Installer calendar'});await assert.rejects(request(client,'plansuite_caldav_preview',{path:'installer.plansuite',base_revision:calendar.structuredContent.revision}),/not configured/i);
        await request(client,'docsuite_create',{path:'installer.docsuite',title:'Installer document',text:'Office compatibility'});const word=await request(client,'docsuite_export_docx',{path:'installer.docsuite',output:'installer.docx'});assert.ok(word.structuredContent.bytes>1000);
        await request(client,'gridsuite_create',{path:'installer.gridsuite',title:'Installer workbook',cells:{A1:'12',A2:'=A1*2'}});const excel=await request(client,'gridsuite_export_xlsx',{path:'installer.gridsuite',output:'installer.xlsx'});assert.ok(excel.structuredContent.bytes>1000);
        await request(client,'decksuite_create',{path:'installer.decksuite',title:'Installer presentation'});const powerpoint=await request(client,'decksuite_export_pptx',{path:'installer.decksuite',output:'installer.pptx'});assert.ok(powerpoint.structuredContent.bytes>1000);
        const created=await request(client,'paintroom_create',{name:'Installer test',width:100,height:100,include_preview:true,elements:[{type:'rect',x:0,y:0,x2:100,y2:100,fill:'#dd4400'}]});assert.ok(created.content.some(item=>item.type==='image'));
        await request(client,'paintroom_export',{project_id:created.structuredContent.project_id,format:'png',output:'frame.png'});
        const video=await request(client,'cliproom_render',{output:'test.webm',render_mode:'offline',preview_times:[0.1],frame_sequence:{frames:['frame.png'],fps:2,duration:.5}});assert.ok(video.structuredContent.bytes>1000);assert.ok(video.content.some(item=>item.type==='image'));assert.equal(video.structuredContent.verification.frames.length,1);
        await fs.writeFile(path.join(workspace,'tone.wav'),tone());
        const silent=await request(client,'cliproom_render',{output:'silent.mp4',media:[{input:'frame.png',duration:.8}]});const silentBytes=await fs.readFile(silent.structuredContent.path);assert.ok(silentBytes.includes(Buffer.from('avc1')));assert.ok(!silentBytes.includes(Buffer.from('mp4a')));
        const audible=await request(client,'cliproom_render',{output:'audible.mp4',media:[{input:'frame.png',duration:.8},{input:'tone.wav',source_out:.8}]});const audibleBytes=await fs.readFile(audible.structuredContent.path);assert.ok(audibleBytes.includes(Buffer.from('avc1')));assert.ok(audibleBytes.includes(Buffer.from('mp4a')));
        const muted=await request(client,'cliproom_render',{output:'muted.mp4',include_audio:false,media:[{input:'audible.mp4',source_out:.6}]});const mutedBytes=await fs.readFile(muted.structuredContent.path);assert.ok(mutedBytes.includes(Buffer.from('avc1')));assert.ok(!mutedBytes.includes(Buffer.from('mp4a')));
        const oldBrowsers=process.env.PLAYWRIGHT_BROWSERS_PATH;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(dir,'browsers');let browser;
        try {const installedRequire=createRequire(path.join(dir,'mcp','package.json'));browser=await installedRequire('playwright').chromium.launch({headless:true});const page=await browser.newPage();await page.goto(`http://127.0.0.1:${portNumber}/cliproom/`);await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.id='smokeVideo';document.body.append(input);});await page.locator('#smokeVideo').setInputFiles(silent.structuredContent.path);const silentWidth=await page.evaluate(async()=>{const video=document.createElement('video'),url=URL.createObjectURL(document.querySelector('#smokeVideo').files[0]);video.muted=true;video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('Could not decode silent MP4'));});URL.revokeObjectURL(url);return video.videoWidth;});assert.ok(silentWidth>0);await page.locator('#smokeVideo').setInputFiles(audible.structuredContent.path);const playback=await page.evaluate(async()=>{const file=document.querySelector('#smokeVideo').files[0],video=document.createElement('video'),url=URL.createObjectURL(file);video.muted=true;video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('Could not decode MP4'));});const audio=new AudioContext(),decoded=await audio.decodeAudioData(await file.arrayBuffer()),samples=decoded.getChannelData(0);let power=0;for(const sample of samples)power+=sample*sample;await audio.close();URL.revokeObjectURL(url);return {width:video.videoWidth,rms:Math.sqrt(power/samples.length)};});assert.ok(playback.width>0);assert.ok(playback.rms>.02,JSON.stringify(playback));}finally{if(browser)await browser.close();if(oldBrowsers===undefined)delete process.env.PLAYWRIGHT_BROWSERS_PATH;else process.env.PLAYWRIGHT_BROWSERS_PATH=oldBrowsers;}
        console.log('Bundled Windows MP4: silent H.264 and audible H.264/AAC decoded successfully.');
      } finally { await client.close().catch(()=>{});await stop(server); }
    }
    await fs.writeFile(path.join(dir,'untracked-user-file.txt'),'keep');await fs.writeFile(path.join(data,'data','keep.txt'),'keep');
    await uninstall(dir);
    assert.equal(await fs.readFile(path.join(dir,'untracked-user-file.txt'),'utf8'),'keep');assert.equal(await fs.readFile(path.join(data,'data','keep.txt'),'utf8'),'keep');await assert.rejects(fs.stat(path.join(dir,'RoomSuite.exe')),{code:'ENOENT'});
    console.log(mode+': installation, launcher, '+(mode==='full'?'MCP rendering, ':'MCP upgrade, ')+'and data-preserving uninstall passed.');
  } catch(error) { try { await uninstall(dir); } catch(cleanupError) { cleanupFailed=true;throw new Error(error.message+'\nTest uninstall also failed; the test files were kept at '+dir+': '+cleanupError.message); } throw error; }
}
(async()=>{
  await fs.mkdir(base,{recursive:true});const parent=await fs.realpath(base),temp=await fs.mkdtemp(path.join(parent,'roomsuite-installer-test-'));
  try { await scenario(temp,'typical');await scenario(temp,'full'); }
  finally { const actual=await fs.realpath(temp);if(path.dirname(actual)!==parent||!path.basename(actual).startsWith('roomsuite-installer-test-'))throw new Error('Refusing to remove an unexpected test directory.');if(!cleanupFailed)await fs.rm(actual,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
