'use strict';

// Cliproom has no runtime dependencies. It deliberately listens on loopback only:
// put Tailscale Serve in front of it to authorize devices and provide HTTPS.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const PORT = Number(process.env.CLIPROOM_PORT || 8090);
const DATA = path.resolve(process.env.CLIPROOM_DATA || path.join(__dirname, 'data'));
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(PORT === 80 ? ['localhost', '127.0.0.1'] : []), ...(process.env.CLIPROOM_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)]);
const PROJECTS = path.join(DATA, 'projects');
const ASSETS = path.join(DATA, 'assets');
const PUBLIC = path.join(__dirname, 'public');
const SUITE_MODE = process.env.ROOMSUITE_MODE === '1';
const SUITE_ROOT = path.resolve(__dirname, '..');
const MAX_MEDIA = 2 * 1024 * 1024 * 1024;
const MAX_PROJECT = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mediaTypes = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v', 'video/mpeg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm', 'audio/aac', 'audio/flac', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const publicFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/timeline.js': ['timeline.js', 'text/javascript; charset=utf-8'], '/offline-render.js': ['offline-render.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
const suiteRoots = { '/suite/': 'suite', '/soundroom/': 'SoundRoom', '/captureroom/': 'CaptureRoom', '/vectorroom/': 'VectorRoom', '/pixelroom/': 'PixelRoom/dist' };
const suiteTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.bin': 'application/octet-stream', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const locks = new Map();

function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
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

async function route(req, res) {
  headers(res);
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) throw error(403, 'This host is not allowed. Configure CLIPROOM_ALLOWED_HOSTS for your Tailscale URL.');
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (SUITE_MODE && (req.method === 'GET' || req.method === 'HEAD')) {
    if (['/cliproom', '/soundroom', '/captureroom', '/vectorroom', '/pixelroom'].includes(pathname)) {
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
  if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true });
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/render/mediabunny.mjs') {
    const bundle = path.join(SUITE_ROOT, 'mcp', 'node_modules', 'mediabunny', 'dist', 'bundles', 'mediabunny.min.mjs');
    try { await fsp.access(bundle); } catch { throw error(503, 'Offline rendering requires the optional MCP dependencies. Run npm ci --prefix mcp.'); }
    return sendFile(req, res, bundle, 'text/javascript; charset=utf-8');
  }
  if (req.method === 'POST' && pathname === '/api/render') {
    checkWrite(req);
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw error(415, 'JSON is required.');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || (!!body.project === !!body.project_id)) throw error(400, 'Provide either project or project_id.');
    let input = body.project;
    if (body.project_id) {
      if (typeof body.project_id !== 'string' || !UUID.test(body.project_id)) throw error(400, 'Invalid project ID.');
      const saved = await readProject(body.project_id); if (!saved) throw error(404, 'Project not found.');
      input = saved.state;
    } else if (input && input.state) input = input.state;
    const mode = body.render_mode || 'realtime';
    if (!['realtime', 'offline'].includes(mode)) throw error(400, 'render_mode must be realtime or offline.');
    const { validateProject, renderProject, offlineUnavailable } = require('./render');
    const project = await validateProject(input, ASSETS);
    const unsupported = mode === 'offline' && await offlineUnavailable(project, ASSETS);
    if (unsupported) throw error(422, unsupported);
    if (res.destroyed) return;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnected);
    let output;
    try {
      output = await renderProject(project, { port:PORT, suiteMode:SUITE_MODE, signal:controller.signal, mode });
      if (controller.signal.aborted) return;
      res.setHeader('Content-Type', output.mime); res.setHeader('Content-Length', output.bytes);
      res.setHeader('X-Cliproom-Render-Mode', mode);
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
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && publicFiles[pathname]) {
    const [file, type] = publicFiles[pathname]; return sendFile(req, res, path.join(PUBLIC, file), type);
  }
  if (req.method === 'GET' && pathname === '/api/projects') {
    const files = await fsp.readdir(PROJECTS); const projects = [];
    for (const file of files.filter(x => /^[0-9a-f-]+\.json$/i.test(x))) {
      try { const p = JSON.parse(await fsp.readFile(path.join(PROJECTS, file), 'utf8')); projects.push({ id: p.id, name: p.state.name, updatedAt: p.updatedAt, revision: p.revision }); } catch { /* A bad project must not hide the others. */ }
    }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return json(res, 200, { projects });
  }
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
    if (req.method === 'PUT') {
      checkWrite(req);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw error(415, 'JSON is required.');
      const body = await readJson(req);
      if (!body || !Number.isInteger(body.baseRevision) || !body.state || typeof body.state !== 'object' || Array.isArray(body.state) || typeof body.state.name !== 'string' || body.state.name.length > 160 || !Array.isArray(body.state.assets) || body.state.assets.length > 1000) throw error(400, 'Invalid project.');
      const ids = [...new Set(body.state.assets.map(a => a && a.id))];
      if (ids.some(x => typeof x !== 'string' || !UUID.test(x))) throw error(400, 'Invalid project media.');
      for (const asset of ids) { try { await fsp.access(path.join(ASSETS, `${asset}.json`)); await fsp.access(path.join(ASSETS, asset)); } catch { throw error(400, 'A project media file is missing.'); } }
      return withLock(id, async () => {
        const old = await readProject(id); const revision = old ? old.revision : 0;
        if (body.baseRevision !== revision) throw error(409, 'This project was changed on another device. Open the latest version or save your work as a copy.');
        const project = { id, revision: revision + 1, updatedAt: new Date().toISOString(), state: body.state };
        await atomicJson(path.join(PROJECTS, `${id}.json`), project); return json(res, 200, project);
      });
    }
  }
  throw error(404, 'Not found.');
}

async function start() {
  await Promise.all([fsp.mkdir(PROJECTS, { recursive: true, mode: 0o700 }), fsp.mkdir(ASSETS, { recursive: true, mode: 0o700 })]);
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
