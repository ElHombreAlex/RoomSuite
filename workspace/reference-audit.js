'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const NotesMedia=require('../NotesRoom/media');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const extensions=new Set(['.txt','.md','.csv','.tsv','.srt','.vtt','.json','.ics','.html','.css','.js','.xml','.yml','.yaml','.log','.roomgrade','.docsuite','.gridsuite','.decksuite','.plansuite','.vectorroom','.capturescene','.decktemplate','.pixelroom','.soundroom','.motionroom']);
const maxEntries=10000,maxFiles=2000,maxFileBytes=8*1024*1024,maxBytes=64*1024*1024,maxNotes=10000,maxNoteBytes=64*1024*1024,maxReferences=100;
const fingerprint=stat=>crypto.createHash('sha256').update(JSON.stringify([stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs])).digest('hex');

function createReferenceAudit({files,notes,existing,relative,linkedNote,noteAttachments,fail}){
  async function inspect(requested){
    const clean=relative(requested),target=await existing(clean),before=await fsp.lstat(target);
    if(before.isSymbolicLink()||!before.isFile())throw fail(400,'Choose a shared file to inspect.');
    const revision=fingerprint(before),variants=[clean,encodeURIComponent(clean),encodeURI(clean),new URLSearchParams({path:clean}).toString().slice(5),JSON.stringify(clean).slice(1,-1)].map(value=>value.toLowerCase());
    const mentions=value=>{const text=value.toLowerCase();return variants.some(variant=>text.includes(variant));};
    let complete=true,blocking=0,protectedCount=0,scannedNotes=0,noteBytes=0,protectedBytes=0,scannedFiles=0,bytes=0,visited=0,skipped=0;const references=[],verified=new Set();
    const add=(item,isProtected=false)=>{if(isProtected)protectedCount++;else blocking++;if(references.length<maxReferences)references.push({...item,protected:isProtected});};
    async function verifyCopy(id){
      if(verified.has(id))return;const entry=await noteAttachments.entry(id);if(protectedBytes+entry.info.bytes>maxBytes)throw new Error('Protected copies exceed the scan limit.');protectedBytes+=entry.info.bytes;
      const handle=await fsp.open(entry.file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));try{const start=await handle.stat();if(!start.isFile()||start.size!==entry.info.bytes)throw new Error('The protected copy changed.');const hash=crypto.createHash('sha256'),chunk=Buffer.alloc(Math.min(256*1024,start.size||1));let total=0;while(total<start.size){const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,start.size-total),total);if(!bytesRead)break;total+=bytesRead;hash.update(chunk.subarray(0,bytesRead));}const end=await handle.stat();if(total!==start.size||fingerprint(start)!==fingerprint(end)||hash.digest('hex')!==entry.info.sha256)throw new Error('The protected copy failed its integrity check.');verified.add(id);}finally{await handle.close();}
    }
    const names=(await fsp.readdir(notes)).filter(name=>name.endsWith('.json')&&uuid.test(name.slice(0,-5))).sort();if(names.length>maxNotes)complete=false;
    for(const name of names.slice(0,maxNotes)){
      try{
        const {note,bytes:size}=await linkedNote(name.slice(0,-5));if(noteBytes+size>maxNoteBytes){complete=false;break;}noteBytes+=size;scannedNotes++;
        const parsed=NotesMedia.references(note.body),safe=new Set();
        for(const item of parsed.items)if(item.path.toLowerCase()===clean.toLowerCase()&&item.attachment){
          try{await verifyCopy(item.attachment);safe.add(item.index);add({kind:'note',id:note.id,title:note.title,reason:'Independent protected media copy'},true);}
          catch{complete=false;skipped++;}
        }
        if(mentions(parsed.lines.filter((_,index)=>!safe.has(index)).join('\n')))add({kind:'note',id:note.id,title:note.title,reason:'Path appears in a saved note'});
      }catch{complete=false;skipped++;}
    }
    const queue=[''];let cursor=0,stopped=false;
    while(cursor<queue.length&&!stopped){
      const folder=queue[cursor++];let dir,entries;try{dir=await existing(folder,true);entries=await fsp.readdir(dir,{withFileTypes:true});}catch{complete=false;skipped++;continue;}
      entries.sort((a,b)=>a.name.localeCompare(b.name));
      for(const entry of entries){
        if(++visited>maxEntries){complete=false;stopped=true;break;}const name=folder?folder+'/'+entry.name:entry.name;try{relative(name);}catch{complete=false;skipped++;continue;}
        let stat;try{stat=await fsp.lstat(path.join(dir,entry.name));}catch{complete=false;skipped++;continue;}
        if(stat.isSymbolicLink()){complete=false;skipped++;continue;}
        if(stat.isDirectory()){if(name.split('/').length>=30){complete=false;skipped++;}else queue.push(name);continue;}
        if(!stat.isFile()||name===clean||!extensions.has(path.extname(entry.name).toLowerCase()))continue;
        if(stat.size>maxFileBytes){complete=false;skipped++;continue;}
        if(scannedFiles>=maxFiles||bytes+stat.size>maxBytes){complete=false;stopped=true;break;}scannedFiles++;bytes+=stat.size;
        let handle;try{
          const file=await existing(name);handle=await fsp.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const start=await handle.stat();
          if(!start.isFile()||fingerprint(start)!==fingerprint(stat))throw new Error('Changed during scan.');
          const data=Buffer.alloc(start.size+1);let offset=0;while(offset<data.length){const result=await handle.read(data,offset,data.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
          const end=await handle.stat();if(offset!==start.size||fingerprint(start)!==fingerprint(end))throw new Error('Changed during scan.');
          const text=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,offset));if(text.includes('\0'))throw new Error('Not UTF-8 text.');
          if(mentions(text))add({kind:'file',path:name,reason:'Path appears in a supported text file'});
        }catch{complete=false;skipped++;}finally{if(handle)await handle.close();}
      }
    }
    const after=await fsp.lstat(await existing(clean));if(after.isSymbolicLink()||!after.isFile()||fingerprint(after)!==revision)throw fail(409,'The file changed during inspection. Try again.');
    return {path:clean,revision,status:blocking?'referenced':complete?'not_detected':'unknown',complete,blocking_count:blocking,protected_count:protectedCount,references,matches_truncated:blocking+protectedCount>references.length,scanned_notes:scannedNotes,scanned_files:scannedFiles,skipped,note:'Only saved notes and supported UTF-8 shared files were scanned. Open or unsaved work, external files and unsupported formats may still refer to this file.'};
  }
  return {inspect,fingerprint};
}
module.exports={createReferenceAudit};
