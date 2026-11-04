import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url));
let work,client,other;
async function connect(){const c=new Client({name:'motion-feedback-test',version:'1'});await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'standard',ROOMSUITE_MCP_WORKSPACE:work},stderr:'pipe'}));return c;}
async function invoke(c,name,args){return c.callTool({name:'roomsuite_invoke',arguments:{name,arguments:args}});}
before(async()=>{work=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-motion-feedback-'));client=await connect();other=await connect();});
after(async()=>{if(client)await client.close();if(other)await other.close();if(work){const actual=await fs.realpath(work),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-motion-feedback-'));await fs.rm(actual,{recursive:true,force:true});}});

test('file-backed assets validate like inline assets, and unknown arguments are rejected',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  await fs.writeFile(path.join(work,'pixel.png'),png);
  await fs.writeFile(path.join(work,'assets.json'),JSON.stringify([{id:'pixel',path:'pixel.png'},{id:'linked',shared_path:'folder/other.png'}]));
  await fs.writeFile(path.join(work,'layers.json'),JSON.stringify([{id:'photo',kind:'image',image:{assetId:'pixel',width:10,height:10}}]));
  const made=await client.callTool({name:'motionroom_create',arguments:{output:'art.motionroom',assets_path:'assets.json',layers_path:'layers.json'}});assert.equal(made.isError,undefined,JSON.stringify(made));
  const info=await invoke(client,'motionroom_inspect',{input:'art.motionroom'});assert.equal(info.structuredContent.assets.length,2);assert.equal(info.structuredContent.layers[0].image.assetId,'pixel');
  const both=await client.callTool({name:'motionroom_create',arguments:{output:'both.motionroom',assets:[],assets_path:'assets.json'}});assert.equal(both.isError,true);assert.match(both.content[0].text,/assets.*both/i);
  await fs.writeFile(path.join(work,'bad-assets.json'),JSON.stringify([{id:'pixel',path:'pixel.png',typo:true}]));
  const bad=await client.callTool({name:'motionroom_create',arguments:{output:'bad.motionroom',assets_path:'bad-assets.json'}});assert.equal(bad.isError,true);assert.match(bad.content[0].text,/Invalid assets.*typo/i);
  const unknown=await invoke(client,'motionroom_create',{output:'typo.motionroom',asset_path:'assets.json'});assert.equal(unknown.isError,true);assert.equal(unknown.structuredContent.error.code,'INVALID_ARGUMENT');assert.match(unknown.content[0].text,/asset_path/);
});

test('replacement requires the inspected revision and leaves the old file intact on errors',async()=>{
  const created=await client.callTool({name:'motionroom_create',arguments:{output:'replace.motionroom',stage:{name:'First'}}});assert.equal(created.isError,undefined);
  const revision=created.structuredContent.revision;
  const collision=await client.callTool({name:'motionroom_create',arguments:{output:'replace.motionroom'}});assert.equal(collision.isError,true);assert.match(collision.content[0].text,/already exists/i);
  const invalid=await client.callTool({name:'motionroom_create',arguments:{output:'replace.motionroom',replace_revision:revision,layers:[{id:'missing',kind:'image',image:{assetId:'absent'}}]}});assert.equal(invalid.isError,true);assert.match(invalid.content[0].text,/missing.*absent/i);
  assert.equal((await invoke(client,'motionroom_inspect',{input:'replace.motionroom'})).structuredContent.revision,revision);
  const changed=await client.callTool({name:'motionroom_create',arguments:{output:'replace.motionroom',replace_revision:revision,stage:{name:'Second'}}});assert.equal(changed.isError,undefined,JSON.stringify(changed));assert.notEqual(changed.structuredContent.revision,revision);
  const stale=await client.callTool({name:'motionroom_create',arguments:{output:'replace.motionroom',replace_revision:revision,stage:{name:'Stale'}}});assert.equal(stale.isError,true);assert.equal(stale.structuredContent.error.code,'REVISION_CONFLICT');
  const inspect=await invoke(client,'motionroom_inspect',{input:'replace.motionroom'});assert.equal(inspect.structuredContent.name,'Second');assert.equal(inspect.structuredContent.revision,changed.structuredContent.revision);
  assert.equal((await fs.readdir(work)).some(name=>name.endsWith('.roomsuite-lock')||name.endsWith('.tmp')),false);
});

test('concurrent cooperating replacements do not silently overwrite each other',async()=>{
  const made=await client.callTool({name:'motionroom_create',arguments:{output:'race.motionroom'}});const revision=made.structuredContent.revision;
  const results=await Promise.all([client,other].map((c,i)=>c.callTool({name:'motionroom_create',arguments:{output:'race.motionroom',replace_revision:revision,stage:{name:'Writer '+i}}})));
  assert.equal(results.filter(result=>!result.isError).length,1,JSON.stringify(results));
  assert.ok(['REVISION_CONFLICT','CONFLICT'].includes(results.find(result=>result.isError).structuredContent.error.code));
  const info=await invoke(client,'motionroom_inspect',{input:'race.motionroom'});assert.match(info.structuredContent.name,/^Writer [01]$/);
});

test('file-based keyframe errors name the layer and frame',async()=>{
  const layer={id:'door',kind:'shape',keyframes:[{frame:0},{frame:0}]};await fs.writeFile(path.join(work,'bad-layers.json'),JSON.stringify([layer]));
  const order=await client.callTool({name:'motionroom_create',arguments:{output:'order.motionroom',layers_path:'bad-layers.json'}});assert.equal(order.isError,true);assert.match(order.content[0].text,/door.*keyframe 2.*increasing/i);
  layer.keyframes=[{frame:0,scale:22}];await fs.writeFile(path.join(work,'bad-layers.json'),JSON.stringify([layer]));
  const scale=await client.callTool({name:'motionroom_create',arguments:{output:'scale.motionroom',layers_path:'bad-layers.json'}});assert.equal(scale.isError,true);assert.match(scale.content[0].text,/door.*keyframe 1.*0\.01.*10/i);
});
