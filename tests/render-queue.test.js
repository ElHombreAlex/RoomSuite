'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRenderQueue}=require('../cliproom/render-queue');
test('render queue bounds work, releases on errors, and removes cancelled waiters',async()=>{
  const queue=createRenderQueue({concurrency:1,maxQueued:2}),order=[];let finish;
  const first=queue.run(()=>new Promise(resolve=>{order.push('first');finish=resolve;}));await Promise.resolve();
  const controller=new AbortController(),cancelled=queue.run(()=>order.push('cancelled'),{signal:controller.signal});
  const last=queue.run(()=>{order.push('last');throw new Error('render failed');});
  await assert.rejects(queue.run(()=>{}),error=>error.status===429);assert.deepEqual(queue.stats(),{active:1,waiting:2,concurrency:1,maxQueued:2});
  controller.abort();await assert.rejects(cancelled,error=>error.status===499);finish('done');assert.equal(await first,'done');await assert.rejects(last,/render failed/);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,['first','last']);assert.equal(queue.stats().active,0);
  assert.equal(await queue.run(()=>42),42);
});
