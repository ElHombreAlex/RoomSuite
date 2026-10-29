import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
const server = fileURLToPath(new URL('../server.mjs', import.meta.url));

test('2025 MCP clients can initialize, list and call tools over stdio', async () => {
  const process = spawn(globalThis.process.execPath, [server], { stdio:['pipe','pipe','pipe'] });
  const pending = new Map(); let stderr = '';
  process.stderr.on('data', data => { stderr += data; });
  const lines = createInterface({ input:process.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { for (const item of pending.values()) item.reject(new Error('Non-JSON stdout: ' + line)); return; }
    if (pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
  });
  function request(id, method, params) {
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out waiting for ' + method + ': ' + stderr)); },10000);
      pending.set(id,{ resolve:value => { clearTimeout(timer); resolve(value); }, reject:error => { clearTimeout(timer); reject(error); } });
      process.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params }) + '\n');
    });
  }
  try {
    const init = await request(1,'initialize',{ protocolVersion:'2025-11-25', capabilities:{}, clientInfo:{ name:'legacy-test', version:'1.0.0' } });
    assert.equal(init.protocolVersion,'2025-11-25');
    process.stdin.write(JSON.stringify({ jsonrpc:'2.0', method:'notifications/initialized' }) + '\n');
    const list = await request(2,'tools/list',{}); assert.ok(list.tools.some(tool => tool.name === 'roomsuite_info'));
    const info = await request(3,'tools/call',{ name:'roomsuite_info', arguments:{} }); assert.equal(info.isError,undefined); assert.ok(info.content[0].text.includes('workspace'));
  } finally { process.stdin.end(); lines.close(); if (process.exitCode === null) process.kill(); }
});
