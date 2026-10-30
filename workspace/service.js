'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const Productivity = require('../ProductivitySuite/model');
const {createReminders} = require('../ProductivitySuite/reminders');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status, message) => Object.assign(new Error(message), { status });
const limitSetting = (name, fallback) => { const n = Number(process.env[name] || fallback); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(name + ' must be a positive integer.'); return n; };
const utf8 = value => Buffer.byteLength(value, 'utf8');

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
  const files = path.join(root, 'files'), temp = path.join(root, '.tmp'), notes = path.join(root, 'notes'), paint = path.join(root, 'paint');
  const reminders = createReminders({root,files});
  const maxFile = limitSetting('ROOMSUITE_MAX_FILE_BYTES', 512 * 1024 * 1024);
  const maxTotal = limitSetting('ROOMSUITE_MAX_STORAGE_BYTES', 5 * 1024 * 1024 * 1024);
  let tail = Promise.resolve();
  async function locked(fn) { const current = tail.catch(() => {}).then(fn); tail = current; return current; }
  async function init() { for (const dir of [root, files, temp, notes, paint]) await fsp.mkdir(dir, { recursive:true, mode:0o700 }); reminders.start(); }
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
    const clean = relative(value), parts = clean.split('/'), name = parts.pop(), parent = await existing(parts.join('/'), true);
    if (!(await fsp.stat(parent)).isDirectory()) throw fail(400, 'The destination folder does not exist.');
    return { file:path.join(parent,name), clean };
  }
  async function absent(file) { try { await fsp.lstat(file); throw fail(409, 'A file or folder with that name already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
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
    try { return {file,revision:crypto.createHash('sha256').update(data).digest('hex'),state:Productivity.validate(JSON.parse(data.toString('utf8')),kind)}; }
    catch (error) { throw fail(422,'Cannot open this file: '+error.message); }
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
        const destination=await target(clean); let current=null;
        try { current=await readProductivity(clean,kind); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (input.baseRevision === null) { if (current) throw fail(409,'A file with that name already exists.'); await absent(destination.file); }
        else if (!current || current.revision!==input.baseRevision) throw fail(409,'This file changed or moved. Open the latest version or save a copy.');
        await writeJson(destination.file,state);
        json(res,200,{path:clean,revision:crypto.createHash('sha256').update(data).digest('hex'),state});
      }); return true;
    }
    if (p === '/api/workspace/info' && req.method === 'GET') { json(res,200,{ used_bytes:await usedBytes(), max_file_bytes:maxFile, max_storage_bytes:maxTotal }); return true; }
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
    if (p === '/api/workspace/file' && ['GET','HEAD'].includes(req.method)) {
      const clean = relative(url.searchParams.get('path') || ''), file = await existing(clean);
      if (!(await fsp.stat(file)).isFile()) throw fail(400, 'Choose a file to download.');
      res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(file)));
      await sendFile(req,res,file,'application/octet-stream',true); return true;
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
        const from = relative(input.from), to = relative(input.to), source = await existing(from), dest = await target(to), stat = await fsp.lstat(source);
        if (stat.isDirectory() && (dest.clean === from || dest.clean.startsWith(from + '/'))) throw fail(400,'Cannot move a folder inside itself.');
        await absent(dest.file); await fsp.rename(source,dest.file); json(res,200,{from,to});
      }); return true;
    }
    if (p === '/api/workspace/delete' && req.method === 'POST') {
      checkWrite(req); const input = await body(req);
      await locked(async () => {
        const clean = relative(input.path), file = await existing(clean), stat = await fsp.lstat(file);
        if (stat.isDirectory()) { if (input.recursive !== true) throw fail(400,'Deleting a folder requires recursive confirmation.'); await fsp.rm(file,{recursive:true}); }
        else if (stat.isFile()) await fsp.unlink(file); else throw fail(400,'Unsupported file.');
        json(res,200,{path:clean,deleted:true});
      }); return true;
    }
    if (p === '/api/notes/folders' && req.method === 'GET') { json(res,200,{folders:await folders()}); return true; }
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
