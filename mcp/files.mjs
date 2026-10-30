import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const defaultWorkspace = fileURLToPath(new URL('./workspace/', import.meta.url));
const configuredWorkspace = path.resolve(process.env.ROOMSUITE_MCP_WORKSPACE || defaultWorkspace);

export async function workspace() {
  await fs.mkdir(configuredWorkspace, { recursive: true });
  return fs.realpath(configuredWorkspace);
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function candidatePath(root, requested) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0')) throw new Error('Provide a valid file path.');
  const candidate = path.resolve(root, requested);
  if (!inside(root, candidate) || candidate === root) throw new Error('File paths must be inside the configured MCP workspace.');
  return candidate;
}
export async function inputPath(requested) {
  const root = await workspace(), candidate = candidatePath(root, requested);
  let real;
  try { real = await fs.realpath(candidate); } catch { throw new Error('Input file does not exist: ' + requested); }
  if (!inside(root, real)) throw new Error('Input resolves outside the configured MCP workspace.');
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error('Input must be a regular file: ' + requested);
  return real;
}
export async function listFiles({ directory = '.', offset = 0, limit = 100 }) {
  const root = await workspace();
  if (!directory || directory.includes('\0')) throw new Error('Provide a valid directory path.');
  const candidate = path.resolve(root, directory);
  if (!inside(root, candidate)) throw new Error('Directory must be inside the configured MCP workspace.');
  let real;
  try { real = await fs.realpath(candidate); } catch { throw new Error('Directory does not exist: ' + directory); }
  if (!inside(root, real)) throw new Error('Directory resolves outside the configured MCP workspace.');
  if (!(await fs.stat(real)).isDirectory()) throw new Error('Path is not a directory: ' + directory);
  const names = (await fs.readdir(real)).sort((a, b) => a.localeCompare(b));
  const entries = await Promise.all(names.slice(offset, offset + limit).map(async name => {
    const stat = await fs.lstat(path.join(real, name));
    return { name, type:stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
      bytes:stat.isFile() ? stat.size : null, modified_at:stat.mtime.toISOString() };
  }));
  return { workspace:root, directory:real, entries, total:names.length, offset, next_offset:offset + entries.length < names.length ? offset + entries.length : null };
}
export async function outputPath(requested, extensions) {
  const root = await workspace(), candidate = candidatePath(root, requested), ext = path.extname(candidate).toLowerCase();
  if (!extensions.includes(ext)) throw new Error('Output must use one of: ' + extensions.join(', '));
  let parent;
  try { parent = await fs.realpath(path.dirname(candidate)); } catch { throw new Error('The output directory must already exist inside the MCP workspace.'); }
  if (!inside(root, parent)) throw new Error('Output directory resolves outside the configured MCP workspace.');
  const output = path.join(parent, path.basename(candidate));
  try { await fs.lstat(output); throw new Error('Output already exists: ' + requested); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return output;
}
export async function saveDownload(download, output, type) {
  const failure = await download.failure();
  if (failure) throw new Error('Download failed: ' + failure);
  const temporary = await download.path();
  if (!temporary) throw new Error('The browser did not create a downloadable file.');
  try { await fs.copyFile(temporary, output, constants.COPYFILE_EXCL); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Output already exists: ' + output); throw error; }
  const stat = await fs.stat(output);
  if (!stat.size) throw new Error('The editor produced an empty file: ' + output);
  return { path: output, bytes: stat.size, mime_type: type };
}
export async function saveResponse(response, output, type, signal, { allowEmpty = false } = {}) {
  if (!response.body) throw new Error('The server returned no response body.');
  let created = false, complete = false;
  const destination = createWriteStream(output, { flags:'wx', mode:0o600 });
  destination.once('open', () => { created = true; });
  try {
    await pipeline(Readable.fromWeb(response.body), destination, { signal });
    const stat = await fs.stat(output);
    if (!stat.size && !allowEmpty) throw new Error('The server returned an empty file.');
    complete = true;
    return { path:output, bytes:stat.size, mime_type:type };
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output already exists: ' + output);
    throw error;
  } finally {
    if (!complete && created) await fs.rm(output, { force:true }).catch(() => {});
  }
}
