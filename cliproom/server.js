'use strict';

// Cliproom has no runtime dependencies. It deliberately listens on loopback only:
// put Tailscale Serve in front of it to authorize devices and provide HTTPS.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRenderQueue } = require('./render-queue');
const colorGrade = require('./public/color-grade.js');
const SoundSettings = require('./public/sound-settings.js');
const ClipLookFrames = require('./public/look-keyframes.js');
const Timeline = require('./public/timeline.js');
const ClipRegionGrade = require('./public/region-grade.js');
const { audit: auditAssets } = require('./asset-audit');
const { createMediaTrash } = require('./media-trash');
const { createProxyCache } = require('./proxy-cache');
const { createUploader } = require('./idempotent-upload');
const ProjectPackage = require('./project-package');
const { createSpeechModel } = require('./speech-model');
const { Transform } = require('node:stream');
const { pipeline, finished } = require('node:stream/promises');

const PORT = Number(process.env.CLIPROOM_PORT || 8090);
const DATA = path.resolve(process.env.CLIPROOM_DATA || path.join(__dirname, 'data'));
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(PORT === 80 ? ['localhost', '127.0.0.1'] : []), ...(process.env.CLIPROOM_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)]);
const PROJECTS = path.join(DATA, 'projects');
const ASSETS = path.join(DATA, 'assets');
const MEDIA_TRASH = path.join(DATA, 'media-trash');
const PROXIES = path.join(DATA, 'proxies');
const SPEECH_MODEL = path.join(DATA, 'speech-model');
const PACKAGE_TEMP = path.join(DATA, '.package-temp');
const PUBLIC = path.join(__dirname, 'public');
const SUITE_MODE = process.env.ROOMSUITE_MODE === '1';
const SUITE_ROOT = path.resolve(__dirname, '..');
const suiteVersion = SUITE_MODE ? require('../version') : null;
const startupVersion = suiteVersion ? suiteVersion.snapshot() : null;
const MAX_MEDIA = 2 * 1024 * 1024 * 1024;
const MAX_PROJECT = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mediaTypes = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v', 'video/mpeg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm', 'audio/aac', 'audio/flac', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const mediaTrash=createMediaTrash({assetsDir:ASSETS,projectsDir:PROJECTS,trashDir:MEDIA_TRASH,mediaTypes});
const publicFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/timeline.js': ['timeline.js', 'text/javascript; charset=utf-8'], '/waveform.js': ['waveform.js', 'text/javascript; charset=utf-8'], '/sound-settings.js': ['sound-settings.js', 'text/javascript; charset=utf-8'], '/subtitles.js': ['subtitles.js', 'text/javascript; charset=utf-8'], '/speech.js': ['speech.js', 'text/javascript; charset=utf-8'], '/speech-worker.js': ['speech-worker.js', 'text/javascript; charset=utf-8'], '/proxy.js': ['proxy.js', 'text/javascript; charset=utf-8'], '/color-look.js': ['color-look.js', 'text/javascript; charset=utf-8'], '/look-keyframes.js': ['look-keyframes.js', 'text/javascript; charset=utf-8'], '/layer-mask.js': ['layer-mask.js', 'text/javascript; charset=utf-8'], '/region-grade.js': ['region-grade.js', 'text/javascript; charset=utf-8'], '/color-grade.js': ['color-grade.js', 'text/javascript; charset=utf-8'], '/color-grade-ui.js': ['color-grade-ui.js', 'text/javascript; charset=utf-8'], '/color-grade.css': ['color-grade.css', 'text/css; charset=utf-8'], '/webm-duration.js': ['webm-duration.js', 'text/javascript; charset=utf-8'], '/offline-render.js': ['offline-render.js', 'text/javascript; charset=utf-8'], '/mp4-audio.js': ['mp4-audio.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/brand.css': ['brand.css', 'text/css; charset=utf-8'], '/room-icon.svg': ['room-icon.svg', 'image/svg+xml'], '/room-icon-light.svg': ['room-icon-light.svg', 'image/svg+xml'] };
const suiteRoots = { '/suite/': 'suite', '/soundroom/': 'SoundRoom', '/captureroom/': 'CaptureRoom', '/vectorroom/': 'VectorRoom', '/motionroom/':'MotionRoom', '/pixelroom/': 'PixelRoom/dist', '/notesroom/':'NotesRoom', '/paintroom/':'PaintRoom', '/files/':'FilesRoom', '/docsuite/':'ProductivitySuite', '/gridsuite/':'ProductivitySuite', '/decksuite/':'ProductivitySuite', '/plansuite/':'ProductivitySuite' };
const suiteTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf':'font/ttf' };
const locks = new Map();
let mediaAuditRunning=false,mediaMutating=false,activeRenderRequests=0,packageBusy=false,packageDownloads=0,speechLease=null;
function queueSetting(name,fallback,min,max){const value=process.env[name]===undefined?fallback:Number(process.env[name]);if(!Number.isInteger(value)||value<min||value>max)throw new Error(name+' must be an integer from '+min+' to '+max+'.');return value;}
const renderQueue=createRenderQueue({concurrency:queueSetting('CLIPROOM_RENDER_CONCURRENCY',1,1,4),maxQueued:queueSetting('CLIPROOM_RENDER_MAX_QUEUE',4,0,20)});

function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, status, body) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function error(status, message) { return Object.assign(new Error(message), { status }); }
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PROJECT) throw error(413, 'Project is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw error(400, 'Invalid JSON.'); }
}
function checkWrite(req) {
  let origin;
  try { origin = new URL(req.headers.origin); } catch { throw error(403, 'A same-origin request is required.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host || req.headers['x-cliproom-request'] !== '1') {
    throw error(403, 'A same-origin request is required.');
  }
}
async function atomicJson(file, object) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { await fsp.writeFile(tmp, JSON.stringify(object), { flag: 'wx', mode: 0o600 }); await fsp.rename(tmp, file); }
  finally { await fsp.rm(tmp, { force: true }).catch(() => {}); }
}
async function withLock(id, fn) {
  const previous = locks.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  locks.set(id, current);
  try { return await current; } finally { if (locks.get(id) === current) locks.delete(id); }
}
async function mutateMedia(fn){return withLock('asset-catalog',async()=>{if(activeRenderRequests)throw error(409,'A server render is using media. Wait for it to finish.');mediaMutating=true;try{return await fn();}finally{mediaMutating=false;}});}
const proxyCache=createProxyCache({directory:PROXIES,assetsDir:ASSETS,withLock});
const speechModel=createSpeechModel({directory:SPEECH_MODEL});
const uploadWithId=createUploader({assetsDir:ASSETS,maxBytes:MAX_MEDIA,withLock,atomicJson,fail:error});
async function readProject(id) {
  try { return JSON.parse(await fsp.readFile(path.join(PROJECTS, `${id}.json`), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function sendFile(req, res, file, type, asset = false) {
  const stat = await fsp.stat(file);
  let start = 0, end = stat.size - 1, status = 200;
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    if (!match[1]) { const suffix = Number(match[2]); start = Math.max(0, stat.size - suffix); }
    else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', Math.max(0, end - start + 1));
  if (asset) res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.writeHead(status);
  if (req.method === 'HEAD' || stat.size === 0) return res.end();
  fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
}
const sharedWorkspace = SUITE_MODE ? require('../workspace/service').createWorkspace({ dataDir:DATA, checkWrite, json, sendFile }) : null;

async function route(req, res) {
  headers(res);
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) throw error(403, 'This host is not allowed. Configure CLIPROOM_ALLOWED_HOSTS for your Tailscale URL.');
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (SUITE_MODE && (req.method === 'GET' || req.method === 'HEAD')) {
    if (['/cliproom', '/soundroom', '/captureroom', '/vectorroom', '/motionroom', '/pixelroom', '/notesroom', '/paintroom', '/files', '/docsuite', '/gridsuite', '/decksuite', '/plansuite'].includes(pathname)) {
      res.writeHead(308, { Location: pathname + '/' }); return res.end();
    }
    if (pathname === '/' || pathname === '/index.html') {
      return sendFile(req, res, path.join(SUITE_ROOT, 'suite', 'index.html'), suiteTypes['.html']);
    }
    if (pathname === '/cliproom/') return sendFile(req, res, path.join(PUBLIC, 'index.html'), suiteTypes['.html']);
    for (const [prefix, root] of Object.entries(suiteRoots)) {
      if (!pathname.startsWith(prefix)) continue;
      let relative;
      try { relative = decodeURIComponent(pathname.slice(prefix.length)) || 'index.html'; } catch { throw error(400, 'Invalid path.'); }
      const directory = path.resolve(SUITE_ROOT, root);
      const file = path.resolve(directory, relative);
      const within = path.relative(directory, file);
      if (!within || within.startsWith('..') || path.isAbsolute(within)) throw error(404, 'Not found.');
      const type = suiteTypes[path.extname(file).toLowerCase()];
      if (!type) throw error(404, 'Not found.');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      return sendFile(req, res, file, type);
    }
  }
  if (sharedWorkspace && await sharedWorkspace.route(req,res,url)) return;
  if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, ...(startupVersion?{version:startupVersion.version}: {}) });
  if (SUITE_MODE && req.method === 'GET' && pathname === '/api/version') {const current=suiteVersion.snapshot();return json(res,200,{version:startupVersion.version,startup:startupVersion,current});}
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/render/mediabunny.mjs') {
    const bundle = path.join(SUITE_ROOT, 'mcp', 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.mjs');
    try { await fsp.access(bundle); } catch { throw error(503, 'Offline rendering requires the optional MCP dependencies. Run npm ci --prefix mcp.'); }
    return sendFile(req, res, bundle, 'text/javascript; charset=utf-8');
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/render/gifenc.mjs') {
    const bundle = path.join(SUITE_ROOT,'mcp','node_modules','gifenc','dist','gifenc.esm.js');
    try { await fsp.access(bundle); } catch { throw error(503,'GIF export requires the optional MCP dependencies. Run npm ci --prefix mcp.'); }
    return sendFile(req,res,bundle,'text/javascript; charset=utf-8');
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/render/aac-encoder.mjs') {
    const bundle = path.join(SUITE_ROOT,'mcp','node_modules','@mediabunny','aac-encoder','dist','bundles','mediabunny-aac-encoder.mjs');
    let source;try{source=await fsp.readFile(bundle,'utf8');}catch{throw error(503,'MP4 audio conversion requires the optional MCP dependencies. Run npm ci --prefix mcp.');}
    source=source.replaceAll('from "mediabunny"','from "/api/render/mediabunny.mjs"');
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Content-Length':Buffer.byteLength(source)});return res.end(req.method==='HEAD'?undefined:source);
  }
  if (req.method === 'POST' && pathname === '/api/render') {
    checkWrite(req);
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw error(415, 'JSON is required.');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || (!!body.project === !!body.project_id)) throw error(400, 'Provide either project or project_id.');
    if(mediaMutating)throw error(409,'Media maintenance is in progress. Try the render again.');activeRenderRequests++;
    try{
    let input = body.project;
    if (body.project_id) {
      if (typeof body.project_id !== 'string' || !UUID.test(body.project_id)) throw error(400, 'Invalid project ID.');
      const saved = await readProject(body.project_id); if (!saved) throw error(404, 'Project not found.');
      input = saved.state;
    } else if (input && input.state) input = input.state;
    const mode = body.render_mode || 'realtime';
    if (!['realtime', 'offline'].includes(mode)) throw error(400, 'render_mode must be realtime or offline.');
    const format = body.output_format || 'auto';
    if (!['auto', 'mp4', 'webm'].includes(format)) throw error(400, 'output_format must be auto, mp4 or webm.');
    if (body.include_audio !== undefined && typeof body.include_audio !== 'boolean') throw error(400, 'include_audio must be a boolean.');
    if (mode === 'offline' && format === 'mp4') throw error(422, 'Offline rendering outputs WebM. Use realtime mode for MP4/H.264.');
    const { validateProject, renderProject, offlineUnavailable } = require('./render');
    const project = await validateProject(input, ASSETS);
    if(body.include_audio===false){project.audioClips=[];project.videoTracks=project.videoTracks.map(track=>({...track,muted:true}));}
    const unsupported = mode === 'offline' && await offlineUnavailable(project, ASSETS);
    if (unsupported) throw error(422, unsupported);
    if (res.destroyed) return;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnected);
    let output;
    try {
      output = await renderQueue.run(()=>renderProject(project, { port:PORT, suiteMode:SUITE_MODE, signal:controller.signal, mode, format, includeAudio:body.include_audio!==false }),{signal:controller.signal});
      if (controller.signal.aborted) return;
      res.setHeader('Content-Type', output.mime); res.setHeader('Content-Length', output.bytes);
      res.setHeader('X-Cliproom-Render-Mode', mode);
      res.setHeader('X-Cliproom-Audio-Included', body.include_audio===false?'false':'true');
      if (output.warning) res.setHeader('X-Cliproom-Render-Warning', 'slow-frames');
      res.setHeader('Content-Disposition', 'attachment; filename="cliproom.' + output.extension + '"');
      res.writeHead(200); await pipeline(fs.createReadStream(output.file), res);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (!cause.status) cause.status = 422;
      throw cause;
    } finally {
      res.removeListener('close', disconnected);
      if (output) await output.cleanup();
    }
    return;
    }finally{activeRenderRequests--;}
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && publicFiles[pathname]) {
    const [file, type] = publicFiles[pathname]; return sendFile(req, res, path.join(PUBLIC, file), type);
  }
  if(pathname==='/api/speech/model'&&req.method==='GET')return json(res,200,await speechModel.state());
  if(pathname==='/api/speech/model'&&req.method==='POST'){
    checkWrite(req);if(Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding'])throw error(400,'No request body is expected.');const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();},timer=setTimeout(()=>controller.abort(),10*60*1000);timer.unref();req.once('aborted',abort);res.once('close',abort);
    try{return json(res,200,await speechModel.install(controller.signal));}finally{clearTimeout(timer);req.off('aborted',abort);res.off('close',abort);}
  }
  if(pathname==='/api/speech/lease'&&req.method==='POST'){
    checkWrite(req);if(Number(req.headers['content-length']||0)>0||req.headers['transfer-encoding'])throw error(400,'No request body is expected.');if(speechLease)throw error(429,'A server-side transcription is already running. Try again shortly.');const lease=Symbol('speech');speechLease=lease;
    const release=()=>{clearTimeout(timer);if(speechLease===lease)speechLease=null;},timer=setTimeout(()=>res.end(),10*60*1000);timer.unref();res.once('close',release);res.once('finish',release);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.write('ready\n');return;
  }
  if((req.method==='GET'||req.method==='HEAD')&&pathname.startsWith('/api/speech/files/')){
    let name;try{name=decodeURIComponent(pathname.slice('/api/speech/files/'.length));}catch{throw error(400,'Invalid speech model path.');}
    const file=await speechModel.file(name),extension=path.extname(file).toLowerCase(),type=extension==='.json'?'application/json':extension==='.wasm'?'application/wasm':['.js','.mjs'].includes(extension)?'text/javascript; charset=utf-8':'application/octet-stream';return sendFile(req,res,file,type);
  }
  if (req.method === 'GET' && pathname === '/api/projects') {
    const files = await fsp.readdir(PROJECTS); const projects = [];
    for (const file of files.filter(x => /^[0-9a-f-]+\.json$/i.test(x))) {
      try { const p = JSON.parse(await fsp.readFile(path.join(PROJECTS, file), 'utf8')); projects.push({ id: p.id, name: p.state.name, updatedAt: p.updatedAt, revision: p.revision }); } catch { /* A bad project must not hide the others. */ }
    }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return json(res, 200, { projects });
  }
  let packageMatch=/^\/api\/projects\/([0-9a-f-]+)\/package$/i.exec(pathname);
  if(packageMatch&&UUID.test(packageMatch[1])&&req.method==='GET'){
    const revision=Number(url.searchParams.get('revision'));if(!Number.isSafeInteger(revision)||revision<1)throw error(400,'The current project revision is required.');if(packageBusy||packageDownloads)throw error(429,'Another project package is being prepared or downloaded.');packageBusy=true;
    let stage,ownsBusy=true,downloading=false;try{stage=await fsp.mkdtemp(path.join(PACKAGE_TEMP,'package-'));const staged=await withLock('asset-catalog',async()=>{const project=await readProject(packageMatch[1]);if(!project)throw error(404,'Project not found.');if(project.revision!==revision)throw error(409,'This project changed. Open the latest revision before packaging.');const plan=await ProjectPackage.planExport(project,ASSETS,mediaTypes),file=path.join(stage,'export.roomclip'),output=fs.createWriteStream(file,{flags:'wx',mode:0o600}),complete=finished(output);complete.catch(()=>{});try{await ProjectPackage.sendPackage(output,plan,ASSETS);await complete;}catch(cause){output.destroy();await complete.catch(()=>{});throw cause;}return {id:project.id,bytes:plan.bytes,file};});packageBusy=false;ownsBusy=false;packageDownloads++;downloading=true;res.setHeader('Content-Type','application/octet-stream');res.setHeader('Content-Disposition',`attachment; filename="cliproom-${staged.id}.roomclip"`);res.setHeader('Content-Length',staged.bytes);res.writeHead(200);await pipeline(fs.createReadStream(staged.file),res);return;}finally{if(ownsBusy)packageBusy=false;if(downloading)packageDownloads--;if(stage&&path.dirname(stage)===PACKAGE_TEMP&&path.basename(stage).startsWith('package-'))await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});}
  }
  if(req.method==='POST'&&pathname==='/api/packages/import'){
    checkWrite(req);if(!String(req.headers['content-type']||'').startsWith('application/octet-stream'))throw error(415,'A project package is required.');const id=url.searchParams.get('project_id');if(!UUID.test(id||''))throw error(400,'A new project ID is required.');const length=Number(req.headers['content-length']||0);if(length>ProjectPackage.MAX_BYTES)throw error(413,'Project packages are limited to 256 MiB.');if(packageBusy)throw error(429,'Another project package is being prepared.');packageBusy=true;let stage,ownsBusy=true;
    try{stage=await fsp.mkdtemp(path.join(PACKAGE_TEMP,'package-'));const upload=await ProjectPackage.stageUpload(req,stage),bundle=await ProjectPackage.prepareImport(upload.archive,upload.size,stage,mediaTypes);const result=await withLock('asset-catalog',()=>withLock(id,async()=>{if(await readProject(id))throw error(409,'A project with this ID already exists.');const created=[];try{for(const item of bundle.assets){const destination=path.join(ASSETS,item.id),metadata=destination+'.json';await fsp.copyFile(item.file,destination,fs.constants.COPYFILE_EXCL);let stat=await fsp.lstat(destination);created.push({file:destination,dev:stat.dev,ino:stat.ino});await fsp.writeFile(metadata,JSON.stringify(item.metadata),{flag:'wx',mode:0o600});stat=await fsp.lstat(metadata);created.push({file:metadata,dev:stat.dev,ino:stat.ino});}const project={id,revision:1,updatedAt:new Date().toISOString(),state:bundle.state};await atomicJson(path.join(PROJECTS,id+'.json'),project);return {project,source_project_id:bundle.source_project_id,source_revision:bundle.source_revision,assets:bundle.assets.map(item=>({source_id:item.old_id,asset_id:item.id}))};}catch(cause){for(const item of created.reverse())try{const stat=await fsp.lstat(item.file);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===item.dev&&stat.ino===item.ino)await fsp.unlink(item.file);}catch{}throw cause;}}));packageBusy=false;ownsBusy=false;return json(res,201,result);}
    finally{if(ownsBusy)packageBusy=false;if(stage&&path.dirname(stage)===PACKAGE_TEMP&&path.basename(stage).startsWith('package-'))await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});}
  }
  if(req.method==='GET'&&pathname==='/api/assets/audit'){
    const parse=(name,fallback)=>{const value=url.searchParams.get(name);if(value===null)return fallback;if(!/^\d+$/.test(value))throw error(400,'Invalid media audit page.');return Number(value);};
    if(mediaAuditRunning)throw error(429,'A media audit is already running. Try again shortly.');mediaAuditRunning=true;try{return json(res,200,{...await auditAssets({assetsDir:ASSETS,projectsDir:PROJECTS,mediaTypes,offset:parse('offset',0),limit:parse('limit',100),filter:url.searchParams.get('filter')||'all'}),trash_min_age_seconds:mediaTrash.minimumAgeMs/1000});}finally{mediaAuditRunning=false;}
  }
  if(req.method==='GET'&&pathname==='/api/assets/trash'){const parse=(name,fallback)=>{const value=url.searchParams.get(name);if(value===null)return fallback;if(!/^\d+$/.test(value))throw error(400,'Invalid trash page.');return Number(value);};return json(res,200,await mediaTrash.list({offset:parse('offset',0),limit:parse('limit',100)}));}
  let trashMatch=/^\/api\/assets\/([0-9a-f-]+)\/trash$/i.exec(pathname);
  if(trashMatch&&UUID.test(trashMatch[1])&&req.method==='POST'){checkWrite(req);if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error(415,'JSON is required.');const body=await readJson(req);if(body?.confirm_unsaved!==true)throw error(400,'Confirm that open or unsaved projects may still use this media.');return json(res,200,await mutateMedia(async()=>{const result=await mediaTrash.move(trashMatch[1]);try{await proxyCache.remove(trashMatch[1]);}catch{return {...result,proxy_warning:'The source was moved to trash, but its optimized preview could not be removed.'};}return result;}));}
  trashMatch=/^\/api\/assets\/trash\/([0-9a-f-]+)(\/restore)?$/i.exec(pathname);
  if(trashMatch&&UUID.test(trashMatch[1])&&req.method==='POST'&&trashMatch[2]){checkWrite(req);return json(res,200,await mutateMedia(()=>mediaTrash.restore(trashMatch[1])));}
  if(trashMatch&&UUID.test(trashMatch[1])&&req.method==='DELETE'&&!trashMatch[2]){checkWrite(req);if(!String(req.headers['content-type']||'').startsWith('application/json'))throw error(415,'JSON is required.');const body=await readJson(req);if(body?.confirm!==true)throw error(400,'Confirm permanent deletion.');return json(res,200,await mutateMedia(()=>mediaTrash.purge(trashMatch[1])));}
  const proxyMatch=/^\/api\/proxies\/([0-9a-f-]+)(?:\/(status))?$/.exec(pathname);
  if(proxyMatch&&UUID.test(proxyMatch[1])){
    const id=proxyMatch[1];
    if(proxyMatch[2]&&req.method==='GET')return json(res,200,await proxyCache.status(id));
    if(!proxyMatch[2]&&(req.method==='GET'||req.method==='HEAD')){const state=await proxyCache.status(id);if(!state.exists)throw error(404,'Optimized preview not found.');const version=url.searchParams.get('v');if(version!==null&&version!==state.version)throw error(409,'The optimized preview changed. Refresh its status.');return sendFile(req,res,proxyCache.file(id),'video/webm',true);}
    if(!proxyMatch[2]&&req.method==='POST'){checkWrite(req);if(String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase()!=='video/webm')throw error(415,'A WebM optimized preview is required.');return json(res,200,await proxyCache.upload(id,req));}
    if(!proxyMatch[2]&&req.method==='DELETE'){checkWrite(req);const removed=await withLock('asset-catalog',()=>proxyCache.remove(id));return json(res,200,{asset_id:id,removed});}
  }
  const uploadMatch=/^\/api\/assets\/([0-9a-f-]+)\/idempotent$/.exec(pathname);
  if(uploadMatch&&UUID.test(uploadMatch[1])&&req.method==='POST'){checkWrite(req);const type=String(req.headers['x-file-type']||'').toLowerCase().split(';')[0];if(!mediaTypes.has(type))throw error(415,'This media type is not supported.');let name;try{name=decodeURIComponent(String(req.headers['x-file-name']||'Media'));}catch{throw error(400,'Invalid file name.');}name=name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180)||'Media';return json(res,200,await uploadWithId(req,uploadMatch[1],name,type));}
  if (req.method === 'POST' && pathname === '/api/assets') {
    checkWrite(req);
    const type = String(req.headers['x-file-type'] || '').toLowerCase().split(';')[0];
    if (!mediaTypes.has(type)) throw error(415, 'This media type is not supported.');
    if (Number(req.headers['content-length'] || 0) > MAX_MEDIA) throw error(413, 'Files must be 2 GB or smaller.');
    let name; try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'Media')); } catch { throw error(400, 'Invalid file name.'); }
    name = name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || 'Media';
    const id = crypto.randomUUID(); const tmp = path.join(ASSETS, `${id}.tmp`); const data = path.join(ASSETS, id);
    let size = 0;
    const limiter = new Transform({ transform(chunk, enc, callback) { size += chunk.length; callback(size > MAX_MEDIA ? error(413, 'Files must be 2 GB or smaller.') : null, chunk); } });
    try {
      await pipeline(req, limiter, fs.createWriteStream(tmp, { flags: 'wx', mode: 0o600 }));
      if (!size) throw error(400, 'The file is empty.');
      await fsp.rename(tmp, data); await atomicJson(path.join(ASSETS, `${id}.json`), { id, name, type, size });
    } catch (e) { await fsp.rm(tmp, { force: true }).catch(() => {}); await fsp.rm(data, { force: true }).catch(() => {}); throw e; }
    return json(res, 201, { id, name, type, size });
  }
  let match = /^\/api\/assets\/([0-9a-f-]+)$/.exec(pathname);
  if (match && UUID.test(match[1]) && (req.method === 'GET' || req.method === 'HEAD')) {
    const meta = JSON.parse(await fsp.readFile(path.join(ASSETS, `${match[1]}.json`), 'utf8'));
    if (!mediaTypes.has(meta.type)) throw error(404, 'Media not found.');
    return sendFile(req, res, path.join(ASSETS, match[1]), meta.type, true);
  }
  match = /^\/api\/assets\/([0-9a-f-]+)\/metadata$/.exec(pathname);
  if (match && UUID.test(match[1]) && req.method === 'GET') {
    const meta = JSON.parse(await fsp.readFile(path.join(ASSETS, match[1] + '.json'), 'utf8'));
    if (!mediaTypes.has(meta.type)) throw error(404, 'Media not found.');
    return json(res, 200, meta);
  }
  match = /^\/api\/projects\/([0-9a-f-]+)$/.exec(pathname);
  if (match && UUID.test(match[1])) {
    const id = match[1];
    if (req.method === 'GET') { const p = await readProject(id); if (!p) throw error(404, 'Project not found.'); return json(res, 200, p); }
    if (req.method === 'DELETE') {
      checkWrite(req);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw error(415, 'JSON is required.');
      const body = await readJson(req);
      if (!body || !Number.isInteger(body.baseRevision) || body.baseRevision < 1) throw error(400, 'The current project revision is required.');
      return withLock(id, async () => {
        const project = await readProject(id);
        if (!project) throw error(404, 'Project not found.');
        if (body.baseRevision !== project.revision) throw error(409, 'This project changed on another device. Refresh the list before deleting it.');
        await fsp.unlink(path.join(PROJECTS, `${id}.json`));
        return json(res, 200, { id, deleted:true });
      });
    }
    if (req.method === 'PUT') {
      checkWrite(req);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw error(415, 'JSON is required.');
      const body = await readJson(req);
      if (!body || !Number.isInteger(body.baseRevision) || !body.state || typeof body.state !== 'object' || Array.isArray(body.state) || typeof body.state.name !== 'string' || body.state.name.length > 160 || !Array.isArray(body.state.assets) || body.state.assets.length > 1000) throw error(400, 'Invalid project.');
      if(Array.isArray(body.state.clips))for(const clip of body.state.clips){
        if(clip?.colorGrade!==undefined)try{colorGrade.readTarget(clip,'clip');}catch(cause){throw error(400,cause.message);}
        if(clip?.gradeMask!==undefined)try{clip.gradeMask=ClipRegionGrade.validate(clip.gradeMask);}catch(cause){throw error(400,cause.message);}
        if(Array.isArray(clip?.keyframes))for(const frame of clip.keyframes){for(const key of [...colorGrade.advanced,...Object.keys(colorGrade.Look.effectSpecs)])if(frame?.[key]!==undefined){const value=frame[key],[min,max]=colorGrade.specs[key]||colorGrade.Look.effectSpecs[key];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw error(400,'Invalid keyframe '+key+'.');}if(frame?.creativeLook!==undefined){if(body.state.version!==5)throw error(400,'Creative look keyframes require a version 5 picture project.');try{frame.creativeLook=ClipLookFrames.validate(frame.creativeLook);}catch(cause){throw error(400,cause.message);}}}
      }
      if(Array.isArray(body.state.audioClips))for(const clip of body.state.audioClips)if(Array.isArray(clip?.keyframes)&&clip.keyframes.some(frame=>frame?.creativeLook!==undefined||[...colorGrade.advanced,...Object.keys(colorGrade.Look.effectSpecs)].some(key=>frame?.[key]!==undefined)))throw error(400,'Color keyframes apply only to picture clips.');
      if(Array.isArray(body.state.audioClips)&&body.state.audioClips.some(clip=>clip?.gradeMask!==undefined))throw error(400,'Color masks apply only to picture clips.');
      try{ClipRegionGrade.validateProject(body.state.clips);}catch(cause){throw error(400,cause.message);}
      if(Array.isArray(body.state.clips)&&body.state.clips.some(clip=>clip?.soundroom!==undefined))throw error(400,'SoundRoom source settings apply only to audio clips.');
      if(Array.isArray(body.state.audioClips))for(const clip of body.state.audioClips)if(clip?.soundroom!==undefined){try{clip.soundroom=SoundSettings.link(clip.soundroom);}catch(cause){throw error(400,cause.message);}const linked=body.state.assets.find(asset=>asset?.id===clip.soundroom.sourceAssetId),rendered=body.state.assets.find(asset=>asset?.id===clip.assetId);if(!linked||linked.kind!=='audio'||!rendered||rendered.kind!=='audio'||linked.id===rendered.id)throw error(400,'The SoundRoom source and processed audio must be separate project audio files.');}
      if([1,2,3,4].includes(body.state.version)&&Timeline.requiresV5(body.state)){try{body.state=Timeline.migrate(body.state,()=>crypto.randomUUID());}catch(cause){throw error(400,cause.message);}}
      const ids = [...new Set(body.state.assets.map(a => a && a.id))];
      if (ids.some(x => typeof x !== 'string' || !UUID.test(x))) throw error(400, 'Invalid project media.');
      return withLock('asset-catalog', async()=>{
      for (const asset of ids) { try { await fsp.access(path.join(ASSETS, `${asset}.json`)); await fsp.access(path.join(ASSETS, asset)); } catch { throw error(400, 'A project media file is missing.'); } }
      for(const clip of Array.isArray(body.state.audioClips)?body.state.audioClips:[])if(clip?.soundroom){let meta;try{meta=JSON.parse(await fsp.readFile(path.join(ASSETS,clip.soundroom.sourceAssetId+'.json'),'utf8'));}catch{throw error(400,'The SoundRoom source metadata is invalid.');}if(!String(meta.type||'').startsWith('audio/'))throw error(400,'The SoundRoom source must be audio.');}
      return withLock(id, async () => {
        const old = await readProject(id); const revision = old ? old.revision : 0;
        if (body.baseRevision !== revision) throw error(409, 'This project was changed on another device. Open the latest version or save your work as a copy.');
        const project = { id, revision: revision + 1, updatedAt: new Date().toISOString(), state: body.state };
        await atomicJson(path.join(PROJECTS, `${id}.json`), project); return json(res, 200, project);
      });});
    }
  }
  throw error(404, 'Not found.');
}

async function start() {
  await Promise.all([fsp.mkdir(PROJECTS, { recursive: true, mode: 0o700 }), fsp.mkdir(ASSETS, { recursive: true, mode: 0o700 }), fsp.mkdir(MEDIA_TRASH,{recursive:true,mode:0o700}),fsp.mkdir(PROXIES,{recursive:true,mode:0o700}),fsp.mkdir(PACKAGE_TEMP,{recursive:true,mode:0o700})]);for(const directory of [PACKAGE_TEMP,PROXIES]){const stat=await fsp.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('Package staging and optimized previews must use local directories.');}
  if (sharedWorkspace) await sharedWorkspace.init();
  const server = http.createServer((req, res) => route(req, res).catch(e => {
    if (e.code === 'ENOENT') return json(res, 404, { error: 'Not found.' });
    if (!e.status) console.error('Request failed:', e.message);
    return json(res, e.status || 500, { error: e.status ? e.message : 'The server could not complete the request.' });
  }));
  server.listen(PORT, '127.0.0.1', () => console.log(`${SUITE_MODE ? 'RoomSuite' : 'Cliproom'} is running at http://127.0.0.1:${PORT}`));
  return server;
}
if (require.main === module) start().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { start };
