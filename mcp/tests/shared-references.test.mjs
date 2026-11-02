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
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXz8AAAAASUVORK5CYII=','base64');
let temp,work,server,client,browser,page,note,attachment;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
async function upload(name,bytes){await fs.writeFile(path.join(work,name),bytes);return call('roomsuite_shared_upload',{input:name,path:name});}
before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-references-'));work=path.join(temp,'work');await fs.mkdir(work);server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'clip'),ROOMSUITE_DATA:path.join(temp,'workspace')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});client=new Client({name:'references-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:390,height:844}});});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-references-'));await fs.rm(actual,{recursive:true,force:true});}});

test('reference scans distinguish path-only notes, protected note copies and text mentions',async()=>{
  await upload('photo one.png',png);const url='/api/workspace/file?'+new URLSearchParams({path:'photo one.png'});note=(await call('notesroom_create',{title:'Legacy image',body:'![Photo]('+url+')'})).note;
  let report=await call('roomsuite_shared_references',{path:'photo one.png'});assert.equal(report.complete,true);assert.equal(report.status,'referenced');assert.equal(report.blocking_count,1);assert.equal(report.references[0].id,note.id);
  await assert.rejects(call('roomsuite_shared_trash_unreferenced',{path:'photo one.png',base_revision:report.revision,confirm_unscanned:true}),/refer/i);
  const protectedNote=await call('notesroom_protect_media',{note_id:note.id,base_revision:note.revision});note=protectedNote.note;attachment=new URL('http://local'+/\(([^)]+)\)/.exec(note.body)[1]).searchParams.get('attachment');assert.ok(attachment);
  report=await call('roomsuite_shared_references',{path:'photo one.png'});assert.equal(report.status,'not_detected');assert.equal(report.protected_count,1);assert.equal(report.blocking_count,0);
  await upload('link.txt',Buffer.from('Image path: photo one.png'));report=await call('roomsuite_shared_references',{path:'photo one.png'});assert.equal(report.status,'referenced');assert.ok(report.references.some(item=>item.path==='link.txt'&&!item.protected));
  await call('roomsuite_shared_delete',{path:'link.txt'});
});

test('a damaged protected copy makes cleanup incomplete instead of treating the original as disposable',async()=>{
  const file=path.join(temp,'workspace','.note-attachments',attachment),original=await fs.readFile(file),changed=Buffer.from(original);changed[changed.length-1]^=1;await fs.writeFile(file,changed);
  try{const report=await call('roomsuite_shared_references',{path:'photo one.png'});assert.equal(report.complete,false);assert.ok(report.blocking_count>0);await assert.rejects(call('roomsuite_shared_trash_unreferenced',{path:'photo one.png',base_revision:report.revision,confirm_unscanned:true}),/incomplete|refer/i);}finally{await fs.writeFile(file,original);}
});

test('checked trash rechecks references and refuses stale or incomplete scans',async()=>{
  await upload('candidate.roomgrade',Buffer.from('{}'));let report=await call('roomsuite_shared_references',{path:'candidate.roomgrade'});assert.equal(report.status,'not_detected');
  let added=(await call('notesroom_create',{title:'New use',body:'Keep candidate.roomgrade'})).note;
  await assert.rejects(call('roomsuite_shared_trash_unreferenced',{path:'candidate.roomgrade',base_revision:report.revision,confirm_unscanned:true}),/refer/i);
  added=(await call('notesroom_update',{note_id:added.id,base_revision:added.revision,body:'No longer linked'})).note;
  report=await call('roomsuite_shared_references',{path:'candidate.roomgrade'});await fs.appendFile(path.join(temp,'workspace','files','candidate.roomgrade'),' ');
  await assert.rejects(call('roomsuite_shared_trash_unreferenced',{path:'candidate.roomgrade',base_revision:report.revision,confirm_unscanned:true}),/changed/i);
  const large=await fs.open(path.join(temp,'workspace','files','oversize.txt'),'w');try{await large.truncate(8*1024*1024+1);}finally{await large.close();}
  try{report=await call('roomsuite_shared_references',{path:'candidate.roomgrade'});assert.equal(report.status,'unknown');assert.equal(report.complete,false);await assert.rejects(call('roomsuite_shared_trash_unreferenced',{path:'candidate.roomgrade',base_revision:report.revision,confirm_unscanned:true}),/incomplete/i);}finally{await fs.unlink(path.join(temp,'workspace','files','oversize.txt'));}
  assert.equal((await fetch(base+'/api/workspace/file?path=candidate.roomgrade')).status,200);
});

test('the mobile-sized FilesRoom view safely trashes a checked file while the protected note copy remains',async()=>{
  await page.goto(base+'/files/');await page.getByRole('button',{name:'Check uses of photo one.png'}).click();await page.waitForFunction(()=>document.querySelector('#referenceStatus').textContent.includes('protected copy'));assert.match(await page.locator('#referenceList').textContent(),/Legacy image/);assert.equal(await page.locator('#referenceTrash').isEnabled(),true);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#referenceTrash').click();await page.waitForFunction(()=>!document.querySelector('#referenceDialog').open);assert.equal((await fetch(base+'/api/workspace/file?'+new URLSearchParams({path:'photo one.png'}))).status,404);
  const response=await fetch(base+'/api/workspace/media?'+new URLSearchParams({path:'photo one.png',attachment}));assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  const trash=await call('roomsuite_trash_list');assert.ok(trash.entries.some(item=>item.originalPath==='photo one.png'));
});
