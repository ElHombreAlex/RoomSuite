'use strict';

// Optional, explicitly configured CalDAV collection. Credentials are read
// only from the server environment and are never returned to a client.
const crypto=require('node:crypto');
const path=require('node:path');
const Calendar=require('../ProductivitySuite/calendar');
const CalendarImport=require('../ProductivitySuite/ical');

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const rawHash=value=>hash(value.replace(/\r\n/g,'\n').replace(/\r/g,'\n'));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const MAX_REPORT=16*1024*1024,MAX_OBJECTS=500,MAX_MAPPING=1500,MAX_OPERATIONS=50;
const XML_QUERY='<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>';

function safePath(value){
  if(/%(?:2f|5c|25)/i.test(value))throw fail(400,'Encoded path separators and double encoding are not supported in CalDAV URLs.');
  let decoded;try{decoded=decodeURIComponent(value);}catch{throw fail(400,'Invalid CalDAV URL path.');}
  if(decoded.includes('\\')||/[\x00-\x1f\x7f]/.test(decoded)||decoded.split('/').some(part=>part==='.'||part==='..'))throw fail(400,'Invalid CalDAV URL path.');
}
function configuration(env=process.env){
  if(!env.ROOMSUITE_CALDAV_URL)throw fail(503,'CalDAV is not configured on the RoomSuite server. Set ROOMSUITE_CALDAV_URL and restart it.');if(env.ROOMSUITE_CALDAV_URL.length>4096)throw fail(400,'The configured CalDAV URL is too long.');
  let url;try{url=new URL(env.ROOMSUITE_CALDAV_URL);}catch{throw fail(400,'The configured CalDAV URL is invalid.');}
  if(url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/'))throw fail(400,'The configured CalDAV collection URL must end in / and contain no credentials, query or fragment.');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)))throw fail(400,'CalDAV requires HTTPS, except for an explicit loopback URL.');safePath(url.pathname);
  const user=env.ROOMSUITE_CALDAV_USERNAME||'',password=env.ROOMSUITE_CALDAV_PASSWORD||'',token=env.ROOMSUITE_CALDAV_TOKEN||'';
  if([user,password,token].some(value=>value.length>2048||/[\x00-\x1f\x7f]/.test(value))||user.includes(':')||(token&&!/^[\x21-\x7e]+$/.test(token))||(token&&(user||password))||!!user!==!!password)throw fail(400,'Invalid CalDAV server credentials.');
  const authorization=token?'Bearer '+token:user?'Basic '+Buffer.from(user+':'+password,'utf8').toString('base64'):'';
  return {url:url.href,origin:url.origin,pathname:url.pathname,authorization};
}
function resourceUrl(connection,href){
  if(typeof href!=='string'||href.length>4096)throw fail(422,'A CalDAV resource URL is invalid.');let url;try{url=new URL(href,connection.url);}catch{throw fail(422,'A CalDAV resource URL is invalid.');}
  if(url.origin!==connection.origin||url.username||url.password||url.search||url.hash||!url.pathname.startsWith(connection.pathname)||url.pathname===connection.pathname)throw fail(422,'A CalDAV resource leaves the configured collection.');safePath(url.pathname);return url.href;
}
function etag(value){return typeof value==='string'&&/^"[\x21\x23-\x7e]{0,250}"$/.test(value);}
async function request(connection,url,{method='GET',headers={},body,signal,maxBytes=CalendarImport.maxBytes}={}){
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,30000);if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true});
  try{
    const response=await fetch(url,{method,redirect:'error',signal:controller.signal,headers:{...headers,...(connection.authorization?{Authorization:connection.authorization}:{})},...(body===undefined?{}:{body})});
    const declared=Number(response.headers.get('content-length')||0);if(declared>maxBytes){await response.body?.cancel();throw fail(413,'The CalDAV response is too large.');}
    const chunks=[];let size=0;if(response.body){const reader=response.body.getReader();try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes){await reader.cancel();throw fail(413,'The CalDAV response is too large.');}chunks.push(Buffer.from(part.value));}}finally{reader.releaseLock();}}
    return {status:response.status,headers:response.headers,bytes:Buffer.concat(chunks,size)};
  }catch(error){if(error.status)throw error;if(signal?.aborted)throw fail(499,'CalDAV request cancelled.');throw fail(502,'Could not contact the configured CalDAV server.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function decode(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fail(422,'The CalDAV response is not UTF-8.');}}

async function parseMultistatus(xml,signal){
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw fail(422,'CalDAV XML document types and entities are not accepted.');
  let chromium;try{({chromium}=require(require.resolve('playwright',{paths:[path.resolve(__dirname,'..','mcp')]})));}catch{throw fail(503,'CalDAV needs the optional MCP dependencies and Chromium.');}
  let browser,timer,abort,timedOut=false;try{
    if(signal?.aborted)throw fail(499,'CalDAV request cancelled.');try{browser=await chromium.launch({headless:true,timeout:15000,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});}catch{throw fail(503,'CalDAV needs a compatible Chromium browser.');}
    abort=()=>{void browser.close().catch(()=>{});};if(signal?.aborted)throw fail(499,'CalDAV request cancelled.');signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>{timedOut=true;abort();},30000);const page=await browser.newPage();await page.route('**/*',route=>route.abort());
    return await page.evaluate(({xml,max})=>{
      const document=new DOMParser().parseFromString(xml,'application/xml'),root=document.documentElement,DAV='DAV:',CAL='urn:ietf:params:xml:ns:caldav';
      if(document.querySelector('parsererror')||!root||root.localName!=='multistatus'||root.namespaceURI!==DAV)throw new Error('Invalid CalDAV multistatus XML.');
      const children=(node,ns,name)=>[...node.children].filter(child=>child.namespaceURI===ns&&child.localName===name),plain=node=>{if(node.children.length)throw new Error('Invalid nested CalDAV property.');return node.textContent;},responses=children(root,DAV,'response');
      if(responses.length>max)throw new Error('The CalDAV collection contains too many events.');
      return responses.map(response=>{
        const hrefs=children(response,DAV,'href');if(hrefs.length!==1)throw new Error('A CalDAV response needs one href.');const href=plain(hrefs[0]).trim(),values={};
        for(const propstat of children(response,DAV,'propstat')){const status=children(propstat,DAV,'status'),props=children(propstat,DAV,'prop');if(status.length!==1||props.length!==1)throw new Error('Invalid CalDAV property status.');if(!/^HTTP\/\d(?:\.\d)? 2\d\d(?:\s|$)/.test(plain(status[0]).trim()))continue;for(const [ns,key]of [[DAV,'getetag'],[CAL,'calendar-data']])for(const item of children(props[0],ns,key)){if(values[key]!==undefined)throw new Error('Duplicate CalDAV property.');values[key]=plain(item);}}
        if(values.getetag===undefined||values['calendar-data']===undefined)throw new Error('A CalDAV response is missing its ETag or event data.');return {href,etag:values.getetag.trim(),data:values['calendar-data']};
      });
    },{xml,max:MAX_OBJECTS});
  }catch(error){if(signal?.aborted)throw fail(499,'CalDAV request cancelled.');if(timedOut)throw fail(504,'CalDAV XML parsing timed out.');if(error.status)throw error;throw fail(422,'Could not safely parse the CalDAV response: '+error.message.slice(0,300));}finally{if(timer)clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);if(browser)await browser.close().catch(()=>{});}
}
async function list(connection,signal){
  const response=await request(connection,connection.url,{method:'REPORT',headers:{Depth:'1','Content-Type':'application/xml; charset=utf-8'},body:XML_QUERY,signal,maxBytes:MAX_REPORT});if(response.status!==207)throw fail(502,'The CalDAV server did not return a successful calendar query ('+response.status+').');
  const parsed=await parseMultistatus(decode(response.bytes),signal),seen=new Set();return parsed.map(item=>{const href=resourceUrl(connection,item.href);if(seen.has(href)||!etag(item.etag))throw fail(422,'CalDAV resources need unique URLs and strong ETags.');seen.add(href);return {...item,href};});
}
function group(events){
  const groups=new Map();for(const event of events){const uid=event.icalUid||event.id+'@roomsuite.local';if(!uid.trim()||uid.length>255||/[\x00-\x1f\x7f]/.test(uid))throw fail(422,'The calendar contains an invalid event UID.');const items=groups.get(uid)||[];items.push(event);groups.set(uid,items);}
  for(const [uid,items]of groups)if(items.length>1&&items.some(item=>!item.icalSeries)||items.some(item=>item.icalSeries&&item.icalSeries.uid!==uid))throw fail(422,'The calendar contains ambiguous event UIDs.');return groups;
}
function semantic(events){
  const items=events.map(event=>({title:event.title,start:event.start,end:event.end,description:event.description||'',remindMinutes:event.remindMinutes??null,allDay:!!event.allDay,...(event.icalSeries?{series:event.icalSeries}:{})}));
  items.sort((a,b)=>String(a.series?.occurrence||a.start).localeCompare(String(b.series?.occurrence||b.start))||JSON.stringify(a).localeCompare(JSON.stringify(b)));return hash(JSON.stringify(items));
}
function parseObject(data){
  const parsed=CalendarImport.parse(data,()=>crypto.randomUUID()),groups=group(parsed.events);if(groups.size!==1)throw new Error('A CalDAV object must contain one supported event UID.');const [[uid,events]]=groups;return {uid,events,semantic:semantic(events),warnings:parsed.warnings};
}
function objectText(uid,events){const copy=events.map(event=>event.icalSeries?event:{...event,seriesId:undefined,icalUid:uid});return Calendar.ics(copy);}
// Only write an externally changed object if regenerating it would retain its
// entire component structure. DTSTAMP and PRODID are informational and may be
// regenerated; unknown properties, parameters, alarms and zones are not.
function normalizedObject(data){
  const lines=data.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\n[ \t]/g,'').split('\n'),stack=[];let root;
  for(const line of lines){if(!line)continue;const colon=line.indexOf(':');if(colon<1)throw new Error('Invalid iCalendar line.');const header=line.slice(0,colon),name=header.split(';')[0].toUpperCase(),value=line.slice(colon+1);
    if(name==='BEGIN'){const node={type:value.toUpperCase(),properties:[],children:[]};if(stack.length)stack.at(-1).children.push(node);else if(root)throw new Error('Multiple calendars.');else root=node;stack.push(node);}
    else if(name==='END'){if(!stack.length||stack.pop().type!==value.toUpperCase())throw new Error('Mismatched calendar component.');}
    else{if(!stack.length)throw new Error('Calendar property outside a component.');const parent=stack.at(-1);if(name==='DTSTAMP'&&parent.type==='VEVENT'||name==='PRODID'&&parent.type==='VCALENDAR')continue;parent.properties.push(name+header.slice(name.length)+':'+value);}
  }
  if(stack.length||root?.type!=='VCALENDAR')throw new Error('Invalid calendar component.');const normalize=node=>({type:node.type,properties:node.properties.sort(),children:node.children.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});return JSON.stringify(normalize(root));
}
function preservable(data,uid,events){try{return normalizedObject(data)===normalizedObject(objectText(uid,events));}catch{return false;}}
function emptyMapping(){return {version:1,entries:[]};}
function validateMapping(value,connection){
  if(!value||value.version!==1||!Array.isArray(value.entries)||value.entries.length>MAX_MAPPING)throw fail(422,'The CalDAV sync state is invalid or has too many entries.');const seen=new Set();
  const entries=value.entries.map(item=>{if(!item||typeof item.uid!=='string'||!item.uid.trim()||item.uid.length>255||/[\x00-\x1f\x7f]/.test(item.uid)||seen.has(item.uid)||!etag(item.etag)||typeof item.owned!=='boolean'||!/^([0-9a-f]{64})$/.test(item.localHash||'')||!/^([0-9a-f]{64})$/.test(item.remoteHash||'')||!/^([0-9a-f]{64})$/.test(item.remoteRawHash||''))throw fail(422,'The CalDAV sync state is invalid.');seen.add(item.uid);return {uid:item.uid,href:resourceUrl(connection,item.href),etag:item.etag,owned:item.owned,localHash:item.localHash,remoteHash:item.remoteHash,remoteRawHash:item.remoteRawHash};});return {version:1,entries};
}
function safeToWrite(remote,old){return remote.preservable&&old.remoteRawHash===remote.rawHash;}
async function plan({connection,state,revision,scope,mapping,allowDeletions=false,signal}){
  const local=group(state.events),previous=new Map(mapping.entries.map(item=>[item.uid,item]));if(local.size>MAX_OBJECTS)throw fail(413,'CalDAV sync supports at most 500 event UIDs per calendar.');
  const resources=await list(connection,signal),remote=new Map(),unsupported=[];
  for(const resource of resources){try{const parsed=parseObject(resource.data);if(remote.has(parsed.uid))throw fail(422,'The CalDAV collection contains duplicate event UIDs.');remote.set(parsed.uid,{...resource,...parsed,rawHash:rawHash(resource.data),preservable:preservable(resource.data,parsed.uid,parsed.events)});}catch(error){if(error.status)throw error;unsupported.push({href:resource.href,reason:error.message.slice(0,200)});}}
  const invalidHrefs=new Set(unsupported.map(item=>item.href)),uids=[...new Set([...local.keys(),...remote.keys(),...previous.keys()])].sort(),items=[];
  for(const uid of uids){
    const events=local.get(uid),other=remote.get(uid),old=previous.get(uid),localHash=events?semantic(events):null;let action='conflict',reason='';
    if(old&&invalidHrefs.has(old.href))reason='The remote event cannot be interpreted safely.';
    else if(!events&&!other){if(unsupported.length)reason='Unsupported remote events make it unsafe to forget this sync record.';else if(old&&allowDeletions)action='forget';else reason='The event is missing on both sides.';}
    else if(!events&&other){if(!old)action='import';else if(!allowDeletions)reason='The local event was deleted; enable deletion propagation after review.';else if(!old.owned||!safeToWrite(other,old))reason='Only unchanged events created by RoomSuite without unsupported remote fields can be deleted remotely.';else if(other.href!==old.href||other.etag!==old.etag||other.semantic!==old.remoteHash)reason='The remote event changed after the local deletion.';else action='delete_remote';}
    else if(events&&!other){if(!old){if(unsupported.length)reason='Some remote events are unsupported, so creating new remote events could duplicate them.';else action='create_remote';}else if(unsupported.length)reason='Unsupported remote events make it unsafe to infer a deletion.';else if(!allowDeletions)reason='The remote event was deleted; enable deletion propagation after review.';else if(localHash!==old.localHash)reason='The local event changed after the remote deletion.';else action='delete_local';}
    else if(old&&old.href!==other.href)reason='The remote event moved to a different URL.';
    else if(!old){if(localHash===other.semantic)action='link';else reason='An event with this UID differs on both sides and has no shared sync history.';}
    else{
      const localChanged=localHash!==old.localHash,remoteChanged=other.etag!==old.etag||other.semantic!==old.remoteHash;
      if(localHash===other.semantic)action='link';
      else if(!localChanged&&remoteChanged)action='import';
      else if(localChanged&&!remoteChanged){if(!old.owned||!safeToWrite(other,old))reason='The remote event was not created by RoomSuite, was changed externally, or contains fields that cannot be preserved safely.';else action='update_remote';}
      else reason='The event changed on both sides; resolve it before syncing.';
    }
    items.push({uid,action,reason,title:events?.[0]?.title||other?.events?.[0]?.title||uid,events,remote:other,old,localHash});
  }
  let selected=0;for(const item of items)if(['import','create_remote','update_remote','delete_local','delete_remote'].includes(item.action)&&++selected>MAX_OPERATIONS){item.action='deferred';item.reason='This change is deferred to a later sync batch.';}
  const token=hash(JSON.stringify({url:connection.url,scope,revision,allowDeletions,mapping,remote:resources.map(item=>({href:item.href,etag:item.etag,hash:hash(item.data)})).sort((a,b)=>a.href.localeCompare(b.href))}));
  return {token,items,unsupported,allowDeletions};
}
function summary(value){return {plan_token:value.token,allow_deletions:value.allowDeletions,changes:value.items.map(({uid,action,reason,title})=>({uid,action,title,...(reason?{reason}:{})})),unsupported:value.unsupported.map(({href,reason})=>({resource_id:hash(href).slice(0,12),reason})),note:'Only saved calendar events are checked. Unsupported remote fields are never overwritten; deletion propagation requires explicit selection.'};}
function rebind(existing,incoming){
  const byOccurrence=new Map(existing.filter(item=>item.icalSeries).map(item=>[item.icalSeries.occurrence,item])),oldSeries=existing.find(item=>item.icalSeries)?.seriesId;
  return incoming.map((item,index)=>{const old=item.icalSeries?byOccurrence.get(item.icalSeries.occurrence):existing.length===1?existing[0]:null;return {...item,id:old?.id||item.id,...(item.icalSeries?{seriesId:oldSeries||item.seriesId}:old?.seriesId?{seriesId:old.seriesId}:{})};});
}
function applyLocal(state,value){
  let events=state.events.slice();for(const item of value.items){if(item.action==='delete_local')events=events.filter(event=>!item.events.includes(event));else if(item.action==='import'){const old=item.events||[];events=events.filter(event=>!old.includes(event));events.push(...rebind(old,item.remote.events));}}
  return {...state,events};
}
async function put(connection,item,signal){
  const href=item.action==='create_remote'?resourceUrl(connection,hash(item.uid)+'.ics'):item.remote.href,content=objectText(item.uid,item.events),response=await request(connection,href,{method:'PUT',headers:{'Content-Type':'text/calendar; charset=utf-8',...(item.action==='create_remote'?{'If-None-Match':'*'}:{'If-Match':item.remote.etag})},body:content,signal,maxBytes:65536});
  if(![200,201,204].includes(response.status))throw fail(response.status===412?409:502,'CalDAV write failed ('+response.status+'); the event may have changed.');
  const check=await request(connection,href,{signal,maxBytes:CalendarImport.maxBytes});if(check.status!==200)throw fail(502,'The remote write completed but could not be verified.');const tag=check.headers.get('etag');if(!etag(tag))throw fail(422,'The remote write completed without a usable strong ETag.');const text=decode(check.bytes),parsed=parseObject(text);if(parsed.uid!==item.uid||parsed.semantic!==item.localHash)throw fail(409,'The remote write completed but its event differs; review before retrying.');return {href,etag:tag,semantic:parsed.semantic,rawHash:rawHash(text)};
}
async function remove(connection,item,signal){const response=await request(connection,item.remote.href,{method:'DELETE',headers:{'If-Match':item.remote.etag},signal,maxBytes:65536});if(![200,204].includes(response.status))throw fail(response.status===412?409:502,'CalDAV deletion failed ('+response.status+'); the event may have changed.');}
module.exports={configuration,resourceUrl,etag,request,list,group,semantic,parseObject,objectText,emptyMapping,validateMapping,plan,summary,applyLocal,put,remove,MAX_OBJECTS,MAX_OPERATIONS};
