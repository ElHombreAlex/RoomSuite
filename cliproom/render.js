'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const timeline = require('./public/timeline.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const propertyRanges = { scale:[.1,2], x:[-100,200], y:[-100,200], opacity:[0,1], rotation:[-36000,36000], brightness:[0,200], contrast:[0,200], saturation:[0,200], volume:[0,1] };
function invalid(message) { return Object.assign(new Error(message), { status:400 }); }
function finite(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }

async function validateProject(input, assetsDirectory) {
  let project;
  try { project = timeline.migrate(input, () => crypto.randomUUID()); }
  catch (error) { throw invalid(error.message); }
  if (typeof project.name !== 'string' || project.name.length > 160 || !['16:9','9:16','1:1'].includes(project.aspect) || !['720p','1080p'].includes(project.quality)) throw invalid('Invalid project settings.');
  if (project.background !== undefined && (typeof project.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(project.background))) throw invalid('Invalid canvas background color.');
  if (project.assets.length > 1000 || project.clips.length + project.audioClips.length > 10000) throw invalid('Project contains too many media items.');
  const assets = new Map();
  for (const asset of project.assets) {
    if (!asset || !UUID.test(asset.id) || assets.has(asset.id) || !['image','audio','video'].includes(asset.kind) || typeof asset.name !== 'string') throw invalid('Invalid project asset.');
    let meta;
    try { meta = JSON.parse(await fs.readFile(path.join(assetsDirectory, asset.id + '.json'), 'utf8')); await fs.access(path.join(assetsDirectory, asset.id)); }
    catch { throw invalid('A project media file is missing.'); }
    if (!String(meta.type || '').startsWith(asset.kind + '/')) throw invalid('Project media type does not match the stored asset.');
    asset.type = meta.type;
    if (asset.kind !== 'image' && !finite(asset.duration, .001, 86400)) throw invalid('A project asset has an invalid duration.');
    assets.set(asset.id, asset);
  }
  const videoTracks = new Set(project.videoTracks.map(track => track?.id)), audioTracks = new Set(project.audioTracks.map(track => track?.id));
  for (const [items, tracks, kind] of [[project.clips,videoTracks,'video'],[project.audioClips,audioTracks,'audio']]) {
    for (const clip of items) {
      const asset = assets.get(clip?.assetId);
      if (!asset || !tracks.has(clip.trackId) || (kind === 'audio' ? asset.kind !== 'audio' : asset.kind === 'audio')) throw invalid('A clip references invalid media or a missing track.');
      if (!finite(clip.start,0,86400) || !finite(clip.in,0,86400) || !finite(clip.out,0,86400) || clip.out <= clip.in || !finite(clip.rate ?? 1,.5,4)) throw invalid('A clip has invalid timing.');
      if (asset.kind !== 'image' && clip.out > asset.duration + .05) throw invalid('A clip extends past its source media.');
      if (clip.keyframes !== undefined) {
        if (!Array.isArray(clip.keyframes) || clip.keyframes.length > 10000) throw invalid('Invalid keyframes.');
        const times = new Set();
        for (const frame of clip.keyframes) {
          if (!frame || !finite(frame.time,0,86400) || times.has(frame.time)) throw invalid('Keyframe times must be unique non-negative source seconds.');
          times.add(frame.time);
          for (const [key, range] of Object.entries(propertyRanges)) if (frame[key] !== undefined && !finite(frame[key],range[0],range[1])) throw invalid('Invalid keyframe ' + key + '.');
        }
      }
      for (const [key, range] of Object.entries(propertyRanges)) if (clip[key] !== undefined && !finite(clip[key],range[0],range[1])) throw invalid('Invalid clip ' + key + '.');
    }
  }
  for (const title of project.titles) if (!title || typeof title.text !== 'string' || !finite(title.start,0,86400) || !finite(title.end,0,86400) || title.end <= title.start) throw invalid('Invalid title.');
  const duration = timeline.duration(project);
  if (!finite(duration,.001,86400)) throw invalid('The timeline must contain media and be shorter than 24 hours.');
  return project;
}

function loadPlaywright() {
  try { return require(require.resolve('playwright', { paths:[path.resolve(__dirname, '..', 'mcp')] })); }
  catch { throw Object.assign(new Error('Headless rendering requires the optional MCP dependencies. Run npm ci --prefix mcp and install Playwright Chromium.'), { status:503 }); }
}
async function stillImage(file) {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(32), size = (await handle.read(header, 0, header.length, 0)).bytesRead;
    if (size >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return true;
    if (size >= 12 && header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      let offset = 8;
      for (let i = 0; i < 4096; i++) {
        const chunk = Buffer.alloc(8), read = await handle.read(chunk, 0, 8, offset);
        if (read.bytesRead !== 8) return false;
        const length = chunk.readUInt32BE(0), type = chunk.toString('ascii', 4, 8);
        if (type === 'acTL' || type === 'fcTL') return false;
        if (type === 'IDAT') return true;
        if (type === 'IEND') return false;
        offset += 12 + length;
      }
      return false;
    }
    if (size >= 21 && header.toString('ascii',0,4) === 'RIFF' && header.toString('ascii',8,12) === 'WEBP') {
      const type = header.toString('ascii',12,16);
      return type === 'VP8 ' || type === 'VP8L' || (type === 'VP8X' && !(header[20] & 2));
    }
    return false;
  } finally { await handle.close(); }
}
async function offlineUnavailable(project, assetsDirectory) {
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  if (timeline.duration(project) > 600) return 'Offline rendering currently supports projects up to 10 minutes.';
  if (project.audioClips.some(clip => Math.abs(timeline.rate(clip) - 1) > 1e-9)) return 'Offline rendering currently requires audio clips at normal speed. Use realtime mode to preserve retimed audio.';
  if (project.clips.some(clip => assets.get(clip.assetId)?.kind === 'video' && Math.abs(timeline.rate(clip) - 1) > 1e-9)) return 'Offline rendering currently requires video clips at normal speed. Use realtime mode for retimed video.';
  for (const id of new Set(project.clips.filter(clip => assets.get(clip.assetId)?.kind === 'image').map(clip => clip.assetId))) {
    if (!await stillImage(path.join(assetsDirectory, id))) return 'Offline rendering supports still JPEG, PNG and WebP images, but not animated images or AVIF. Use realtime mode for this project.';
  }
  return null;
}
async function renderProject(project, { port, suiteMode, signal, mode = 'realtime' }) {
  const { chromium } = loadPlaywright();
  const options = { headless:true, args:['--autoplay-policy=no-user-gesture-required'] };
  if (process.env.ROOMSUITE_BROWSER_PATH) options.executablePath = process.env.ROOMSUITE_BROWSER_PATH;
  const value = Number(process.env.CLIPROOM_RENDER_TIMEOUT_MS || 600000);
  const timeout = Number.isFinite(value) && value > 0 ? value : 600000;
  let browser, dir, abort, deadline, timedOut = false;
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const cleanup = async () => {
    if (!dir) return;
    const relative = path.relative(temporaryRoot, dir);
    if (relative.startsWith('roomsuite-render-') && !relative.includes(path.sep)) await fs.rm(dir, { recursive:true, force:true });
    dir = null;
  };
  try {
    if (signal?.aborted) throw new Error('Render cancelled.');
    browser = await chromium.launch(options);
    if (signal?.aborted) throw new Error('Render cancelled.');
    abort = () => { void browser.close().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once:true });
    deadline = setTimeout(() => { timedOut = true; void browser.close().catch(() => {}); }, timeout);
    const context = await browser.newContext({ acceptDownloads:true, viewport:{width:1440,height:1000} });
    const page = await context.newPage();
    const origin = 'http://127.0.0.1:' + port;
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:')) await route.continue(); else await route.abort();
    });
    const response = await page.goto(origin + (suiteMode ? '/cliproom/' : '/'), { waitUntil:'load', timeout:30000 });
    if (!response?.ok()) throw new Error('Could not open the Cliproom renderer.');
    const downloadPromise = page.waitForEvent('download', { timeout });
    downloadPromise.catch(() => {});
    let extension;
    if (mode === 'offline') {
      extension = 'webm';
      await page.evaluate(async state => {
        setState(state, uid(), 0);
        const { renderOffline } = await import('/offline-render.js');
        await renderOffline({ project:state, timeline:T, canvas,
          prepareImages:async () => Promise.all(state.clips.filter(clip => asset(clip.assetId)?.kind === 'image').map(async clip => { const image = imageFor(asset(clip.assetId)); await image.decode(); })),
          renderAt:(time, frames) => { currentTime = time; renderFrame(frames); } });
      }, project);
    } else {
      const format = await page.evaluate(() => formatSupport());
      if (!format) throw new Error('Video export is unavailable in the rendering browser.');
      extension = format.extension;
      const started = await page.evaluate(async state => {
        setState(state, uid(), 0);
        await exportVideo();
        return { active:recording || exportPreparing, message:document.querySelector('#toast').textContent || document.querySelector('#exportStatus').textContent };
      }, project);
      if (!started.active) throw new Error(started.message || 'Could not start the Cliproom render.');
    }
    const download = await downloadPromise;
    const failure = await download.failure(); if (failure) throw new Error('Render download failed: ' + failure);
    dir = await fs.mkdtemp(path.join(temporaryRoot, 'roomsuite-render-'));
    const file = path.join(dir, 'cliproom.' + extension);
    await download.saveAs(file);
    const stat = await fs.stat(file); if (!stat.size) throw new Error('The renderer produced an empty video.');
    return { file, bytes:stat.size, extension, mime:extension === 'mp4' ? 'video/mp4' : 'video/webm', cleanup };
  } catch (error) {
    await cleanup();
    if (signal?.aborted) throw Object.assign(new Error('Render cancelled.'), { status:499 });
    if (timedOut) throw Object.assign(new Error('The render timed out.'), { status:504 });
    if (!browser && /executable|browser.*install/i.test(error.message)) throw Object.assign(new Error('Chromium is unavailable. Install Playwright Chromium or set ROOMSUITE_BROWSER_PATH.'), { status:503 });
    throw error;
  } finally {
    if (deadline) clearTimeout(deadline);
    if (abort) signal?.removeEventListener('abort', abort);
    if (browser) await browser.close().catch(() => {});
  }
}
module.exports = { validateProject, renderProject, offlineUnavailable };
