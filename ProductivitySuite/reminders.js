'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const Model=require('./model');

function createReminders({root,files,fetchImpl=fetch}) {
  const configFile=path.join(root,'.plansuite-ntfy.json'), ledgerFile=path.join(root,'.plansuite-reminders.json');
  let running=false,lastError='',timer;
  const read=async(file,fallback)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
  async function write(file,value){const tmp=path.join(root,'.'+crypto.randomUUID()+'.tmp');try{await fs.writeFile(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}}
  async function config(){return read(configFile,{enabled:false,server:'',topic:'',token:''});}
  const publicConfig=c=>({enabled:!!c.enabled,server:c.server||'',topic:c.topic||'',hasToken:!!c.token,lastError});
  async function settings(){return publicConfig(await config());}
  async function configure(input){
    if(!input||typeof input.enabled!=='boolean'||typeof input.server!=='string'||typeof input.topic!=='string')throw new Error('Provide an enabled setting, server URL and topic.');
    const old=await config(), server=input.server.trim().replace(/\/+$/,''), topic=input.topic.trim(), token=input.token===undefined?old.token:input.token;
    if(typeof token!=='string'||token.length>1024||/[^\x21-\x7e]/.test(token))throw new Error('Invalid access token.');
    if(input.enabled||server||topic){let url;try{url=new URL(server);}catch{throw new Error('Enter a valid ntfy server URL.');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('The ntfy URL must be HTTP(S), without credentials, a query or a fragment.');if(!/^[A-Za-z0-9_-]{1,64}$/.test(topic))throw new Error('The ntfy topic must use letters, numbers, hyphens or underscores.');}
    const next={enabled:input.enabled,server,topic,token};await write(configFile,next);lastError='';return publicConfig(next);
  }
  async function publish(c,message){
    if(!c.enabled)throw new Error('Enable ntfy first.');
    const target=c.server+'/'+encodeURIComponent(c.topic),headers={'Content-Type':'text/plain; charset=utf-8','Title':'PlanSuite reminder'};
    if(c.token)headers.Authorization='Bearer '+c.token;
    const response=await fetchImpl(target,{method:'POST',headers,body:message,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('ntfy returned HTTP '+response.status+'.');
    await response.body?.cancel().catch(()=>{});
  }
  async function test(){try{await publish(await config(),'PlanSuite notifications are working.');lastError='';return {sent:true};}catch(error){lastError='Could not send to ntfy.';throw new Error(lastError);}}
  async function calendarFiles(){
    const found=[],queue=[files];let visited=0;
    while(queue.length){const dir=queue.shift();for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(++visited>20000)return found;if(entry.isSymbolicLink())continue;const full=path.join(dir,entry.name);if(entry.isDirectory())queue.push(full);else if(entry.isFile()&&entry.name.toLowerCase().endsWith('.plansuite'))found.push(full);}}
    return found;
  }
  async function tick(now=Date.now()){
    if(running)return {sent:0};running=true;let sent=0;
    try{
      const c=await config();if(!c.enabled)return {sent};
      const ledger=await read(ledgerFile,{});let changed=false;
      for(const [key,when] of Object.entries(ledger))if(typeof when!=='number'||when<now-30*86400000){delete ledger[key];changed=true;}
      for(const file of await calendarFiles()){
        let state;try{const stat=await fs.stat(file);if(stat.size>8*1024*1024)continue;state=Model.validate(JSON.parse(await fs.readFile(file,'utf8')),'plansuite');}catch{continue;}
        for(const event of state.events){
          if(event.remindMinutes===null)continue;
          const start=Date.parse(event.start),due=start-event.remindMinutes*60000,key=crypto.createHash('sha256').update(event.id+'|'+event.start+'|'+event.remindMinutes).digest('hex');
          if(ledger[key]||now<due||now>start+300000)continue;
          try{await publish(c,event.title+'\nStarts: '+event.start.replace('.000Z','Z'));ledger[key]=now;changed=true;sent++;await write(ledgerFile,ledger);changed=false;lastError='';}
          catch{lastError='Could not send a reminder to ntfy. RoomSuite will retry while the event is upcoming.';}
        }
      }
      if(changed)await write(ledgerFile,ledger);
      return {sent};
    }finally{running=false;}
  }
  function start(){if(timer)return;timer=setInterval(()=>void tick().catch(()=>{lastError='Could not check reminders.';}),30000);timer.unref();void tick().catch(()=>{lastError='Could not check reminders.';});}
  function stop(){if(timer)clearInterval(timer);timer=undefined;}
  return {settings,configure,test,tick,start,stop};
}
module.exports={createReminders};
