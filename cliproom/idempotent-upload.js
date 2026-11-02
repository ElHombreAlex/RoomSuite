'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
function createUploader({assetsDir,maxBytes,withLock,atomicJson,fail}){
  let active=0;
  async function hashFile(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
  return async function upload(req,id,name,type){
    if(active>=2)throw fail(429,'Too many media uploads are in progress. Try again shortly.');if(Number(req.headers['content-length']||0)>maxBytes)throw fail(413,'Files must be 2 GB or smaller.');active++;let size=0;const temp=path.join(assetsDir,crypto.randomUUID()+'.tmp'),hash=crypto.createHash('sha256');
    try{const meter=new Transform({transform(chunk,encoding,done){size+=chunk.length;hash.update(chunk);done(size>maxBytes?fail(413,'Files must be 2 GB or smaller.'):null,chunk);}});await pipeline(req,meter,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));if(!size)throw fail(400,'The file is empty.');const digest=hash.digest('hex'),data=path.join(assetsDir,id),metadata=data+'.json';
      return await withLock('asset-catalog',async()=>{let existing=null,stat=null;try{stat=await fsp.lstat(data);}catch(error){if(error.code!=='ENOENT')throw error;}try{const info=await fsp.lstat(metadata);if(!info.isFile()||info.isSymbolicLink())throw fail(409,'The requested media ID is already in use.');existing=JSON.parse(await fsp.readFile(metadata,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}if(stat||existing){if(!stat?.isFile()||stat.isSymbolicLink()||!existing||existing.id!==id||existing.name!==name||existing.type!==type||stat.size!==size||existing.size!==size||await hashFile(data)!==digest)throw fail(409,'The requested media ID already contains different data. Use a new handoff ID.');return {...existing,reused:true};}
        let created=false;try{await fsp.rename(temp,data);created=true;const result={id,name,type,size};await atomicJson(metadata,result);return {...result,reused:false};}catch(error){if(created)await fsp.unlink(data).catch(()=>{});throw error;}});
    }finally{active--;await fsp.rm(temp,{force:true}).catch(()=>{});}
  };
}
module.exports={createUploader};
