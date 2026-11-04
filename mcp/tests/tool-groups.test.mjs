import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url)),mcp=path.join(root,'mcp','server.mjs');
test('optional tool groups expose only selected workflows and report their scope',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-groups-'));let client;
  try{
    const transport=new StdioClientTransport({command:process.execPath,args:[mcp],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_GROUPS:'shared,decksuite',ROOMSUITE_MCP_WORKSPACE:dir},stderr:'pipe'});client=new Client({name:'group-test',version:'1'});await client.connect(transport);
    const names=(await client.listTools()).tools.map(tool=>tool.name);assert.ok(names.includes('roomsuite_info'));assert.ok(names.includes('roomsuite_shared_upload'));assert.ok(names.includes('decksuite_create'));assert.ok(names.includes('roomsuite_productivity_get'));assert.ok(!names.includes('soundroom_edit'));assert.ok(!names.includes('gridsuite_create'));
    const info=await client.callTool({name:'roomsuite_info',arguments:{}});assert.deepEqual(info.structuredContent.rooms.sort(),names.filter(name=>name!=='roomsuite_info').sort());assert.match(info.structuredContent.notes.join(' '),/shared, decksuite/);
    const suites=await client.callTool({name:'roomsuite_discover_suites',arguments:{}});assert.deepEqual(Object.keys(suites.structuredContent.suites),['decksuite']);
  }finally{if(client)await client.close();const actual=await fs.realpath(dir),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-groups-'));await fs.rm(actual,{recursive:true,force:true});}
});
test('invalid tool groups fail clearly at startup',async()=>{
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[mcp],{env:{...process.env,ROOMSUITE_MCP_GROUPS:'decktypo'},stdio:['pipe','pipe','pipe']});let error='',output='';child.stderr.on('data',chunk=>{error+=chunk;});child.stdout.on('data',chunk=>{output+=chunk;});child.once('error',reject);child.once('exit',code=>resolve({code,error,output}));child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'probe',version:'1'}}})+'\n');});assert.match(result.error,/ROOMSUITE_MCP_GROUPS/);assert.match(result.output,/Internal server error/);
});
test('default mode exposes common tools and discovers the rest',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-groups-'));let client;
  try{
    const env={...process.env,ROOMSUITE_MCP_WORKSPACE:dir};delete env.ROOMSUITE_MCP_MODE;delete env.ROOMSUITE_MCP_GROUPS;
    client=new Client({name:'standard-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[mcp],env,stderr:'pipe'}));
    const names=(await client.listTools()).tools.map(tool=>tool.name);assert.ok(names.length<=25);for(const name of ['roomsuite_info','roomsuite_find_tools','roomsuite_tool_schema','roomsuite_invoke','roomsuite_shared_upload','cliproom_render','decksuite_create'])assert.ok(names.includes(name));assert.ok(!names.includes('decksuite_export_pptx'));
    const info=(await client.callTool({name:'roomsuite_info',arguments:{}})).structuredContent;assert.equal(info.mode,'standard');assert.ok(info.rooms.includes('motionroom_review'));assert.ok(!info.direct_tools.includes('motionroom_review'));assert.deepEqual([...info.direct_tools].sort(),[...names].sort());
    const review=(await client.callTool({name:'roomsuite_find_tools',arguments:{query:'motionroom_review'}})).structuredContent.tools[0];assert.equal(review.directly_advertised,false);const schema=(await client.callTool({name:'roomsuite_tool_schema',arguments:{name:'motionroom_review'}})).structuredContent;assert.equal(schema.directly_advertised,false);
    const found=await client.callTool({name:'roomsuite_find_tools',arguments:{query:'decksuite export pptx'}});assert.ok(found.structuredContent.tools.some(tool=>tool.name==='decksuite_export_pptx'));
    const suites=(await client.callTool({name:'roomsuite_discover_suites',arguments:{}})).structuredContent.suites;
    const planSupport=suites.plansuite.supports.join(' '),planLimits=suites.plansuite.limits.join(' '),docSupport=suites.docsuite.supports.join(' '),docLimits=suites.docsuite.limits.join(' ');
    assert.match(planSupport,/all-day/i);assert.match(planSupport,/IANA-zone/i);assert.match(planSupport,/CalDAV/i);assert.doesNotMatch(planLimits,/no calendar sync|all-day.*not.*supported/i);
    assert.match(docSupport,/anchored comments/i);assert.match(docLimits,/tracked-review metadata.*not exported/i);assert.doesNotMatch(docLimits,/comments and change metadata are not exported/i);
    const invalid=await client.callTool({name:'roomsuite_invoke',arguments:{name:'decksuite_export_pptx',arguments:{}}});assert.equal(invalid.structuredContent.error.code,'INVALID_ARGUMENT');
  }finally{if(client)await client.close();const actual=await fs.realpath(dir),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-groups-'));await fs.rm(actual,{recursive:true,force:true});}
});
test('compact mode discovers schemas on demand and isolates malformed calls',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-groups-'));let client,direct;
  try{
    const transport=new StdioClientTransport({command:process.execPath,args:[mcp],env:{...process.env,ROOMSUITE_MCP_MODE:'compact',ROOMSUITE_MCP_GROUPS:'shared,decksuite',ROOMSUITE_MCP_WORKSPACE:dir},stderr:'pipe'});client=new Client({name:'compact-test',version:'1'});await client.connect(transport);
    const advertised=(await client.listTools()).tools;assert.deepEqual(advertised.map(tool=>tool.name).sort(),['roomsuite_check_deployment','roomsuite_discover_suites','roomsuite_find_tools','roomsuite_info','roomsuite_invoke','roomsuite_tool_schema'].sort());
    direct=new Client({name:'direct-test',version:'1'});await direct.connect(new StdioClientTransport({command:process.execPath,args:[mcp],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_GROUPS:'shared,decksuite',ROOMSUITE_MCP_WORKSPACE:dir},stderr:'pipe'}));const directTools=(await direct.listTools()).tools;assert.ok(JSON.stringify(advertised).length<JSON.stringify(directTools).length*.35);
    const found=await client.callTool({name:'roomsuite_find_tools',arguments:{query:'decksuite create'}});assert.ok(found.structuredContent.tools.some(item=>item.name==='decksuite_create'));
    const schema=await client.callTool({name:'roomsuite_tool_schema',arguments:{name:'decksuite_create'}});assert.equal(schema.structuredContent.input_schema.type,'object');assert.ok(schema.structuredContent.input_schema.properties.path);
    for(const tool of directTools){const detail=await client.callTool({name:'roomsuite_tool_schema',arguments:{name:tool.name}});assert.equal(detail.isError,undefined,'schema for '+tool.name);assert.equal(detail.structuredContent.input_schema.type,'object');}
    const invalid=await client.callTool({name:'roomsuite_invoke',arguments:{name:'decksuite_create',arguments:{path:42}}});assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent.error.code,'INVALID_ARGUMENT');
    const blocked=await client.callTool({name:'roomsuite_invoke',arguments:{name:'soundroom_edit',arguments:{}}});assert.equal(blocked.structuredContent.error.code,'NOT_FOUND');
    const info=await client.callTool({name:'roomsuite_invoke',arguments:{name:'roomsuite_info',arguments:{}}});assert.equal(info.isError,undefined);assert.ok(info.structuredContent.rooms.includes('decksuite_create'));
    const normal=await client.callTool({name:'roomsuite_info',arguments:{}});assert.equal(normal.isError,undefined);
  }finally{if(client)await client.close();if(direct)await direct.close();const actual=await fs.realpath(dir),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-groups-'));await fs.rm(actual,{recursive:true,force:true});}
});
