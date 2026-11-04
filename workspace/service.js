'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const Productivity = require('../ProductivitySuite/model');
const {createReminders} = require('../ProductivitySuite/reminders');
const {createHistory} = require('./history');
const NotesLinks = require('../NotesRoom/links');
const {createNoteAttachments} = require('./note-attachments');
const NoteBundle = require('./note-bundle');
const {createReferenceAudit} = require('./reference-audit');
const CalDav = require('./caldav');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const limitSetting = (name, fallback) => { const n = Number(process.env[name] || fallback); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(name + ' must be a positive integer.'); return n; };
const utf8 = value => Buffer.byteLength(value, 'utf8');
const previewTypes={'.png':['image','image/png'],'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.gif':['image','image/gif'],'.webp':['image','image/webp'],'.avif':['image','image/avif'],'.mp4':['video','video/mp4'],'.webm':['video','video/webm'],'.mov':['video','video/quicktime'],'.m4v':['video','video/x-m4v'],'.mp3':['audio','audio/mpeg'],'.wav':['audio','audio/wav'],'.m4a':['audio','audio/mp4'],'.ogg':['audio','audio/ogg'],'.flac':['audio','audio/flac'],'.txt':['text','text/plain'],'.md':['text','text/plain'],'.csv':['text','text/plain'],'.tsv':['text','text/plain'],'.srt':['text','text/plain'],'.vtt':['text','text/plain'],'.json':['text','text/plain'],'.ics':['text','text/plain'],'.html':['text','text/plain'],'.css':['text','text/plain'],'.js':['text','text/plain'],'.xml':['text','text/plain'],'.yml':['text','text/plain'],'.yaml':['text','text/plain'],'.log':['text','text/plain']};

function relative(value, allowRoot = false) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\\') || value.startsWith('/')) throw fail(400, 'Use a relative workspace path.');
  if (!value && allowRoot) return '';
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.length > 180 || /[\x00-\x1f\x7f<>:"|?*]/.test(part) || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw fail(400, 'Invalid file or folder name.');
  return parts.join('/');
}
function isInside(root, target) { const r = path.relative(root, target); return r === '' || (!path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep)); }

function createWorkspace({ dataDir, checkWrite, json, sendFile }) {
  const root = path.resolve(process.env.ROOMSUITE_DATA || path.join(dataDir, 'workspace'));
  const files = path.join(root, 'files'), temp = path.join(root, '.tmp'), notes = path.join(root, 'notes'), paint = path.join(root, 'paint'), trash = path.join(root, '.trash');
  const reminders = createReminders({root,files});
  const maxFile = limitSetting('ROOMSUITE_MAX_FILE_BYTES', 512 * 1024 * 1024);
  const maxTotal = limitSetting('ROOMSUITE_MAX_STORAGE_BYTES', 5 * 1024 * 1024 * 1024);
  const history=createHistory({directory:path.join(root,'.history'),temp,checkQuota,relative,fail});
  const noteAttachments=createNoteAttachments({directory:path.join(root,'.note-attachments'),temp,checkQuota,relative,fail});
  let tail = Promise.resolve();
  const caldavWriting=new Set();
  function assertNotSyncing(clean){const candidate=clean.toLowerCase();for(const value of caldavWriting){const active=value.toLowerCase();if(active===candidate||active.startsWith(candidate+'/'))throw fail(409,'This calendar is syncing. Try again when sync finishes.');}}
  let contentSearchRunning=false,noteLinksRunning=false,noteAttachmentAuditRunning=false,noteBundleRunning=false,referenceAuditRunning=false,caldavRunning=false;
  async function locked(fn) { const current = tail.catch(() => {}).then(fn); tail = current; return current; }
  async function init() { for (const dir of [root, files, temp, notes, paint, trash]) await fsp.mkdir(dir, { recursive:true, mode:0o700 }); const stat=await fsp.lstat(trash);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Trash must be a local directory.');await history.init();await noteAttachments.init();reminders.start(); }
  async function usedBytes(dir = root) {
    let total = 0;
    for (const entry of await fsp.readdir(dir, { withFileTypes:true })) {
      if (dir === root && entry.name === '.tmp') continue;
      const file = path.join(dir, entry.name), stat = await fsp.lstat(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) total += await usedBytes(file); else if (stat.isFile()) total += stat.size;
    }
    return total;
  }
  async function checkQuota(increase) { if (increase > 0 && await usedBytes() + increase > maxTotal) throw fail(413, 'RoomSuite storage limit reached.'); }
  async function existing(value, allowRoot = false) {
    const clean = relative(value, allowRoot); let current = files;
    for (const part of clean ? clean.split('/') : []) {
      current = path.join(current, part);
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw fail(403, 'Symbolic links cannot be used in shared files.');
    }
    const real = await fsp.realpath(current), realRoot = await fsp.realpath(files);
    if (!isInside(realRoot, real)) throw fail(403, 'Path leaves shared files.');
    return real;
  }
  async function target(value) {
    const clean = relative(value), parts = clean.split('/'), name = parts.pop();let parent;
    try { parent = await existing(parts.join('/'), true); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw fail(404, 'The destination folder does not exist: ' + parts.join('/') + '. Create the Shared folder first.'); throw error; }
    if (!(await fsp.stat(parent)).isDirectory()) throw fail(400, 'The destination folder does not exist.');
    return { file:path.join(parent,name), clean };
  }
  async function boundedContent(value,expectedSize){const file=await existing(value),handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==expectedSize||stat.size>1024*1024)throw new Error('File changed during search.');const data=Buffer.alloc(stat.size+1);let offset=0;while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}if(offset>stat.size)throw new Error('File grew during search.');return data.subarray(0,offset);}finally{await handle.close();}}
  async function absent(file) { try { await fsp.lstat(file); throw fail(409, 'A file or folder with that name already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  function trashDirectory(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw fail(400, 'Invalid trash item ID.');
    const dir=path.resolve(trash,id);if(path.dirname(dir)!==trash)throw fail(400,'Invalid trash item ID.');return dir;
  }
  async function trashRecord(id) {
    const dir=trashDirectory(id), stat=await fsp.lstat(dir);
    if(stat.isSymbolicLink()||!stat.isDirectory())throw fail(403,'Invalid trash item.');
    const metadata=path.join(dir,'metadata.json'),metaStat=await fsp.lstat(metadata);
    if(metaStat.isSymbolicLink()||!metaStat.isFile()||metaStat.size>8192)throw fail(400,'Invalid trash item metadata.');
    let info;try{info=await readJson(metadata);}catch{throw fail(400,'Invalid trash item metadata.');}
    if(!info||info.id!==id||!['file','folder'].includes(info.type)||typeof info.trashedAt!=='string')throw fail(400,'Invalid trash item metadata.');
    relative(info.originalPath);const item=path.join(dir,'item'),itemStat=await fsp.lstat(item);if(itemStat.isSymbolicLink()||(info.type==='file'?!itemStat.isFile():!itemStat.isDirectory()))throw fail(400,'Invalid trash item.');return {dir,item,info};
  }
  async function body(req, max = 2 * 1024 * 1024) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON is required.');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > max) throw fail(413, 'Request is too large.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'Invalid JSON.'); }
  }
  async function readJson(file, fallback = null) { try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; } }
  async function writeJson(file, value) {
    const data = JSON.stringify(value), oldSize = await fsp.stat(file).then(s => s.size, e => e.code === 'ENOENT' ? 0 : Promise.reject(e));
    await checkQuota(utf8(data) - oldSize);
    const tmp = path.join(temp, crypto.randomUUID() + '.json');
    try { await fsp.writeFile(tmp, data, { flag:'wx', mode:0o600 }); await fsp.rename(tmp,file); }
    finally { await fsp.rm(tmp,{force:true}).catch(() => {}); }
  }
  async function listRecords(directory) {
    const result = [];
    for (const name of await fsp.readdir(directory)) if (/^[0-9a-f-]+\.json$/i.test(name) && UUID.test(name.slice(0,-5))) {
      try { const data = await readJson(path.join(directory,name)); if (data && data.id === name.slice(0,-5)) result.push(data); } catch { /* Keep other records accessible. */ }
    }
    return result.sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  const noteFile = id => path.join(notes, id + '.json');
  async function linkedNote(id){const file=noteFile(id),before=await fsp.lstat(file);if(before.isSymbolicLink()||!before.isFile())throw fail(422,'A note could not be read.');const handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const stat=await handle.stat();if(!stat.isFile()||stat.size>2*1024*1024||stat.dev!==before.dev||stat.ino!==before.ino)throw fail(422,'A note could not be read.');const data=Buffer.alloc(stat.size+1);let at=0;while(at<data.length){const {bytesRead}=await handle.read(data,at,data.length-at,at);if(!bytesRead)break;at+=bytesRead;}if(at!==stat.size)throw fail(422,'A note changed during inspection.');let note;try{note=JSON.parse(data.subarray(0,at).toString('utf8'));}catch{throw fail(422,'A note could not be read.');}if(!note||typeof note.id!=='string'||note.id.toLowerCase()!==id.toLowerCase()||!Number.isInteger(note.revision)||typeof note.title!=='string'||typeof note.body!=='string'||typeof note.folder!=='string')throw fail(422,'A note could not be read.');return {note,bytes:stat.size};}finally{await handle.close();}}
  const referenceAudit=createReferenceAudit({files,notes,existing,relative,linkedNote,noteAttachments,fail});
  async function auditNoteAttachments(){const listing=await noteAttachments.list(),items=listing.items.map(item=>({...item,references:[],reference_count:0})),byId=new Map(items.map(item=>[item.id,item]));let complete=listing.complete,bytes=0,scanned=0,skipped=0;const names=(await fsp.readdir(notes)).filter(name=>name.endsWith('.json')&&UUID.test(name.slice(0,-5))).sort();if(names.length>10000)complete=false;for(const name of names.slice(0,10000)){if(bytes>=64*1024*1024){complete=false;break;}try{const next=await linkedNote(name.slice(0,-5));bytes+=next.bytes;if(bytes>64*1024*1024){complete=false;break;}scanned++;const found=new Set();for(const match of next.note.body.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)){const id=match[0].toLowerCase();if(byId.has(id))found.add(id);}for(const id of found){const item=byId.get(id);item.reference_count++;if(item.references.length<20)item.references.push({id:next.note.id,title:next.note.title});}}catch{complete=false;skipped++;}}return {complete,scanned_notes:scanned,skipped_notes:skipped,items:items.map(item=>({...item,status:item.reference_count?'referenced':complete?'unreferenced':'unknown'})),note:'Only saved notes are checked. Open or unsaved notes may still use an attachment.'};}
  const paintFile = id => path.join(paint, id + '.json');
  const folderFile = path.join(notes, 'folders.json');
  async function folders() { const value = await readJson(folderFile, []); return Array.isArray(value) ? value : []; }
  async function addFolders(folder) {
    if (!folder) return;
    const list = await folders(), parts = folder.split('/'); let current = '';
    for (const part of parts) { current = current ? current + '/' + part : part; if (!list.includes(current)) list.push(current); }
    await writeJson(folderFile, list.sort((a,b) => a.localeCompare(b)));
  }
  function noteValues(input) {
    if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160 || typeof input.body !== 'string' || utf8(input.body) > 1024 * 1024) throw fail(400, 'A title and Markdown body of at most 1 MB are required.');
    const folder = relative(input.folder || '', true);
    if (!Array.isArray(input.tags) || input.tags.length > 30 || input.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 50 || /[\x00-\x1f\x7f]/.test(tag))) throw fail(400, 'Tags must be nonempty text, up to 30 tags.');
    return { title:input.title.trim(), body:input.body, folder, tags:[...new Set(input.tags.map(tag => tag.trim()))] };
  }
  function paintValues(input) {
    try { return require('../PaintRoom/model').validate(input); } catch (error) { throw fail(400,error.message); }
  }
  function productivityKind(clean) {
    const kind = Object.keys(Productivity.extensions).find(key => clean.toLowerCase().endsWith(Productivity.extensions[key]));
    if (!kind) throw fail(400, 'Choose a DocSuite, GridSuite, DeckSuite or PlanSuite file.');
    return kind;
  }
  async function readProductivity(clean, kind) {
    const file=await existing(clean), stat=await fsp.stat(file);
    if (!stat.isFile()) throw fail(400,'Choose a file.');
    if (stat.size > 8*1024*1024) throw fail(413,'This file is too large to open.');
    const data=await fsp.readFile(file);
    try { return {file,bytes:data.length,revision:crypto.createHash('sha256').update(data).digest('hex'),state:Productivity.validate(JSON.parse(data.toString('utf8')),kind)}; }
    catch (error) { throw fail(422,'Cannot open this file: '+error.message); }
  }
  async function caldavMapping(clean,connection){
    const directory=path.join(root,'.caldav');await fsp.mkdir(directory,{recursive:true,mode:0o700});const stat=await fsp.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw fail(403,'CalDAV sync state must be a local directory.');
    const file=path.join(directory,crypto.createHash('sha256').update(connection.url+'\0'+clean).digest('hex')+'.json');let before;
    try{before=await fsp.lstat(file);}catch(error){if(error.code==='ENOENT')return {file,value:CalDav.emptyMapping()};throw error;}
    if(before.isSymbolicLink()||!before.isFile()||before.size>1024*1024)throw fail(422,'The CalDAV sync state cannot be read safely.');
    const handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const current=await handle.stat();if(!current.isFile()||current.size!==before.size||current.dev!==before.dev||current.ino!==before.ino)throw fail(422,'The CalDAV sync state changed while being read.');const data=await handle.readFile();if(data.length!==current.size)throw fail(422,'The CalDAV sync state changed while being read.');let value;try{value=JSON.parse(data.toString('utf8'));}catch{throw fail(422,'The CalDAV sync state is invalid.');}return {file,value:CalDav.validateMapping(value,connection)};}finally{await handle.close();}
  }
  async function saveCaldavMapping(file,value,connection){
    const directory=path.dirname(file),stat=await fsp.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw fail(403,'CalDAV sync state must be a local directory.');try{const existing=await fsp.lstat(file);if(existing.isSymbolicLink()||!existing.isFile())throw fail(403,'The CalDAV sync state is not a local file.');}catch(error){if(error.code!=='ENOENT')throw error;}
    await writeJson(file,CalDav.validateMapping(value,connection));
  }
  async function route(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith('/api/workspace') && !p.startsWith('/api/notes') && !p.startsWith('/api/paint/projects')) return false;
    if (p === '/api/workspace/notifications' && req.method === 'GET') { json(res,200,await reminders.settings()); return true; }
    if (p === '/api/workspace/notifications' && req.method === 'PUT') {
      checkWrite(req); const input=await body(req);let settings;
      try{settings=await reminders.configure(input);}catch(error){throw fail(400,error.message);}
      json(res,200,settings);return true;
    }
    if (p === '/api/workspace/notifications/test' && req.method === 'POST') {
      checkWrite(req);try{json(res,200,await reminders.test());}catch(error){throw fail(502,error.message);}return true;
    }
    if(p==='/api/workspace/caldav'&&req.method==='POST'){
      checkWrite(req);if(caldavRunning)throw fail(429,'Another CalDAV sync is in progress.');caldavRunning=true;let fenced=false,clean,disconnected;
      try{
        const input=await body(req,16384);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['path','base_revision','mode','plan_token','allow_deletions'].includes(key))||!['preview','sync'].includes(input.mode)||typeof input.base_revision!=='string'||!/^[0-9a-f]{64}$/.test(input.base_revision)||(input.allow_deletions!==undefined&&typeof input.allow_deletions!=='boolean')||(input.mode==='sync'&&(typeof input.plan_token!=='string'||!/^[0-9a-f]{64}$/.test(input.plan_token))))throw fail(400,'Choose a saved calendar, its revision and a valid CalDAV preview or sync action.');
        clean=relative(input.path);const kind=productivityKind(clean);if(kind!=='plansuite')throw fail(400,'Choose a PlanSuite calendar.');const connection=CalDav.configuration(),controller=new AbortController();disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
        const original=await readProductivity(clean,kind);if(original.revision!==input.base_revision)throw fail(409,'This calendar changed. Open the latest version before syncing.');
        const savedMapping=await locked(()=>caldavMapping(clean,connection)),plan=await CalDav.plan({connection,state:original.state,revision:original.revision,scope:clean,mapping:savedMapping.value,allowDeletions:!!input.allow_deletions,signal:controller.signal}),overview=CalDav.summary(plan);
        if(input.mode==='preview'){json(res,200,{path:clean,revision:original.revision,collection:connection.origin,...overview});return true;}
        if(input.plan_token!==plan.token)throw fail(409,'The calendar or CalDAV collection changed after the preview. Preview again.');
        if(controller.signal.aborted)return true;await locked(async()=>{const latest=await readProductivity(clean,kind);if(controller.signal.aborted)throw fail(499,'CalDAV sync cancelled.');if(latest.revision!==original.revision)throw fail(409,'This calendar changed during sync. Preview again.');caldavWriting.add(clean);fenced=true;});
        let current=original,historyWarning;const localChanges=plan.items.some(item=>item.action==='import'||item.action==='delete_local');
        if(localChanges){let state;try{state=Productivity.validate(CalDav.applyLocal(original.state,plan),kind);}catch(error){throw fail(422,'The incoming calendar changes cannot be saved: '+error.message);}const data=JSON.stringify(state);if(utf8(data)>maxFile||utf8(data)>8*1024*1024)throw fail(413,'The updated calendar exceeds the storage limit.');
          current=await locked(async()=>{const latest=await readProductivity(clean,kind);if(controller.signal.aborted)throw fail(499,'CalDAV sync cancelled.');if(latest.revision!==original.revision)throw fail(409,'This calendar changed during sync. Preview again.');const nextRevision=crypto.createHash('sha256').update(data).digest('hex');if(nextRevision!==latest.revision){try{await history.snapshot(clean,latest.file,{expectedHash:latest.revision,kind:'automatic',reserve:Math.max(0,utf8(data)-latest.bytes)});}catch(error){historyWarning='The previous calendar version could not be retained: '+error.message;}await writeJson(latest.file,state);}return {file:latest.file,revision:nextRevision,state};});
        }
        const entries=new Map(savedMapping.value.entries.map(item=>[item.uid,item])),results=[],warnings=[];let partial=false;
        for(const item of plan.items){if(item.action==='import'||item.action==='link'){entries.set(item.uid,{uid:item.uid,href:item.remote.href,etag:item.remote.etag,owned:!!item.old?.owned&&(item.old.remoteRawHash===item.remote.rawHash||item.remote.preservable),localHash:item.remote.semantic,remoteHash:item.remote.semantic,remoteRawHash:item.remote.rawHash});results.push({uid:item.uid,action:item.action,status:'applied'});if(item.action==='import'&&item.remote.warnings.length)warnings.push('Some fields in “'+item.title+'” could not be imported: '+item.remote.warnings.join(' '));}else if(item.action==='delete_local'||item.action==='forget'){entries.delete(item.uid);results.push({uid:item.uid,action:item.action,status:'applied'});}else if(item.action==='conflict'||item.action==='deferred')results.push({uid:item.uid,action:item.action,status:'skipped',reason:item.reason});}
        const persist=()=>locked(()=>saveCaldavMapping(savedMapping.file,{version:1,entries:[...entries.values()].sort((a,b)=>a.uid.localeCompare(b.uid))},connection));
        try{await persist();}catch(error){partial=true;warnings.push('Local changes may have been saved, but sync state could not be retained: '+error.message);}
        if(!partial)for(const item of plan.items.filter(item=>['create_remote','update_remote','delete_remote'].includes(item.action))){
          if(controller.signal.aborted){partial=true;warnings.push('The sync was interrupted; preview again before retrying.');break;}
          try{if((await readProductivity(clean,kind)).revision!==current.revision)throw new Error();}catch{partial=true;warnings.push('The local calendar changed or moved during sync; preview again before retrying.');break;}
          try{if(item.action==='delete_remote'){await CalDav.remove(connection,item,controller.signal);entries.delete(item.uid);}else{const remote=await CalDav.put(connection,item,controller.signal);entries.set(item.uid,{uid:item.uid,href:remote.href,etag:remote.etag,owned:true,localHash:item.localHash,remoteHash:remote.semantic,remoteRawHash:remote.rawHash});}await persist();results.push({uid:item.uid,action:item.action,status:'applied'});}
          catch(error){partial=true;results.push({uid:item.uid,action:item.action,status:'failed',reason:error.message});warnings.push('Some remote changes could not be confirmed. Preview again before retrying.');break;}
        }
        const reported=new Set(results.map(item=>item.uid));for(const item of plan.items)if(['create_remote','update_remote','delete_remote'].includes(item.action)&&!reported.has(item.uid))results.push({uid:item.uid,action:item.action,status:'not attempted'});
        if(plan.unsupported.length||plan.items.some(item=>item.action==='conflict'||item.action==='deferred')){partial=true;warnings.push('Some events need review or a later sync batch.');}if(historyWarning)warnings.push(historyWarning);try{const latest=await readProductivity(clean,kind);if(latest.revision!==current.revision){current=latest;warnings.push('The local calendar changed during sync; review it and preview again.');partial=true;}}catch{warnings.push('The local calendar moved or became unavailable during sync.');partial=true;}
        if(!res.destroyed)json(res,200,{path:clean,revision:current.revision,state:current.state,collection:connection.origin,results,unsupported:overview.unsupported,warnings,partial});return true;
      }finally{if(fenced)caldavWriting.delete(clean);caldavRunning=false;if(disconnected)res.removeListener('close',disconnected);}
    }
    if (p === '/api/workspace/productivity' && req.method === 'GET') {
      const clean=relative(url.searchParams.get('path') || ''), kind=productivityKind(clean), result=await readProductivity(clean,kind);
      json(res,200,{path:clean,revision:result.revision,state:result.state}); return true;
    }
    if (p === '/api/workspace/productivity' && req.method === 'PUT') {
      checkWrite(req);
      const clean=relative(url.searchParams.get('path') || ''), kind=productivityKind(clean), input=await body(req,8*1024*1024);
      if (!input || !(input.baseRevision === null || (typeof input.baseRevision === 'string' && /^[0-9a-f]{64}$/.test(input.baseRevision)))) throw fail(400,'The current revision, or null for a new file, is required.');
      let state; try { state=Productivity.validate(input.state,kind); } catch (error) { throw fail(400,error.message); }
      const data=JSON.stringify(state); if (utf8(data)>maxFile || utf8(data)>8*1024*1024) throw fail(413,'File exceeds the storage limit.');
      await locked(async () => {
        assertNotSyncing(clean);
        const destination=await target(clean); let current=null;
        try { current=await readProductivity(clean,kind); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (input.baseRevision === null) { if (current) throw fail(409,'A file with that name already exists.'); await absent(destination.file); }
        else if (!current || current.revision!==input.baseRevision) throw fail(409,'This file changed or moved. Open the latest version or save a copy.');
        const nextRevision=crypto.createHash('sha256').update(data).digest('hex');let historyWarning;
        if(current&&current.revision!==nextRevision)try{await history.snapshot(clean,current.file,{expectedHash:current.revision,kind:'automatic',reserve:Math.max(0,utf8(data)-current.bytes)});}catch(error){historyWarning='The file was saved without retaining its previous version: '+error.message;}
        if(!current||current.revision!==nextRevision)await writeJson(destination.file,state);
        json(res,200,{path:clean,revision:nextRevision,state,...(historyWarning?{history_warning:historyWarning}:{})});
      }); return true;
    }
    if (p === '/api/workspace/info' && req.method === 'GET') { json(res,200,{ used_bytes:await usedBytes(), max_file_bytes:maxFile, max_storage_bytes:maxTotal }); return true; }
    if(p==='/api/workspace/history'&&req.method==='GET'){
      const raw=url.searchParams.get('path'),clean=raw===null?null:relative(raw);await locked(async()=>{const entries=(await history.load()).filter(item=>clean===null||item.path===clean).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));json(res,200,{entries,limits:history.limits});});return true;
    }
    if(p==='/api/workspace/history'&&req.method==='POST'){
      checkWrite(req);const input=await body(req);await locked(async()=>{const clean=relative(input.path),source=await existing(clean),result=await history.snapshot(clean,source);json(res,200,result);});return true;
    }
    if(p==='/api/workspace/history/file'&&['GET','HEAD'].includes(req.method)){
      const result=await locked(()=>history.verified(url.searchParams.get('id')));res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(result.entry.path)));await sendFile(req,res,result.file,'application/octet-stream',true);return true;
    }
    if(p==='/api/workspace/history/restore'&&req.method==='POST'){
      checkWrite(req);const input=await body(req);await locked(async()=>{const destination=await target(input.to);await absent(destination.file);const entry=await history.restore(input.id,destination.file);json(res,200,{id:entry.id,path:destination.clean,bytes:entry.bytes,sha256:entry.sha256,restored:true});});return true;
    }
    if(p==='/api/workspace/history/delete'&&req.method==='POST'){
      checkWrite(req);const input=await body(req);if(input.confirm!==true)throw fail(400,'Confirm permanent deletion of this version.');await locked(async()=>json(res,200,await history.remove(input.id)));return true;
    }
    if (p === '/api/workspace/list' && req.method === 'GET') {
      const location = relative(url.searchParams.get('path') || '', true), dir = await existing(location,true);
      if (!(await fsp.stat(dir)).isDirectory()) throw fail(400, 'Path is not a folder.');
      const entries = [];
      for (const ent of await fsp.readdir(dir,{withFileTypes:true})) {
        const stat = await fsp.lstat(path.join(dir,ent.name));
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) continue;
        entries.push({ name:ent.name, path:location ? location + '/' + ent.name : ent.name, type:stat.isDirectory() ? 'folder' : 'file', bytes:stat.isFile() ? stat.size : null, updatedAt:stat.mtime.toISOString() });
      }
      entries.sort((a,b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)); json(res,200,{path:location,entries}); return true;
    }
    if (p === '/api/workspace/search' && req.method === 'GET') {
      const query = (url.searchParams.get('q') || '').trim().toLowerCase();
      if (!query || query.length > 200) throw fail(400, 'Enter a search of at most 200 characters.');
      const entries = [], queue = ['']; let visited = 0, truncated = false;
      while (queue.length && !truncated) {
        const location = queue.shift(), dir = await existing(location,true);
        for (const ent of await fsp.readdir(dir,{withFileTypes:true})) {
          if (++visited > 10000) { truncated = true; break; }
          const itemPath = location ? location + '/' + ent.name : ent.name;
          try { relative(itemPath); } catch { continue; }
          const stat = await fsp.lstat(path.join(dir,ent.name)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
          if (!stat || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) continue;
          if (itemPath.toLowerCase().includes(query)) {
            if (entries.length >= 200) { truncated = true; break; }
            entries.push({name:ent.name,path:itemPath,type:stat.isDirectory()?'folder':'file',bytes:stat.isFile()?stat.size:null,updatedAt:stat.mtime.toISOString()});
          }
          if (stat.isDirectory()) { if (itemPath.split('/').length < 30) queue.push(itemPath); else truncated = true; }
        }
      }
      entries.sort((a,b)=>a.path.localeCompare(b.path)); json(res,200,{entries,truncated}); return true;
    }
    if(p==='/api/workspace/search-content'&&req.method==='GET'){
      const query=(url.searchParams.get('q')||'').trim().toLowerCase(),scope=relative(url.searchParams.get('path')||'',true);if(!query||query.length>200)throw fail(400,'Enter a search of at most 200 characters.');if(contentSearchRunning)throw fail(429,'A content search is already running. Try again shortly.');contentSearchRunning=true;
      try{const scopeDir=await existing(scope,true);if(!(await fsp.stat(scopeDir)).isDirectory())throw fail(400,'Choose a folder to search.');const extensions=new Set(['.txt','.md','.csv','.tsv','.srt','.vtt','.json','.ics','.html','.css','.js','.xml','.yml','.yaml','.log','.roomgrade','.docsuite','.gridsuite','.decksuite','.plansuite','.vectorroom','.capturescene','.decktemplate','.pixelroom']),entries=[],queue=[scope];let queueIndex=0,visited=0,scannedFiles=0,scannedBytes=0,skippedLarge=0,skippedBinary=0,skippedUnreadable=0,limited=false;
        while(queueIndex<queue.length&&!limited&&!res.destroyed){const location=queue[queueIndex++];let dir,children;try{dir=await existing(location,true);children=await fsp.readdir(dir,{withFileTypes:true});}catch{skippedUnreadable++;continue;}children.sort((a,b)=>a.name.localeCompare(b.name));for(const ent of children){if(res.destroyed)break;if(++visited>10000){limited=true;break;}const itemPath=location?location+'/'+ent.name:ent.name;try{relative(itemPath);}catch{continue;}let stat;try{stat=await fsp.lstat(path.join(dir,ent.name));}catch{skippedUnreadable++;continue;}if(stat.isSymbolicLink())continue;if(stat.isDirectory()){if(itemPath.split('/').length<30)queue.push(itemPath);else limited=true;continue;}if(!stat.isFile()||!extensions.has(path.extname(ent.name).toLowerCase()))continue;if(stat.size>1024*1024){skippedLarge++;continue;}if(scannedFiles>=1000||scannedBytes+stat.size>32*1024*1024){limited=true;break;}scannedFiles++;scannedBytes+=stat.size;let data,text;try{data=await boundedContent(itemPath,stat.size);}catch{skippedUnreadable++;continue;}try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(text.includes('\0')){skippedBinary++;continue;}}catch{skippedBinary++;continue;}const index=text.toLowerCase().indexOf(query);if(index<0)continue;if(entries.length>=200){limited=true;break;}const snippet=text.slice(Math.max(0,index-70),Math.min(text.length,index+query.length+70)).replace(/[\r\n\t]+/g,' ').replace(/[\x00-\x1f\x7f]/g,' ');entries.push({name:ent.name,path:itemPath,type:'file',bytes:stat.size,updatedAt:stat.mtime.toISOString(),snippet});}}
        if(res.destroyed)return true;entries.sort((a,b)=>a.path.localeCompare(b.path));json(res,200,{entries,truncated:limited||skippedUnreadable>0,scanned_files:scannedFiles,scanned_bytes:scannedBytes,skipped_large:skippedLarge,skipped_binary:skippedBinary,skipped_unreadable:skippedUnreadable,note:'Searches supported UTF-8 text files up to 1 MiB each, within bounded file and byte limits; notes and unsupported file formats are not scanned.'});return true;
      }finally{contentSearchRunning=false;}
    }
    if (p === '/api/workspace/file' && ['GET','HEAD'].includes(req.method)) {
      const clean = relative(url.searchParams.get('path') || ''), attachment=url.searchParams.get('attachment'),file = attachment?(await noteAttachments.entry(attachment)).file:await existing(clean);
      if (!(await fsp.stat(file)).isFile()) throw fail(400, 'Choose a file to download.');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(attachment?clean:file)));
      await sendFile(req,res,file,'application/octet-stream',true); return true;
    }
    if((p==='/api/workspace/preview-info'||p==='/api/workspace/preview-data')&&['GET','HEAD'].includes(req.method)){
      const clean=relative(url.searchParams.get('path')||''),spec=previewTypes[path.extname(clean).toLowerCase()];if(!spec)throw fail(415,'This file type cannot be previewed.');const file=await existing(clean),stat=await fsp.stat(file);if(!stat.isFile())throw fail(400,'Choose a file to preview.');const [kind,mime]=spec;if(kind==='image'&&stat.size>20*1024*1024)throw fail(413,'Image previews are limited to 20 MiB.');
      if(p.endsWith('preview-data')){if(kind==='text')throw fail(415,'Use the text preview for this file.');await sendFile(req,res,file,mime,true);return true;}
      const result={path:clean,name:path.basename(clean),kind,mime_type:mime,bytes:stat.size,updated_at:stat.mtime.toISOString()};if(kind==='text'){if(stat.size>1024*1024)throw fail(413,'Text previews are limited to 1 MiB.');let decoded;try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(await boundedContent(clean,stat.size));}catch{throw fail(422,'This file is not readable UTF-8 text.');}if(decoded.includes('\0'))throw fail(422,'This file is not readable UTF-8 text.');result.text=decoded.slice(0,65536);result.truncated=decoded.length>65536;}json(res,200,result);return true;
    }
    if (p === '/api/workspace/media' && ['GET','HEAD'].includes(req.method)) {
      const clean=relative(url.searchParams.get('path') || ''),type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.webm':'audio/webm','.ogg':'audio/ogg','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.mp4':'audio/mp4'}[path.extname(clean).toLowerCase()];
      if(!type)throw fail(415,'This file cannot be displayed as note media.');
      const attachment=url.searchParams.get('attachment'),saved=attachment?await noteAttachments.entry(attachment):null,file=saved?saved.file:await existing(clean);if(saved&&saved.info.mime_type!==type)throw fail(415,'This attachment does not match the media type.');if(!(await fsp.stat(file)).isFile())throw fail(400,'Choose a media file.');
      await sendFile(req,res,file,saved?saved.info.mime_type:type,true);return true;
    }
    if (p === '/api/workspace/upload' && req.method === 'POST') {
      checkWrite(req); const destination = relative(url.searchParams.get('path') || '');
      const length = Number(req.headers['content-length'] || 0); if (length > maxFile) throw fail(413, 'File exceeds the upload limit.');
      await locked(async () => {
        const { file } = await target(destination); await absent(file);
        if (Number.isSafeInteger(length) && length > 0) await checkQuota(length);
        const tmp = path.join(temp, crypto.randomUUID() + '.upload'); let size = 0;
        const meter = new Transform({ transform(chunk,enc,cb) { size += chunk.length; cb(size > maxFile ? fail(413,'File exceeds the upload limit.') : null,chunk); } });
        try {
          await pipeline(req,meter,fs.createWriteStream(tmp,{flags:'wx',mode:0o600})); await checkQuota(size);
          try { await fsp.link(tmp,file); } catch (e) { if (e.code === 'EEXIST') throw fail(409, 'A file with that name already exists.'); throw e; }
        } finally { await fsp.rm(tmp,{force:true}).catch(() => {}); }
        json(res,201,{ path:destination, bytes:size });
      }); return true;
    }
    if (p === '/api/workspace/folder' && req.method === 'POST') {
      checkWrite(req); const input = await body(req);
      await locked(async () => { const {file,clean} = await target(input.path); await absent(file); await fsp.mkdir(file,{mode:0o700}); json(res,201,{path:clean}); }); return true;
    }
    if (p === '/api/workspace/move' && req.method === 'POST') {
      checkWrite(req); const input = await body(req);
      await locked(async () => {
        const from = relative(input.from), to = relative(input.to);assertNotSyncing(from);const source = await existing(from), dest = await target(to), stat = await fsp.lstat(source);
        if (stat.isDirectory() && (dest.clean === from || dest.clean.startsWith(from + '/'))) throw fail(400,'Cannot move a folder inside itself.');
        await absent(dest.file); await fsp.rename(source,dest.file); json(res,200,{from,to});
      }); return true;
    }
    if(p==='/api/workspace/references'&&req.method==='GET'){
      if(referenceAuditRunning)throw fail(429,'Another reference scan is running. Try again shortly.');referenceAuditRunning=true;
      try{await locked(async()=>json(res,200,await referenceAudit.inspect(url.searchParams.get('path')||'')));return true;}finally{referenceAuditRunning=false;}
    }
    if (p === '/api/workspace/trash' && req.method === 'GET') {
      const entries=[];
      for(const id of await fsp.readdir(trash))if(UUID.test(id))try{entries.push((await trashRecord(id)).info);}catch(error){if(error.code!=='ENOENT'&&error.status!==400&&error.status!==403)throw error;}
      entries.sort((a,b)=>b.trashedAt.localeCompare(a.trashedAt));json(res,200,{entries});return true;
    }
    if (p === '/api/workspace/trash' && req.method === 'POST') {
      checkWrite(req);const input=await body(req);
      const safe=input?.require_unreferenced===true;if(safe&&referenceAuditRunning)throw fail(429,'Another reference scan is running. Try again shortly.');if(safe)referenceAuditRunning=true;
      try{await locked(async()=>{
        const clean=relative(input.path);assertNotSyncing(clean);const source=await existing(clean);let stat=await fsp.lstat(source);
        if(input.require_unreferenced===true){
          if(input.confirm_unscanned!==true||typeof input.base_revision!=='string'||!/^[0-9a-f]{64}$/.test(input.base_revision))throw fail(400,'Provide the inspected file revision and confirm that unscanned work may still refer to it.');
          const report=await referenceAudit.inspect(clean);
          if(report.revision!==input.base_revision)throw fail(409,'This file changed since inspection. Check its uses again.');
          if(!report.complete)throw fail(409,'The reference scan was incomplete; nothing was moved.');
          if(report.blocking_count)throw fail(409,'Saved notes or shared files may still refer to this file.');
          stat=await fsp.lstat(source);if(stat.isSymbolicLink()||!stat.isFile()||referenceAudit.fingerprint(stat)!==input.base_revision)throw fail(409,'This file changed since inspection. Check its uses again.');
        }
        if(stat.isDirectory()&&input.recursive!==true)throw fail(400,'Moving a folder to trash requires recursive confirmation.');
        if(!stat.isFile()&&!stat.isDirectory())throw fail(400,'Unsupported file.');
        const id=crypto.randomUUID(),dir=trashDirectory(id),info={id,originalPath:clean,type:stat.isDirectory()?'folder':'file',trashedAt:new Date().toISOString(),bytes:stat.isFile()?stat.size:null};
        await fsp.mkdir(dir,{mode:0o700});let moved=false;
        try{await fsp.writeFile(path.join(dir,'metadata.json'),JSON.stringify(info),{flag:'wx',mode:0o600});if(safe){const current=await fsp.lstat(source);if(current.isSymbolicLink()||!current.isFile()||referenceAudit.fingerprint(current)!==input.base_revision)throw fail(409,'This file changed since inspection. Check its uses again.');}await fsp.rename(source,path.join(dir,'item'));moved=true;}
        finally{if(!moved)await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});}
        json(res,200,info);
      });return true;}finally{if(safe)referenceAuditRunning=false;}
    }
    if (p === '/api/workspace/trash/restore' && req.method === 'POST') {
      checkWrite(req);const input=await body(req);
      await locked(async()=>{
        const entry=await trashRecord(input.id),destination=await target(input.to===undefined?entry.info.originalPath:input.to);await absent(destination.file);
        await fsp.rename(entry.item,destination.file);const result={id:entry.info.id,path:destination.clean,restored:true};
        try{await fsp.rm(entry.dir,{recursive:true,force:true});}catch{result.warning='The file was restored, but its trash metadata could not be removed.';}json(res,200,result);
      });return true;
    }
    if (p === '/api/workspace/trash/purge' && req.method === 'POST') {
      checkWrite(req);const input=await body(req);
      await locked(async()=>{const entry=await trashRecord(input.id);await fsp.rm(entry.dir,{recursive:true,force:true});json(res,200,{id:entry.info.id,deleted:true});});return true;
    }
    if (p === '/api/workspace/delete' && req.method === 'POST') {
      checkWrite(req); const input = await body(req);
      await locked(async () => {
        const clean = relative(input.path);assertNotSyncing(clean);const file = await existing(clean), stat = await fsp.lstat(file);
        if (stat.isDirectory()) { if (input.recursive !== true) throw fail(400,'Deleting a folder requires recursive confirmation.'); await fsp.rm(file,{recursive:true}); }
        else if (stat.isFile()) await fsp.unlink(file); else throw fail(400,'Unsupported file.');
        json(res,200,{path:clean,deleted:true});
      }); return true;
    }
    if (p === '/api/notes/folders' && req.method === 'GET') { json(res,200,{folders:await folders()}); return true; }
    const noteBundleMatch=/^\/api\/notes\/([0-9a-f-]+)\/bundle$/i.exec(p);
    if(noteBundleMatch&&UUID.test(noteBundleMatch[1])&&req.method==='GET'){if(noteBundleRunning)throw fail(429,'Another note bundle is being prepared.');const revision=Number(url.searchParams.get('revision'));if(!Number.isInteger(revision)||revision<1)throw fail(400,'The current note revision is required.');noteBundleRunning=true;try{await locked(async()=>{const {note}=await linkedNote(noteBundleMatch[1].toLowerCase());if(note.revision!==revision)throw fail(409,'This note changed on another device. Reload it before exporting.');const bundle=await NoteBundle.create(note,{existing,noteAttachments,relative,fail}),data=JSON.stringify(bundle);if(utf8(data)>NoteBundle.maxPackage)throw fail(413,'The note bundle is too large.');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''note.roomnote");res.end(data);});return true;}finally{noteBundleRunning=false;}}
    if(p==='/api/notes/bundles/import'&&req.method==='POST'){checkWrite(req);if(noteBundleRunning)throw fail(429,'Another note bundle is being prepared.');const id=url.searchParams.get('import_id');if(!id||!UUID.test(id))throw fail(400,'A version-4 import ID is required for safe retries.');noteBundleRunning=true;try{const bundle=await body(req,NoteBundle.maxPackage),fingerprint=crypto.createHash('sha256').update(JSON.stringify(bundle)).digest('hex'),validated=NoteBundle.validate(bundle,{relative,noteValues,fail});await locked(async()=>{const existingNote=await readJson(noteFile(id.toLowerCase()));if(existingNote){if(existingNote.bundle_import_sha256!==fingerprint)throw fail(409,'This import ID is already in use.');json(res,200,{note:existingNote,replayed:true,warnings:validated.warnings});return;}const ids=new Map();for(const [key,item]of validated.assets){const temporary=path.join(temp,crypto.randomUUID()+'.note-bundle');try{await fsp.writeFile(temporary,item.data,{flag:'wx',mode:0o600});const saved=await noteAttachments.create(item.ref.path,temporary);ids.set(key,saved.attachment.id);}finally{await fsp.rm(temporary,{force:true}).catch(()=>{});}}for(const item of validated.parsed.items)validated.parsed.lines[item.index]=require('../NotesRoom/media').rewrite(item.line,ids.get(NoteBundle.key(item)));const values=noteValues({...validated.note,body:validated.parsed.lines.join('\n')}),now=new Date().toISOString(),record={id:id.toLowerCase(),revision:1,createdAt:now,updatedAt:now,...values,bundle_import_sha256:fingerprint};await addFolders(values.folder);await writeJson(noteFile(record.id),record);json(res,201,{note:record,replayed:false,warnings:validated.warnings});});return true;}finally{noteBundleRunning=false;}}
    if(p==='/api/notes/attachments'&&req.method==='POST'){checkWrite(req);const input=await body(req);await locked(async()=>{const clean=relative(input.path),source=await existing(clean);json(res,200,await noteAttachments.create(clean,source));});return true;}
    if(p==='/api/notes/attachments'&&req.method==='GET'){if(noteAttachmentAuditRunning)throw fail(429,'Another attachment scan is running.');noteAttachmentAuditRunning=true;try{json(res,200,await auditNoteAttachments());return true;}finally{noteAttachmentAuditRunning=false;}}
    const attachmentMatch=/^\/api\/notes\/attachments\/([0-9a-f-]+)$/i.exec(p);
    if(attachmentMatch&&UUID.test(attachmentMatch[1])&&req.method==='DELETE'){checkWrite(req);const input=await body(req);if(input.confirm_unsaved!==true)throw fail(400,'Confirm that open or unsaved notes may still use this attachment.');if(noteAttachmentAuditRunning)throw fail(429,'Another attachment scan is running.');noteAttachmentAuditRunning=true;try{await locked(async()=>{const report=await auditNoteAttachments();if(!report.complete)throw fail(409,'Attachment scan is incomplete; nothing was deleted.');const item=report.items.find(entry=>entry.id===attachmentMatch[1].toLowerCase());if(!item)throw fail(404,'Note attachment not found.');if(item.reference_count)throw fail(409,'Saved notes still reference this attachment.');if(Date.now()-Math.max(Date.parse(item.created_at),Date.parse(item.last_reserved_at))<24*60*60*1000)throw fail(409,'Attachments must be at least 24 hours old before deletion.');json(res,200,await noteAttachments.remove(item.id));});return true;}finally{noteAttachmentAuditRunning=false;}}
    if (p === '/api/notes/folders' && req.method === 'POST') {
      checkWrite(req); const input = await body(req), folder = relative(input.path);
      await locked(async () => { await addFolders(folder); json(res,201,{path:folder}); }); return true;
    }
    if (p === '/api/notes/folders' && req.method === 'DELETE') {
      checkWrite(req); const input = await body(req), folder = relative(input.path);
      await locked(async () => { const list = await folders(); if (!list.includes(folder)) throw fail(404,'Folder not found.');
        if (list.some(item => item.startsWith(folder + '/')) || (await listRecords(notes)).some(note => note.folder === folder || note.folder?.startsWith(folder + '/'))) throw fail(409,'Move or delete the notes and subfolders first.');
        await writeJson(folderFile,list.filter(item => item !== folder)); json(res,200,{path:folder,deleted:true}); }); return true;
    }
    if (p === '/api/notes' && req.method === 'GET') {
      const query = (url.searchParams.get('search') || '').toLowerCase(), folder = url.searchParams.get('folder'), tag = (url.searchParams.get('tag') || '').toLowerCase();
      const records = (await listRecords(notes)).filter(n => (!query || [n.title,n.body,n.folder,...(n.tags || [])].join(' ').toLowerCase().includes(query)) && (folder === null || n.folder === folder) && (!tag || (n.tags || []).some(t => t.toLowerCase() === tag)));
      json(res,200,{notes:records.map(({body,...item}) => item)}); return true;
    }
    if (p === '/api/notes' && req.method === 'POST') {
      checkWrite(req); const values = noteValues(await body(req));
      await locked(async () => { const id=crypto.randomUUID(), now=new Date().toISOString(), record={id,revision:1,createdAt:now,updatedAt:now,...values};
        await addFolders(values.folder); await writeJson(noteFile(id),record); json(res,201,record); }); return true;
    }
    const linkMatch=/^\/api\/notes\/([0-9a-f-]+)\/links$/i.exec(p);
    if(linkMatch&&UUID.test(linkMatch[1])&&req.method==='GET'){
      if(noteLinksRunning)throw fail(429,'Another note-link scan is running. Try again shortly.');noteLinksRunning=true;try{const id=linkMatch[1].toLowerCase(),initial=await linkedNote(id),note=initial.note,found=NotesLinks.find(note.body),outgoing=[];let truncated=found.truncated,skipped=0,bytes=initial.bytes;
        for(const targetId of found.ids){if(bytes>=64*1024*1024){outgoing.push({id:targetId,title:'Not inspected',folder:'',status:'unavailable'});truncated=true;continue;}try{const next=await linkedNote(targetId);bytes+=next.bytes;if(bytes>64*1024*1024){outgoing.push({id:targetId,title:'Not inspected',folder:'',status:'unavailable'});truncated=true;continue;}const target=next.note;outgoing.push({id:target.id,title:target.title,folder:target.folder,status:'available'});}catch(error){if(error.code==='ENOENT')outgoing.push({id:targetId,title:'Missing note',folder:'',status:'missing'});else{outgoing.push({id:targetId,title:'Unavailable note',folder:'',status:'unavailable'});truncated=true;}}}
        const names=(await fsp.readdir(notes)).filter(name=>name.endsWith('.json')&&UUID.test(name.slice(0,-5))).sort(),backlinks=[];let scanned=0;if(names.length>10000)truncated=true;for(const name of names.slice(0,10000)){if(bytes>=64*1024*1024){truncated=true;break;}const otherId=name.slice(0,-5).toLowerCase();try{const next=await linkedNote(otherId);bytes+=next.bytes;if(bytes>64*1024*1024){truncated=true;break;}scanned++;const links=NotesLinks.find(next.note.body);if(links.truncated)truncated=true;if(links.ids.includes(id)){if(backlinks.length<200)backlinks.push({id:next.note.id,title:next.note.title,folder:next.note.folder});else truncated=true;}}catch{skipped++;truncated=true;}}
        backlinks.sort((a,b)=>a.title.localeCompare(b.title)||a.id.localeCompare(b.id));json(res,200,{note_id:note.id,revision:note.revision,outgoing,backlinks,truncated,scanned_notes:scanned,skipped_notes:skipped,note:'Links are found in saved Markdown notes. Unsaved edits are not included; code blocks are ignored.'});return true;
      }finally{noteLinksRunning=false;}
    }
    let match = /^\/api\/notes\/([0-9a-f-]+)$/i.exec(p);
    if (match && UUID.test(match[1])) {
      const id=match[1], file=noteFile(id);
      if (req.method === 'GET') { const record=await readJson(file); if (!record) throw fail(404,'Note not found.'); json(res,200,record); return true; }
      if (req.method === 'PUT' || req.method === 'DELETE') {
        checkWrite(req); const input=await body(req);
        if (!Number.isInteger(input?.baseRevision) || input.baseRevision < 1) throw fail(400,'The current note revision is required.');
        const values=req.method === 'PUT' ? noteValues(input) : null;
        await locked(async () => { const old=await readJson(file); if (!old) throw fail(404,'Note not found.'); if (old.revision !== input.baseRevision) throw fail(409,'This note changed on another device. Reload it before saving or deleting.');
          if (req.method === 'DELETE') { await fsp.unlink(file); json(res,200,{id,deleted:true}); }
          else { const record={...old,...values,revision:old.revision+1,updatedAt:new Date().toISOString()}; await addFolders(values.folder); await writeJson(file,record); json(res,200,record); } }); return true;
      }
    }
    if (p === '/api/paint/projects' && req.method === 'GET') { const items=await listRecords(paint); json(res,200,{projects:items.map(({state,...entry}) => ({...entry,name:state?.name}))}); return true; }
    match = /^\/api\/paint\/projects\/([0-9a-f-]+)$/i.exec(p);
    if (match && UUID.test(match[1])) {
      const id=match[1], file=paintFile(id);
      if (req.method === 'GET') { const project=await readJson(file); if (!project) throw fail(404,'PaintRoom project not found.'); json(res,200,project); return true; }
      if (req.method === 'PUT' || req.method === 'DELETE') {
        checkWrite(req); const input=await body(req,32*1024*1024);
        if (!Number.isInteger(input?.baseRevision) || input.baseRevision < 0) throw fail(400,'The current project revision is required.');
        const state=req.method === 'PUT' ? paintValues(input.state) : null;
        await locked(async () => { const old=await readJson(file), revision=old?.revision || 0;
          if (req.method === 'DELETE' && !old) throw fail(404,'PaintRoom project not found.');
          if (revision !== input.baseRevision) throw fail(409,'This PaintRoom project changed on another device. Open the latest version or save a copy.');
          if (req.method === 'DELETE') { await fsp.unlink(file); json(res,200,{id,deleted:true}); }
          else { const project={id,revision:revision+1,updatedAt:new Date().toISOString(),state}; await writeJson(file,project); json(res,200,project); } }); return true;
      }
    }
    throw fail(404,'Not found.');
  }
  return { init, route, root, files, maxFile, maxTotal };
}
module.exports = { createWorkspace };
