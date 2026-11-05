import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';

const root=fileURLToPath(new URL('../../',import.meta.url));
test('MCP reports slow-render and frame-accurate fallback warnings',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-render-warning-'));
  let warning='slow-frames',received;
  const server=http.createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/api/render'){res.writeHead(404).end();return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);received=JSON.parse(Buffer.concat(chunks));
    res.writeHead(200,{'Content-Type':'video/webm','X-Cliproom-Render-Mode':warning==='offline-fallback'?'offline':'realtime',...(warning?{'X-Cliproom-Render-Warning':warning}:{})});res.end(Buffer.alloc(128,7));
  });
  const client=new Client({name:'render-warning-test',version:'1'});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp','server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:temp,ROOMSUITE_MCP_URL:`http://127.0.0.1:${server.address().port}`},stderr:'pipe'}));
    const project_id=randomUUID();
    const result=await client.callTool({name:'cliproom_render_project',arguments:{project_id,output:'warning.webm',render_mode:'realtime'}});
    assert.equal(result.isError,undefined,JSON.stringify(result.content));assert.equal(received.project_id,project_id);
    assert.match(result.structuredContent.warnings[0],/may be missing frames/i);
    warning='offline-fallback';
    const fallback=await client.callTool({name:'cliproom_render_project',arguments:{project_id,output:'fallback.webm',render_mode:'realtime'}});
    assert.equal(fallback.isError,undefined,JSON.stringify(fallback.content));assert.equal(fallback.structuredContent.render_mode,'offline');assert.match(fallback.structuredContent.warnings[0],/rendered every frame instead/i);
    warning='';
    const clean=await client.callTool({name:'cliproom_render_project',arguments:{project_id,output:'clean.webm',render_mode:'realtime'}});
    assert.equal(clean.isError,undefined,JSON.stringify(clean.content));assert.equal(clean.structuredContent.warnings,undefined);
  } finally {
    await client.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));
    const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-render-warning-'));await fs.rm(actual,{recursive:true,force:true});
  }
});
