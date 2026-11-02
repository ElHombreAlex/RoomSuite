import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import CalDav from '../../workspace/caldav.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*15000),base='http://127.0.0.1:'+port;
const records=new Map(),calls=[];let temp,work,remote,server,browser,page,client,calendar,localId,remoteId,deleteId,sequence=0,override=null,holdPut=null,holdReport=null,rejectPut=false;
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ics=(uid,title,extra='')=>`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20240101T000000Z\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T100000Z\r\nSUMMARY:${title}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
function seed(href,data){records.set(href,{data,etag:'"v'+(++sequence)+'"'});}
async function body(req){const chunks=[];for await(const item of req)chunks.push(item);return Buffer.concat(chunks).toString('utf8');}
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
async function preview(allow=false){return call('plansuite_caldav_preview',{path:'sync.plansuite',base_revision:calendar.revision,allow_deletions:allow});}
async function sync(plan){calendar=await call('plansuite_caldav_sync',{path:'sync.plansuite',base_revision:calendar.revision,plan_token:plan.plan_token,allow_deletions:plan.allow_deletions});return calendar;}
before(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-caldav-'));work=path.join(temp,'work');await fs.mkdir(work);
  remote=http.createServer(async(req,res)=>{try{
    calls.push({method:req.method,path:req.url,authorization:req.headers.authorization,match:req.headers['if-match'],none:req.headers['if-none-match']});if(req.headers.authorization!=='Basic '+Buffer.from('test-user:test-secret').toString('base64')){res.writeHead(401);return res.end();}
    if(req.method==='REPORT'&&req.url==='/calendar/'){
      await body(req);if(holdReport){const hold=holdReport;holdReport=null;hold.started();await hold.release;}const xml=override??'<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'+[...records].map(([href,item])=>`<d:response><d:href>${escape(href)}</d:href><d:propstat><d:prop><d:getetag>${escape(item.etag)}</d:getetag><c:calendar-data>${escape(item.data)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('')+'</d:multistatus>';res.writeHead(207,{'Content-Type':'application/xml'});return res.end(xml);
    }
    if(req.method==='GET'){const item=records.get(req.url);if(!item){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':'text/calendar',ETag:item.etag});return res.end(item.data);}
    if(req.method==='PUT'){const data=await body(req);if(holdPut){const hold=holdPut;holdPut=null;hold.started();await hold.release;}if(rejectPut){rejectPut=false;res.writeHead(412);return res.end();}const item=records.get(req.url);if((req.headers['if-none-match']==='*'&&item)||(req.headers['if-match']&&req.headers['if-match']!==item?.etag)){res.writeHead(412);return res.end();}seed(req.url,data);res.writeHead(item?204:201,{ETag:records.get(req.url).etag});return res.end();}
    if(req.method==='DELETE'){const item=records.get(req.url);if(!item||req.headers['if-match']!==item.etag){res.writeHead(412);return res.end();}records.delete(req.url);res.writeHead(204);return res.end();}
    res.writeHead(404);res.end();
  }catch{res.writeHead(500);res.end();}});await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
  seed('/calendar/external.ics',ics('external','Outside','LOCATION:Office\r\n'));seed('/calendar/delete.ics',ics('remote-delete','Remote to delete'));
  server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data'),ROOMSUITE_CALDAV_URL:`http://127.0.0.1:${remote.address().port}/calendar/`,ROOMSUITE_CALDAV_USERNAME:'test-user',ROOMSUITE_CALDAV_PASSWORD:'test-secret'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});
  client=new Client({name:'caldav-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});
  calendar=await call('plansuite_create',{path:'sync.plansuite',title:'Synced'});calendar=await call('plansuite_add_event',{path:'sync.plansuite',base_revision:calendar.revision,title:'Local event',start:'2026-06-02T09:00:00Z',end:'2026-06-02T10:00:00Z'});localId=calendar.state.events[0].id;
});
after(async()=>{holdPut?.unblock();holdReport?.unblock();if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(remote)await new Promise(resolve=>remote.close(resolve));if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-caldav-'));await fs.rm(actual,{recursive:true,force:true});}});

test('configuration restricts remote URLs and never accepts credentials in a URL',()=>{
  assert.throws(()=>CalDav.configuration({}),/not configured/i);assert.throws(()=>CalDav.configuration({ROOMSUITE_CALDAV_URL:'http://example.com/calendar/'}),/HTTPS/);assert.throws(()=>CalDav.configuration({ROOMSUITE_CALDAV_URL:'https://user:pass@example.com/calendar/'}),/credentials/);assert.throws(()=>CalDav.configuration({ROOMSUITE_CALDAV_URL:'https://example.com/calendar?token=secret'}),/query/);
  const config=CalDav.configuration({ROOMSUITE_CALDAV_URL:'https://example.com/calendar/'});assert.throws(()=>CalDav.resourceUrl(config,'https://evil.example/calendar/a.ics'),/leaves/);assert.throws(()=>CalDav.resourceUrl(config,'/calendar/%252e%252e/a.ics'),/encoding/);
});

test('concurrent calendar queries are bounded and invalid requests release the slot',async()=>{
  const invalid=await fetch(base+'/api/workspace/caldav',{method:'POST',headers:{Origin:base,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:'{}'});assert.equal(invalid.status,400);
  let started,unblock;const seen=new Promise(resolve=>{started=resolve;}),release=new Promise(resolve=>{unblock=resolve;});holdReport={started,release,unblock};const pending=preview();await seen;try{await assert.rejects(preview(),/in progress/i);}finally{unblock();}const result=await pending;assert.ok(result.plan_token);
});

test('a preview token cannot be replayed for another file or a different deletion setting',async()=>{
  const a=await call('plansuite_create',{path:'token-a.plansuite',title:'Same'}),b=await call('plansuite_create',{path:'token-b.plansuite',title:'Same'});assert.equal(a.revision,b.revision);const plan=await call('plansuite_caldav_preview',{path:'token-a.plansuite',base_revision:a.revision});await assert.rejects(call('plansuite_caldav_sync',{path:'token-b.plansuite',base_revision:b.revision,plan_token:plan.plan_token}),/preview again/i);await assert.rejects(call('plansuite_caldav_sync',{path:'token-a.plansuite',base_revision:a.revision,plan_token:plan.plan_token,allow_deletions:true}),/preview again/i);
});

test('a person previews and syncs local and remote events without exposing credentials',async()=>{
  await page.goto(base+'/plansuite/?shared_file=sync.plansuite');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Saved ·'));await page.locator('#calendarSync').click();await page.locator('#caldavPreview').click();await page.waitForFunction(()=>document.querySelector('#caldavStatus').textContent.includes('Review the changes'),null,{timeout:30000});const text=await page.locator('#caldavChanges').textContent();assert.match(text,/Import or update locally: Outside/);assert.match(text,/Create remotely: Local event/);assert.doesNotMatch(text,/test-secret/);
  await page.locator('#caldavApply').click();await page.waitForFunction(()=>document.querySelector('#caldavStatus').textContent.includes('Sync finished'),null,{timeout:30000});await page.locator('#caldavDialog [data-close=caldavDialog]').last().click();calendar=await call('plansuite_get',{path:'sync.plansuite'});remoteId=calendar.state.events.find(item=>item.icalUid==='external').id;deleteId=calendar.state.events.find(item=>item.icalUid==='remote-delete').id;assert.ok(remoteId&&deleteId);assert.equal(records.size,3);assert.ok([...records.values()].some(item=>item.data.includes('SUMMARY:Local event')));assert.ok(calls.some(item=>item.method==='PUT'&&item.none==='*'));assert.ok(calls.every(item=>item.authorization==='Basic '+Buffer.from('test-user:test-secret').toString('base64')));
});

test('remote changes preserve local IDs, while unsupported external fields cannot be overwritten',async()=>{
  seed('/calendar/external.ics',ics('external','Outside changed','LOCATION:Office\r\n'));let plan=await preview();assert.ok(plan.changes.some(item=>item.uid==='external'&&item.action==='import'));assert.doesNotMatch(JSON.stringify(plan),/test-secret/);let result=await sync(plan);assert.ok(result.warnings.some(item=>item.includes('locations')));assert.equal(result.state.events.find(item=>item.icalUid==='external').id,remoteId);assert.equal(result.state.events.find(item=>item.id===remoteId).title,'Outside changed');
  calendar=await call('plansuite_update_event',{path:'sync.plansuite',base_revision:calendar.revision,event_id:remoteId,title:'Local external change'});calendar=await call('plansuite_update_event',{path:'sync.plansuite',base_revision:calendar.revision,event_id:localId,title:'Local update'});plan=await preview();assert.ok(plan.changes.some(item=>item.uid==='external'&&item.action==='conflict'));assert.ok(plan.changes.some(item=>item.uid===localId+'@roomsuite.local'&&item.action==='update_remote'));result=await sync(plan);assert.equal(result.partial,true);assert.match(records.get('/calendar/external.ics').data,/SUMMARY:Outside changed/);assert.ok([...records.values()].some(item=>item.data.includes('SUMMARY:Local update')));assert.ok(calls.some(item=>item.method==='PUT'&&item.match));
});

test('concurrent edits of the syncing calendar are fenced without blocking other files',async()=>{
  calendar=await call('plansuite_update_event',{path:'sync.plansuite',base_revision:calendar.revision,event_id:localId,title:'During sync'});const plan=await preview();let started,unblock;const seen=new Promise(resolve=>{started=resolve;}),release=new Promise(resolve=>{unblock=resolve;});holdPut={started,release,unblock};const pending=sync(plan);await seen;
  try{await assert.rejects(call('plansuite_update_event',{path:'sync.plansuite',base_revision:calendar.revision,event_id:localId,title:'Racing edit'}),/syncing/i);await assert.rejects(call('roomsuite_shared_move',{from:'sync.plansuite',to:'moved.plansuite'}),/syncing/i);await assert.rejects(call('roomsuite_shared_trash',{path:'sync.plansuite'}),/syncing/i);await assert.rejects(call('roomsuite_shared_delete',{path:'sync.plansuite'}),/syncing/i);const other=await call('plansuite_create',{path:'other.plansuite',title:'Other'});assert.ok(other.revision);}finally{unblock();}const result=await pending;assert.equal(result.partial,true);assert.ok([...records.values()].some(item=>item.data.includes('SUMMARY:During sync')));
});

test('a RoomSuite-created event can be edited remotely and then locally without losing fields',async()=>{
  const owned=[...records].find(([,item])=>item.data.includes('UID:'+localId+'@roomsuite.local'));assert.ok(owned);seed(owned[0],owned[1].data.replace('SUMMARY:During sync','SUMMARY:Remote revision').replace(/DTSTAMP:\d{8}T\d{6}Z/,'DTSTAMP:20260601T120000Z'));let plan=await preview();assert.ok(plan.changes.some(item=>item.uid===localId+'@roomsuite.local'&&item.action==='import'));await sync(plan);assert.equal(calendar.state.events.find(item=>item.id===localId).title,'Remote revision');calendar=await call('plansuite_update_event',{path:'sync.plansuite',base_revision:calendar.revision,event_id:localId,title:'Back from local'});plan=await preview();assert.ok(plan.changes.some(item=>item.uid===localId+'@roomsuite.local'&&item.action==='update_remote'));await sync(plan);assert.match(records.get(owned[0]).data,/SUMMARY:Back from local/);
});

test('stale previews are rejected and deletions require explicit review',async()=>{
  let plan=await preview();seed('/calendar/delete.ics',ics('remote-delete','Changed remotely'));await assert.rejects(call('plansuite_caldav_sync',{path:'sync.plansuite',base_revision:calendar.revision,plan_token:plan.plan_token}),/preview again/i);plan=await preview();await sync(plan);records.delete('/calendar/delete.ics');calendar=await call('plansuite_delete_event',{path:'sync.plansuite',base_revision:calendar.revision,event_id:localId});
  plan=await preview();assert.ok(plan.changes.some(item=>item.uid==='remote-delete'&&item.action==='conflict'));assert.ok(plan.changes.some(item=>item.uid===localId+'@roomsuite.local'&&item.action==='conflict'));
  plan=await preview(true);assert.ok(plan.changes.some(item=>item.uid==='remote-delete'&&item.action==='delete_local'));assert.ok(plan.changes.some(item=>item.uid===localId+'@roomsuite.local'&&item.action==='delete_remote'));const result=await sync(plan);assert.equal(result.state.events.some(item=>item.id===deleteId),false);assert.equal([...records.values()].some(item=>item.data.includes('UID:'+localId+'@roomsuite.local')),false);assert.ok(calls.some(item=>item.method==='DELETE'&&item.match));
});

test('malicious XML, escaped resource paths and weak ETags fail closed',async()=>{
  const xml=(href,tag='"v1"')=>`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${escape(href)}</d:href><d:propstat><d:prop><d:getetag>${escape(tag)}</d:getetag><c:calendar-data>${escape(ics('bad','Bad'))}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const writes=calls.filter(item=>['PUT','DELETE'].includes(item.method)).length;
  for(const bad of ['<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><d:multistatus xmlns:d="DAV:"/>',xml('https://evil.example/calendar/bad.ics'),xml('/calendar/%252e%252e/bad.ics'),xml('/calendar/bad.ics','W/"weak"')]){override=bad;await assert.rejects(preview(),/document types|leaves|encoding|strong ETags/i);}override=null;assert.equal(calls.filter(item=>['PUT','DELETE'].includes(item.method)).length,writes);
});

test('unsupported remote objects prevent inferred local deletions',async()=>{
  seed('/calendar/protected.ics',ics('protected','Protected'));let saved=await call('plansuite_create',{path:'unsafe.plansuite',title:'Protected'}),plan=await call('plansuite_caldav_preview',{path:'unsafe.plansuite',base_revision:saved.revision});saved=await call('plansuite_caldav_sync',{path:'unsafe.plansuite',base_revision:saved.revision,plan_token:plan.plan_token});const protectedId=saved.state.events.find(item=>item.icalUid==='protected').id;
  records.delete('/calendar/protected.ics');seed('/calendar/unsupported.ics',ics('unsupported','Unsupported','RRULE:FREQ=DAILY\r\n'));plan=await call('plansuite_caldav_preview',{path:'unsafe.plansuite',base_revision:saved.revision,allow_deletions:true});assert.ok(plan.unsupported.length);assert.ok(plan.changes.some(item=>item.uid==='protected'&&item.action==='conflict'&&/unsafe/i.test(item.reason)));saved=await call('plansuite_caldav_sync',{path:'unsafe.plansuite',base_revision:saved.revision,plan_token:plan.plan_token,allow_deletions:true});assert.ok(saved.state.events.some(item=>item.id===protectedId));records.delete('/calendar/unsupported.ics');
});

test('a failed conditional write is reported and retrying does not duplicate the event',async()=>{
  let saved=await call('plansuite_create',{path:'retry.plansuite',title:'Retry'});saved=await call('plansuite_add_event',{path:'retry.plansuite',base_revision:saved.revision,title:'Retry me',start:'2026-07-01T09:00:00Z',end:'2026-07-01T10:00:00Z'});const id=saved.state.events[0].id;let plan=await call('plansuite_caldav_preview',{path:'retry.plansuite',base_revision:saved.revision});rejectPut=true;saved=await call('plansuite_caldav_sync',{path:'retry.plansuite',base_revision:saved.revision,plan_token:plan.plan_token});assert.equal(saved.partial,true);assert.ok(saved.results.some(item=>item.uid===id+'@roomsuite.local'&&item.status==='failed'));assert.equal([...records.values()].filter(item=>item.data.includes('UID:'+id+'@roomsuite.local')).length,0);
  plan=await call('plansuite_caldav_preview',{path:'retry.plansuite',base_revision:saved.revision});saved=await call('plansuite_caldav_sync',{path:'retry.plansuite',base_revision:saved.revision,plan_token:plan.plan_token});assert.equal(saved.partial,false);assert.equal([...records.values()].filter(item=>item.data.includes('UID:'+id+'@roomsuite.local')).length,1);
  const owned=[...records].find(([,item])=>item.data.includes('UID:'+id+'@roomsuite.local'));seed(owned[0],owned[1].data.replace('SUMMARY:Retry me','SUMMARY:Retry me\r\nLOCATION:Private room'));plan=await call('plansuite_caldav_preview',{path:'retry.plansuite',base_revision:saved.revision});saved=await call('plansuite_caldav_sync',{path:'retry.plansuite',base_revision:saved.revision,plan_token:plan.plan_token});saved=await call('plansuite_update_event',{path:'retry.plansuite',base_revision:saved.revision,event_id:id,title:'Changed locally'});plan=await call('plansuite_caldav_preview',{path:'retry.plansuite',base_revision:saved.revision});assert.ok(plan.changes.some(item=>item.uid===id+'@roomsuite.local'&&item.action==='conflict'));assert.match(records.get(owned[0]).data,/LOCATION:Private room/);
  const files=await fs.readdir(path.join(temp,'data','workspace','.caldav'));for(const file of files){const state=await fs.readFile(path.join(temp,'data','workspace','.caldav',file),'utf8');assert.doesNotMatch(state,/test-user|test-secret/);}
});

test('large syncs defer extra changes to a later bounded batch',async()=>{
  let saved=await call('plansuite_create',{path:'batch.plansuite',title:'Batch'});saved=await call('plansuite_add_events',{path:'batch.plansuite',base_revision:saved.revision,events:Array.from({length:51},(_,index)=>({title:'Batch '+index,start:'2026-08-01T09:00:00Z',end:'2026-08-01T10:00:00Z'}))});let plan=await call('plansuite_caldav_preview',{path:'batch.plansuite',base_revision:saved.revision});assert.equal(plan.changes.filter(item=>['import','create_remote','update_remote','delete_local','delete_remote'].includes(item.action)).length,50);assert.ok(plan.changes.some(item=>item.action==='deferred'));saved=await call('plansuite_caldav_sync',{path:'batch.plansuite',base_revision:saved.revision,plan_token:plan.plan_token});assert.equal(saved.partial,true);assert.ok(saved.results.some(item=>item.action==='deferred'));plan=await call('plansuite_caldav_preview',{path:'batch.plansuite',base_revision:saved.revision});assert.ok(plan.changes.some(item=>item.action==='create_remote'||item.action==='import'));assert.equal(plan.changes.some(item=>item.action==='deferred'),false);saved=await call('plansuite_caldav_sync',{path:'batch.plansuite',base_revision:saved.revision,plan_token:plan.plan_token});assert.equal(saved.partial,false);
});
