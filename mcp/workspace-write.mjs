import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspace, outputPath } from './files.mjs';

const sessions=new Map(),MAX_BYTES=16*1024*1024,MAX_CHUNK=8192,MAX_CHUNKS=8192,TTL=30*60*1000;let pendingBegins=0;
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
async function staging(){
  const root=await workspace(),dir=path.join(root,'.roomsuite-staging');
  try{await fs.mkdir(dir,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('The workspace staging directory must be a real directory.');
  const real=await fs.realpath(dir);if(path.dirname(real)!==root)throw new Error('The staging directory leaves the MCP workspace.');
  for(const name of await fs.readdir(real))if(/^[0-9a-f-]{36}\.part$/i.test(name)){const file=path.join(real,name),item=await fs.lstat(file).catch(()=>null);if(item?.isFile()&&!item.isSymbolicLink()&&Date.now()-item.mtimeMs>24*60*60*1000)await fs.unlink(file).catch(()=>{});}
  return real;
}
async function expired(){const now=Date.now();for(const [id,s]of sessions)if(now-s.touched>TTL){sessions.delete(id);await s.tail.catch(()=>{});await fs.rm(s.tmp,{force:true}).catch(()=>{});}}
const timer=setInterval(()=>{void expired();},5*60*1000);timer.unref();
function validText(text){for(let i=0;i<text.length;i++){const n=text.charCodeAt(i);if(n>=0xd800&&n<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(n>=0xdc00&&n<=0xdfff)return false;}return true;}
function run(id,fn){const s=sessions.get(id);if(!s)throw new Error('Write session not found or expired.');const job=s.tail.catch(()=>{}).then(async()=>{if(sessions.get(id)!==s)throw new Error('Write session not found or expired.');s.touched=Date.now();return fn(s);});s.tail=job;return job;}
export async function beginWrite(args){
  await expired();if(sessions.size+pendingBegins>=16)throw new Error('Too many active workspace write sessions.');pendingBegins++;
  try{const output=await outputPath(args.output,['.json','.paintroom']),dir=await staging(),id=crypto.randomUUID(),tmp=path.join(dir,id+'.part');
    await fs.writeFile(tmp,'',{flag:'wx',mode:0o600});sessions.set(id,{output,tmp,bytes:0,records:[],hasher:crypto.createHash('sha256'),touched:Date.now(),tail:Promise.resolve()});
    return {session_id:id,next_index:0,max_chunk_bytes:MAX_CHUNK,max_bytes:MAX_BYTES};
  }finally{pendingBegins--;}
}
export async function appendWrite(args){return run(args.session_id,async s=>{
  if(!validText(args.text))throw new Error('Each chunk must contain complete Unicode characters.');
  const data=Buffer.from(args.text,'utf8');if(!data.length||data.length>MAX_CHUNK)throw new Error('Each chunk must contain between 1 and '+MAX_CHUNK+' UTF-8 bytes.');
  const hash=digest(data);if(args.index<s.records.length){const old=s.records[args.index];if(old.hash!==hash||old.bytes!==data.length)throw new Error('This chunk index already contains different data.');return {next_index:s.records.length,bytes:s.bytes,replayed:true};}
  if(args.index!==s.records.length)throw new Error('Send chunks in order, starting at index 0.');
  if(s.records.length>=MAX_CHUNKS||s.bytes+data.length>MAX_BYTES)throw new Error('Workspace write limit exceeded.');
  await fs.appendFile(s.tmp,data);s.hasher.update(data);s.records.push({hash,bytes:data.length});s.bytes+=data.length;return {next_index:s.records.length,bytes:s.bytes,replayed:false};
});}
export async function finishWrite(args){return run(args.session_id,async s=>{
  const bytes=await fs.readFile(s.tmp);if(bytes.length!==s.bytes)throw new Error('The staged file changed unexpectedly.');
  const hash=digest(bytes);if(hash!==s.hasher.copy().digest('hex'))throw new Error('The staged file changed unexpectedly.');if(args.sha256&&args.sha256.toLowerCase()!==hash)throw new Error('The file checksum does not match.');
  try{JSON.parse(bytes.toString('utf8'));}catch{throw new Error('The staged file is not valid JSON. Add the missing chunks or abort the session.');}
  const destination=await outputPath(s.output,['.json','.paintroom']);if(destination!==s.output)throw new Error('The output directory changed during the write session.');
  try{await fs.link(s.tmp,destination);}catch(error){if(error.code==='EEXIST')throw new Error('Output already exists: '+s.output);if(error.code==='EXDEV')throw new Error('The destination must be on the same filesystem as the MCP workspace.');throw error;}
  sessions.delete(args.session_id);await fs.unlink(s.tmp).catch(()=>{});return {path:s.output,bytes:s.bytes,sha256:hash};
});}
export async function abortWrite(args){return run(args.session_id,async s=>{sessions.delete(args.session_id);await fs.rm(s.tmp,{force:true});return {aborted:true};});}
