import {test} from 'node:test';
import assert from 'node:assert/strict';
import Version from '../../version.js';
import {deploymentStatus} from '../deployment.mjs';

test('deployment check reports stale startup code and different served files',async()=>{
  const original=globalThis.fetch,snapshot=Version.snapshot(),startup=structuredClone(snapshot),current=structuredClone(snapshot);
  startup.backend.hash='old-backend';startup.mcp.hash='old-mcp';current.frontend.hash='new-frontend';
  globalThis.fetch=async url=>String(url).endsWith('/api/version')?{ok:true,json:async()=>({version:snapshot.version,startup,current})}:{ok:false};
  try{const result=await deploymentStatus({},undefined);assert.equal(result.ok,false);assert.ok(result.issues.some(issue=>issue.includes('backend started before its backend files changed')));assert.ok(result.issues.some(issue=>issue.includes('different mcp files')));assert.ok(result.issues.some(issue=>issue.includes('frontend files changed')));assert.ok(result.issues.some(issue=>issue.includes('Served frontend files differ')));}
  finally{globalThis.fetch=original;}
});
test('deployment check rejects an older backend without version metadata',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:404});try{await assert.rejects(deploymentStatus({},undefined),error=>error.code==='VERSION_UNAVAILABLE');}finally{globalThis.fetch=original;}
});
