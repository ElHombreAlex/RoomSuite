'use strict';
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const maxBytes=128*1024*1024,maxTotalBytes=1024*1024*1024,maxFiles=100;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status,message)=>Object.assign(new Error(message),{status});
function createProxyCache({directory,assetsDir,withLock}){
  let uploads=0;
  function file(id){if(!uuid.test(id))throw fail(400,'Invalid media ID.');return path.join(directory,id+'.webm');}
  async function source(id){
    file(id);
    const data=path.join(assetsDir,id),metaFile=data+'.json';
    const [stat,metaStat]=await Promise.all([fsp.lstat(data),fsp.lstat(metaFile)]);
    if(!stat.isFile()||stat.isSymbolicLink()||!metaStat.isFile()||metaStat.isSymbolicLink())throw fail(404,'Media not found.');
    const meta=JSON.parse(await fsp.readFile(metaFile,'utf8'));if(meta.id!==id||!String(meta.type).startsWith('video/'))throw fail(400,'A video source is required.');return {stat,meta};
  }
  async function status(id){await source(id);try{const stat=await fsp.lstat(file(id));if(!stat.isFile()||stat.isSymbolicLink()||!stat.size||stat.size>maxBytes)throw fail(409,'The optimized preview cache is damaged.');const version=crypto.createHash('sha256').update([stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':')).digest('hex').slice(0,24);return {asset_id:id,exists:true,bytes:stat.size,version};}catch(error){if(error.code==='ENOENT')return {asset_id:id,exists:false,bytes:0};throw error;}}
  async function cacheUsage(){let bytes=0,count=0;for(const ent of await fsp.readdir(directory,{withFileTypes:true})){if(!ent.isFile()||!/^([0-9a-f-]+)\.webm$/i.test(ent.name)||!uuid.test(ent.name.slice(0,-5)))continue;const stat=await fsp.lstat(path.join(directory,ent.name));if(!stat.isFile()||stat.isSymbolicLink())throw fail(409,'The optimized preview cache is damaged.');bytes+=stat.size;count++;}return {bytes,count};}
  async function remove(id){const target=file(id);try{const stat=await fsp.lstat(target);if(!stat.isFile()||stat.isSymbolicLink())throw fail(409,'The optimized preview cache is damaged.');await fsp.unlink(target);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
  async function upload(id,req){
    file(id);if(uploads>=2)throw fail(429,'Another optimized preview is being uploaded. Try again shortly.');if(Number(req.headers['content-length']||0)>maxBytes)throw fail(413,'Optimized previews are limited to 128 MiB.');
    uploads++;let temp=null,bytes=0;
    try{
      const initial=await source(id),existing=await status(id);if(existing.exists){req.resume();return {...existing,already_exists:true};}temp=path.join(directory,crypto.randomUUID()+'.tmp');
      const limiter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;done(bytes>maxBytes?fail(413,'Optimized previews are limited to 128 MiB.'):null,chunk);}});
      await pipeline(req,limiter,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));if(bytes<16)throw fail(400,'The optimized preview is empty or invalid.');
      const handle=await fsp.open(temp,'r');let magic;try{magic=Buffer.alloc(4);await handle.read(magic,0,4,0);}finally{await handle.close();}if(!magic.equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))throw fail(400,'The optimized preview must be a WebM file.');
      return await withLock('asset-catalog',async()=>{const current=await source(id);if(current.stat.dev!==initial.stat.dev||current.stat.ino!==initial.stat.ino||current.stat.size!==initial.stat.size||current.stat.mtimeMs!==initial.stat.mtimeMs)throw fail(409,'The source changed while creating the optimized preview.');const existing=await status(id);if(existing.exists)return {...existing,already_exists:true};const used=await cacheUsage();if(used.count>=maxFiles||used.bytes+bytes>maxTotalBytes)throw fail(413,'The optimized preview cache is full. Remove an existing preview first.');await fsp.rename(temp,file(id));return {...await status(id),already_exists:false};});
    }finally{uploads--;if(temp)await fsp.rm(temp,{force:true}).catch(()=>{});}
  }
  return {file,source,status,remove,upload,maxBytes,maxFiles,maxTotalBytes};
}
module.exports={createProxyCache,maxBytes,maxTotalBytes,maxFiles};
