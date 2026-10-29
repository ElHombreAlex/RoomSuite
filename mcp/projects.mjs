import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { inputPath, outputPath } from './files.mjs';
import { serverUrl } from './rooms.mjs';

async function request(path, options = {}) {
  const response = await fetch(serverUrl() + path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Cliproom request failed (' + response.status + ').');
  return body;
}

export async function listProjects(args, signal) {
  return request('/api/projects', { signal });
}

export async function getProject(args, signal) {
  const project = await request('/api/projects/' + encodeURIComponent(args.project_id), { signal });
  if (!args.output) return { project };
  const out = await outputPath(args.output, ['.json']);
  const data = JSON.stringify(project, null, 2) + '\n';
  try { await fs.writeFile(out, data, { flag:'wx', mode:0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Output already exists: ' + args.output); throw error; }
  return { path:out, bytes:Buffer.byteLength(data), mime_type:'application/json', project_id:project.id, revision:project.revision };
}

export async function saveProject(args, signal) {
  if (args.project_id && args.base_revision === undefined) throw new Error('base_revision is required when project_id is supplied.');
  if (!args.project_id && args.base_revision !== undefined && args.base_revision !== 0) throw new Error('A new project must have base_revision 0.');
  const input = await inputPath(args.project_path), stat = await fs.stat(input);
  if (stat.size > 2 * 1024 * 1024) throw new Error('Project JSON is too large.');
  let data;
  try { data = JSON.parse(await fs.readFile(input, 'utf8')); }
  catch { throw new Error('Project file is not valid JSON.'); }
  const state = data?.state || data, id = args.project_id || crypto.randomUUID(), origin = serverUrl();
  const saved = await request('/api/projects/' + encodeURIComponent(id), {
    method:'PUT', signal,
    headers:{ 'Content-Type':'application/json', 'Origin':origin, 'X-Cliproom-Request':'1' },
    body:JSON.stringify({ baseRevision:args.base_revision ?? 0, state })
  });
  return { project_id:saved.id, revision:saved.revision, name:saved.state.name, updated_at:saved.updatedAt };
}
