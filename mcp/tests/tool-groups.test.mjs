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
    const transport=new StdioClientTransport({command:process.execPath,args:[mcp],env:{...process.env,ROOMSUITE_MCP_GROUPS:'shared,decksuite',ROOMSUITE_MCP_WORKSPACE:dir},stderr:'pipe'});client=new Client({name:'group-test',version:'1'});await client.connect(transport);
    const names=(await client.listTools()).tools.map(tool=>tool.name);assert.ok(names.includes('roomsuite_info'));assert.ok(names.includes('roomsuite_shared_upload'));assert.ok(names.includes('decksuite_create'));assert.ok(names.includes('roomsuite_productivity_get'));assert.ok(!names.includes('soundroom_edit'));assert.ok(!names.includes('gridsuite_create'));
    const info=await client.callTool({name:'roomsuite_info',arguments:{}});assert.deepEqual(info.structuredContent.rooms.sort(),names.filter(name=>name!=='roomsuite_info').sort());assert.match(info.structuredContent.notes.join(' '),/shared, decksuite/);
    const suites=await client.callTool({name:'roomsuite_discover_suites',arguments:{}});assert.deepEqual(Object.keys(suites.structuredContent.suites),['decksuite']);
  }finally{if(client)await client.close();const actual=await fs.realpath(dir),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-groups-'));await fs.rm(actual,{recursive:true,force:true});}
});
test('invalid tool groups fail clearly at startup',async()=>{
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[mcp],{env:{...process.env,ROOMSUITE_MCP_GROUPS:'decktypo'},stdio:['pipe','pipe','pipe']});let error='',output='';child.stderr.on('data',chunk=>{error+=chunk;});child.stdout.on('data',chunk=>{output+=chunk;});child.once('error',reject);child.once('exit',code=>resolve({code,error,output}));child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'probe',version:'1'}}})+'\n');});assert.match(result.error,/ROOMSUITE_MCP_GROUPS/);assert.match(result.output,/Internal server error/);
});
