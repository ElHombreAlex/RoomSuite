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
let dir,work,server,client,browser,first,second;
async function request(name,args,connection=client){const result=await connection.callTool({name,arguments:args},{timeout:120000});if(result.isError)throw new Error(result.content.map(c=>c.text).join(' '));return result;}
function picture(result){const image=result.content.find(c=>c.type==='image');assert.ok(image,'image content block missing');assert.equal(image.mimeType,'image/png');const bytes=Buffer.from(image.data,'base64');assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(result.structuredContent.preview.bytes,bytes.length);assert.equal(bytes.readUInt32BE(16),result.structuredContent.preview.width);assert.equal(bytes.readUInt32BE(20),result.structuredContent.preview.height);return image.data;}
async function pixel(imageData,x,y){const page=await browser.newPage();try{await page.goto(base+'/paintroom/');return await page.evaluate(async({imageData,x,y})=>{const img=new Image();img.src='data:image/png;base64,'+imageData;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(x,y,1,1).data];},{imageData,x,y});}finally{await page.close();}}
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-previews-'));work=path.join(dir,'work');await fs.mkdir(work);server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(dir,'data')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('server exited '+code)));server.stdout.on('data',b=>{if(String(b).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'});client=new Client({name:'preview-test',version:'1.0.0'});await client.connect(transport);browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}const rel=path.relative(os.tmpdir(),dir||'');if(dir&&rel.startsWith('roomsuite-previews-')&&!rel.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});});

test('PaintRoom create and edit can return their rendered image in the same MCP call',async()=>{
  const created=await request('paintroom_create',{name:'Red frame',width:100,height:100,transparent:true,include_preview:true,elements:[{type:'rect',x:0,y:0,x2:100,y2:100,fill:'#ff0000'}]});first=created.structuredContent.project_id;assert.equal(created.structuredContent.revision,1);assert.deepEqual(await pixel(picture(created),50,50),[255,0,0,255]);assert.deepEqual(await fs.readdir(work),[]);
  const edited=await request('paintroom_edit',{project_id:first,base_revision:1,include_preview:true,updates:[{index:0,x2:50,fill:'#0000ff'}]});assert.equal(edited.structuredContent.revision,2);const revised=picture(edited);assert.deepEqual(await pixel(revised,25,50),[0,0,255,255]);assert.equal((await pixel(revised,75,50))[3],0);
  await assert.rejects(request('paintroom_edit',{project_id:first,base_revision:1,updates:[{index:0,x2:10}]}),/changed/);
  const direct=await request('paintroom_preview',{project_id:first,max_dimension:256});assert.equal(direct.structuredContent.revision,2);assert.deepEqual(await pixel(picture(direct),25,50),[0,0,255,255]);
  const plain=await request('paintroom_create',{name:'Green frame',width:100,height:100,transparent:true,elements:[{type:'rect',x:0,y:0,x2:100,y2:100,fill:'#00ff00'}]});second=plain.structuredContent.project_id;assert.equal(plain.content.filter(c=>c.type==='image').length,0);
});
test('a contact sheet lets agents compare multiple saved frames',async()=>{
  const sheet=await request('paintroom_preview_sheet',{project_ids:[first,second],columns:2,max_dimension:1024});const data=picture(sheet);assert.deepEqual(sheet.structuredContent.projects.map(p=>p.project_id),[first,second]);assert.deepEqual(sheet.structuredContent.projects.map(p=>p.revision),[2,1]);assert.deepEqual(await pixel(data,100,200),[0,0,255,255]);assert.deepEqual(await pixel(data,600,200),[0,255,0,255]);
});
test('targeted changes validate indices and can remove an object',async()=>{
  await assert.rejects(request('paintroom_edit',{project_id:first,base_revision:2,updates:[{index:0,height:5}]}),/Unsupported fields/);await assert.rejects(request('paintroom_edit',{project_id:first,base_revision:2,remove_indices:[5]}),/invalid/);
  const removed=await request('paintroom_edit',{project_id:first,base_revision:2,remove_indices:[0],include_preview:true});assert.equal(removed.structuredContent.revision,3);assert.equal((await pixel(picture(removed),25,50))[3],0);
});
test('VectorRoom and existing local images can be inspected in MCP image content',async()=>{
  const prior=await fs.readdir(work),sketch=await request('vectorroom_preview',{elements:[{type:'rect',x:0,y:0,width:1000,height:700,fill:'#00ff00'}]});assert.deepEqual(await pixel(picture(sketch),100,100),[0,255,0,255]);assert.deepEqual(await fs.readdir(work),prior);
  const vector=await request('vectorroom_create',{output:'vector.svg',include_preview:true,elements:[{type:'rect',x:0,y:0,width:1000,height:700,fill:'#ff0000'}]});const data=picture(vector);assert.deepEqual(await pixel(data,100,100),[255,0,0,255]);await fs.writeFile(path.join(work,'picture.png'),Buffer.from(data,'base64'));
  const view=await request('roomsuite_preview_image',{input:'picture.png',max_dimension:256});assert.deepEqual(await pixel(picture(view),20,20),[255,0,0,255]);await assert.rejects(request('roomsuite_preview_image',{input:'../outside.png'}),/workspace/);
});
test('a preview failure does not hide that the artwork was saved',async()=>{
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base,ROOMSUITE_BROWSER_PATH:path.join(dir,'no-browser')},stderr:'pipe'});const other=new Client({name:'preview-failure',version:'1.0.0'});await other.connect(transport);
  try{const result=await request('paintroom_create',{name:'Saved even without preview',include_preview:true},other);assert.match(result.structuredContent.preview_error,/project was saved/i);assert.equal(result.content.filter(c=>c.type==='image').length,0);const saved=await (await fetch(base+'/api/paint/projects/'+result.structuredContent.project_id)).json();assert.equal(saved.state.name,'Saved even without preview');}finally{await other.close();}
});
