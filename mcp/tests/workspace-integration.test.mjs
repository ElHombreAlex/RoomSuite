import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url)),mcp=fileURLToPath(new URL('../server.mjs',import.meta.url));
const port=24000+Math.floor(Math.random()*20000),base='http://127.0.0.1:'+port;
let dir,work,server,client;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(x=>x.text).join(' '));return result.structuredContent||JSON.parse(result.content[0].text);}
before(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-workspace-mcp-'));work=path.join(dir,'agent');await fs.mkdir(work);await fs.copyFile(path.join(root,'PixelRoom','dist','sample.jpg'),path.join(work,'photo.jpg'));
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(dir,'data')},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server did not start.')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited: '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  const transport=new StdioClientTransport({command:process.execPath,args:[mcp],env:{...process.env,ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'});client=new Client({name:'workspace-test',version:'1.0.0'});await client.connect(transport);
});
after(async()=>{if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}const rel=path.relative(os.tmpdir(),dir||'');if(dir&&rel.startsWith('roomsuite-workspace-mcp-')&&!rel.includes(path.sep))await fs.rm(dir,{recursive:true,force:true});});

test('agent workflow moves shared media through PaintRoom, Cliproom and NotesRoom',async()=>{
  const names=(await client.listTools()).tools.map(t=>t.name);for(const name of ['roomsuite_shared_upload','roomsuite_shared_download','paintroom_create','paintroom_edit','paintroom_export','notesroom_create','notesroom_update'])assert.ok(names.includes(name),name);
  await call('roomsuite_shared_mkdir',{path:'Projects'});await call('roomsuite_shared_upload',{input:'photo.jpg',path:'Projects/photo.jpg'});
  const listing=await call('roomsuite_shared_list',{path:'Projects'});assert.equal(listing.entries[0].name,'photo.jpg');
  const searched=await call('roomsuite_shared_search',{query:'PHOTO'});assert.equal(searched.entries[0].path,'Projects/photo.jpg');assert.equal(searched.truncated,false);
  await fs.writeFile(path.join(work,'empty.txt'),'');await call('roomsuite_shared_upload',{input:'empty.txt',path:'Projects/empty.txt'});const empty=await call('roomsuite_shared_download',{path:'Projects/empty.txt',output:'empty-copy.txt'});assert.equal(empty.bytes,0);
  const created=await call('paintroom_create',{name:'Launch art',width:640,height:480,shared_image:'Projects/photo.jpg',elements:[{type:'rect',x:20,y:20,x2:180,y2:100,color:'#ff0000',fill:'#ff0000'}]});
  const read=await call('paintroom_get',{project_id:created.project_id});assert.equal(read.project.state.layers.length,2);assert.equal(read.project.state.layers[0].objects[0].type,'image');
  const edited=await call('paintroom_edit',{project_id:created.project_id,base_revision:1,elements:[{type:'stroke',points:[{x:40,y:40},{x:200,y:80}],color:'#00ff00',width:8}]});assert.equal(edited.revision,2);
  await assert.rejects(call('paintroom_edit',{project_id:created.project_id,base_revision:1}),/changed/);
  const art=await call('paintroom_export',{project_id:created.project_id,format:'png',output:'paint.png'});const png=await fs.readFile(art.path);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),640);
  await assert.rejects(call('paintroom_export',{project_id:created.project_id,format:'vectorroom',output:'unsupported.vectorroom'}),/photos/);
  const vectors=await call('paintroom_create',{name:'Editable vector',width:640,height:480,transparent:true,elements:[{type:'rect',x:20,y:20,x2:180,y2:100,fill:'#ff0000',opacity:.4}]});
  const vector=await call('paintroom_export',{project_id:vectors.project_id,format:'vectorroom',output:'editable.vectorroom'});const doc=JSON.parse(await fs.readFile(vector.path,'utf8'));assert.equal(doc.format,'vectorroom');assert.equal(doc.objects[0].opacity,.4);
  await call('roomsuite_shared_upload',{input:'paint.png',path:'Projects/paint.png'});await call('roomsuite_shared_download',{path:'Projects/paint.png',output:'copy.png'});
  const video=await call('cliproom_render',{output:'variation',render_mode:'offline',media:[{input:'copy.png',duration:.6,keyframes:[{timeline_time:0,x:25},{timeline_time:.6,x:75}]}]});assert.ok(video.bytes>1000);
  const note=await call('notesroom_create',{title:'Launch',folder:'Work/Projects',tags:['launch'],body:'Artwork: '+created.url+'\nVideo: '+video.path});assert.ok(note.url.includes('/notesroom/?note='));
  const updated=await call('notesroom_update',{note_id:note.note.id,base_revision:1,body:'Updated launch notes'});assert.equal(updated.note.revision,2);
  await assert.rejects(call('notesroom_update',{note_id:note.note.id,base_revision:1,title:'Stale'}),/changed/);
  const found=await call('notesroom_list',{search:'updated',tag:'launch'});assert.equal(found.notes[0].id,note.note.id);
  await call('notesroom_folders',{create:'Empty'});await call('notesroom_delete_folder',{path:'Empty'});
  await call('roomsuite_shared_move',{from:'Projects/paint.png',to:'Projects/final.png'});await call('roomsuite_shared_delete',{path:'Projects/final.png'});
  await assert.rejects(call('roomsuite_shared_download',{path:'Projects/photo.jpg',output:'../escape.jpg'}),/workspace/);
});
