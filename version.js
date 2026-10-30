'use strict';
// Capture the code actually present at process startup, and compare it with
// current files and files served over HTTP. Data and optional dependencies are
// deliberately excluded; the lockfile identifies the intended dependencies.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=__dirname;
const frontendRoots={suite:['/suite/'],SoundRoom:['/soundroom/'],CaptureRoom:['/captureroom/'],VectorRoom:['/vectorroom/'],NotesRoom:['/notesroom/'],PaintRoom:['/paintroom/'],FilesRoom:['/files/'],ProductivitySuite:['/docsuite/','/gridsuite/','/decksuite/','/plansuite/'],'PixelRoom/dist':['/pixelroom/'],'cliproom/public':['/']};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function walk(directory,base=''){
  if(!fs.existsSync(directory))return [];
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    if(entry.name.startsWith('.')||['node_modules','vendor-src','tests','data'].includes(entry.name))return [];
    const relative=base?base+'/'+entry.name:entry.name,full=path.join(directory,entry.name);
    if(entry.isDirectory())return walk(full,relative);
    return entry.isFile()&&/\.(?:html|css|js|mjs)$/i.test(entry.name)?[relative]:[];
  });
}
function collect(files){const entries={},cached=new Map();for(const [name,file] of Object.entries(files).sort(([a],[b])=>a.localeCompare(b,'en'))){if(!cached.has(file))cached.set(file,fs.existsSync(path.join(root,file))?hash(fs.readFileSync(path.join(root,file))):null);entries[name]=cached.get(file);}return {hash:hash(JSON.stringify(entries)),files:entries};}
function snapshot(){
  const backend=['server.js','version.js','package.json','cliproom/server.js','cliproom/render.js','workspace/service.js','ProductivitySuite/model.js','ProductivitySuite/reminders.js'];
  const front={'/':'suite/index.html','/index.html':'suite/index.html'};for(const [directory,urls] of Object.entries(frontendRoots))for(const file of walk(path.join(root,directory))){if(directory==='cliproom/public'&&!['index.html','app.js','timeline.js','webm-duration.js','offline-render.js','styles.css'].includes(file))continue;for(const url of urls)front[directory==='cliproom/public'&&file==='index.html'?'/cliproom/':url+file]=directory+'/'+file;}
  const mcp=fs.existsSync(path.join(root,'mcp'))?fs.readdirSync(path.join(root,'mcp')).filter(name=>name.endsWith('.mjs')||['package.json','package-lock.json'].includes(name)).map(name=>'mcp/'+name):[];
  return {version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,backend:collect(Object.fromEntries(backend.map(f=>[f,f]))),frontend:collect(front),mcp:collect(Object.fromEntries(mcp.map(f=>[f,f])))};
}
module.exports={snapshot,hash};
