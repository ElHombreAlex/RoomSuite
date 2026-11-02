'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES=64*1024*1024,MAX_PER_PATH=20,MAX_RECORDS=10000;

// Call mutations under the workspace lock. Snapshots are immutable and restore
// only to a new path; the index is published atomically after the data file.
function createHistory({directory,temp,checkQuota,relative,fail}){
  const dataDir=path.join(directory,'data'),indexFile=path.join(directory,'index.json');
  async function directoryCheck(file){const stat=await fsp.lstat(file);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('History must use local directories.');}
  async function init(){await fsp.mkdir(directory,{recursive:true,mode:0o700});await directoryCheck(directory);await fsp.mkdir(dataDir,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await directoryCheck(dataDir);}
  function dataPath(id){if(typeof id!=='string'||!UUID.test(id))throw fail(400,'Invalid version ID.');return path.join(dataDir,id);}
  async function load(){
    let stat;try{stat=await fsp.lstat(indexFile);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    if(stat.isSymbolicLink()||!stat.isFile()||stat.size>8*1024*1024)throw fail(500,'Version history index is invalid.');let value;try{value=JSON.parse(await fsp.readFile(indexFile,'utf8'));}catch{throw fail(500,'Version history index is unreadable.');}
    if(!value||value.version!==1||!Array.isArray(value.entries)||value.entries.length>MAX_RECORDS)throw fail(500,'Version history index is invalid.');const ids=new Set();
    for(const entry of value.entries){try{if(!entry||!UUID.test(entry.id)||ids.has(entry.id)||relative(entry.path)!==entry.path||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||entry.bytes>MAX_BYTES||!/^[0-9a-f]{64}$/.test(entry.sha256)||!['manual','automatic'].includes(entry.source)||typeof entry.created_at!=='string'||Number.isNaN(Date.parse(entry.created_at)))throw new Error();ids.add(entry.id);}catch{throw fail(500,'Version history index is invalid.');}}
    return value.entries;
  }
  async function writeIndex(entries){const serialized=JSON.stringify({version:1,entries}),file=path.join(temp,crypto.randomUUID()+'.history-index');if(Buffer.byteLength(serialized)>8*1024*1024)throw fail(413,'Version history index is full.');let stat;try{stat=await fsp.lstat(indexFile);}catch(error){if(error.code!=='ENOENT')throw error;}if(stat&&(stat.isSymbolicLink()||!stat.isFile()))throw fail(500,'Version history index is invalid.');await checkQuota(Math.max(0,Buffer.byteLength(serialized)-(stat?.size||0)));try{await fsp.writeFile(file,serialized,{flag:'wx',mode:0o600});await fsp.rename(file,indexFile);}finally{await fsp.rm(file,{force:true}).catch(()=>{});}}
  async function copyChecked(source,destination,expectedSize,expectedHash){
    const handle=await fsp.open(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let bytes=0;const hash=crypto.createHash('sha256');
    try{const before=await handle.stat();if(!before.isFile()||before.size!==expectedSize||before.size>MAX_BYTES)throw fail(409,'The file changed before it could be saved to history.');const meter=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>expectedSize)return done(fail(409,'The file grew while it was being saved to history.'));hash.update(chunk);done(null,chunk);}});await pipeline(handle.createReadStream({autoClose:false}),meter,fs.createWriteStream(destination,{flags:'wx',mode:0o600}));const after=await handle.stat(),sha256=hash.digest('hex');if(bytes!==expectedSize||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||(expectedHash&&sha256!==expectedHash))throw fail(409,'The file changed while it was being saved to history.');return sha256;}finally{await handle.close();}
  }
  async function verifyExisting(item){const stored=await entry(item.id),temporary=path.join(temp,crypto.randomUUID()+'.history-verify');try{await copyChecked(stored.file,temporary,item.bytes,item.sha256);}finally{await fsp.rm(temporary,{force:true}).catch(()=>{});}}
  async function snapshot(clean,source,{expectedHash,kind='manual',reserve=0}={}){
    relative(clean);const entries=await load();if(expectedHash){const found=entries.find(entry=>entry.path===clean&&entry.sha256===expectedHash);if(found){await verifyExisting(found);return {entry:found,already_exists:true};}}if(entries.length>=MAX_RECORDS||entries.filter(entry=>entry.path===clean).length>=MAX_PER_PATH)throw fail(409,'Version history is full for this file or server. Delete an older version first.');
    const stat=await fsp.lstat(source);if(stat.isSymbolicLink()||!stat.isFile())throw fail(400,'Choose a regular file.');if(stat.size>MAX_BYTES)throw fail(413,'File history supports files up to 64 MiB.');await checkQuota(stat.size+8192+Math.max(0,reserve));const temporary=path.join(temp,crypto.randomUUID()+'.history-data');let destination;
    try{const sha256=await copyChecked(source,temporary,stat.size,expectedHash),found=entries.find(entry=>entry.path===clean&&entry.sha256===sha256);if(found){await verifyExisting(found);return {entry:found,already_exists:true};}const id=crypto.randomUUID();destination=dataPath(id);try{await fsp.lstat(destination);throw fail(409,'Version ID collision.');}catch(error){if(error.code!=='ENOENT')throw error;}await fsp.rename(temporary,destination);const entry={id,path:clean,bytes:stat.size,sha256,created_at:new Date().toISOString(),source:kind};try{await writeIndex([...entries,entry]);}catch(error){await fsp.unlink(destination).catch(()=>{});throw error;}return {entry,already_exists:false};}finally{await fsp.rm(temporary,{force:true}).catch(()=>{});}
  }
  async function entry(id){dataPath(id);const found=(await load()).find(item=>item.id===id);if(!found)throw fail(404,'Version not found.');const file=dataPath(id),stat=await fsp.lstat(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size!==found.bytes)throw fail(409,'Version data is missing or damaged.');return {entry:found,file};}
  async function verified(id){const result=await entry(id);await verifyExisting(result.entry);return result;}
  async function restore(id,destination){const found=await entry(id);await checkQuota(found.entry.bytes);const temporary=path.join(temp,crypto.randomUUID()+'.history-restore');try{await copyChecked(found.file,temporary,found.entry.bytes,found.entry.sha256);try{await fsp.copyFile(temporary,destination,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code==='EEXIST')throw fail(409,'A file or folder with that name already exists.');throw error;}return found.entry;}finally{await fsp.rm(temporary,{force:true}).catch(()=>{});}}
  async function remove(id){const entries=await load(),item=entries.find(value=>value.id===id);if(!item)throw fail(404,'Version not found.');const file=dataPath(id);let stat;try{stat=await fsp.lstat(file);}catch(error){if(error.code!=='ENOENT')throw error;}if(stat&&(stat.isSymbolicLink()||!stat.isFile()))throw fail(403,'Invalid version data.');await writeIndex(entries.filter(value=>value.id!==id));try{if(stat)await fsp.unlink(file);return {id,deleted:true};}catch{return {id,deleted:true,warning:'History metadata was removed, but its data file could not be removed.'};}}
  return {init,load,snapshot,entry,verified,restore,remove,limits:{max_bytes:MAX_BYTES,max_per_path:MAX_PER_PATH,max_records:MAX_RECORDS}};
}
module.exports={createHistory};
