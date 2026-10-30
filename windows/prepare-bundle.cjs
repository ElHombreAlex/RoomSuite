'use strict';
// Make a distributable app tree from a clean checkout, excluding the suite's
// usual runtime-data and developer-workspace directories.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dest = path.resolve(process.argv[2] || '');
if (!process.argv[2] || fs.existsSync(dest)) throw new Error('Provide a new staging directory.');
const include = ['server.js','package.json','README.md','CaptureRoom','cliproom','FilesRoom','mcp','NotesRoom','PaintRoom','PixelRoom','ProductivitySuite','SoundRoom','suite','VectorRoom','workspace'];
for (const entry of include) { const source=path.join(root,entry),relative=path.relative(source,dest);if (fs.statSync(source).isDirectory() && (relative==='' || (!path.isAbsolute(relative) && relative!=='..' && !relative.startsWith('..'+path.sep)))) throw new Error('Staging must be outside the application source folders.'); }
const skip = new Set(['.git','.qa','.preview-data','node_modules']);
function permitted(source) {
  const rel = path.relative(root, source).replaceAll('\\','/');
  if (fs.lstatSync(source).isSymbolicLink()) return false;
  if (rel.split('/').some(part => skip.has(part))) return false;
  if (path.basename(source).startsWith('.')) return false;
  if (rel === 'cliproom/data' || rel.startsWith('cliproom/data/') || rel === 'mcp/workspace' || rel.startsWith('mcp/workspace/')) return false;
  return true;
}
fs.mkdirSync(dest, { recursive:true });
for (const entry of include) fs.cpSync(path.join(root, entry), path.join(dest, entry), { recursive:true, filter:permitted, errorOnExist:true, force:false });
console.log('Prepared RoomSuite application files.');
