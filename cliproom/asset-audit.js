'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maxEntries=10000,maxProjectBytes=2*1024*1024+8192,maxTotalProjectBytes=64*1024*1024,maxNodes=500000;
// This is a point-in-time report, never permission to delete: other tabs can
// hold unsaved projects and saved projects may change after the scan.
async function audit({assetsDir,projectsDir,mediaTypes,offset=0,limit=100,filter='all',findId=null}){
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200||!['all','unused'].includes(filter))throw Object.assign(new Error('Invalid media audit page.'),{status:400});
  if(findId!==null&&!UUID.test(findId))throw Object.assign(new Error('Invalid media ID.'),{status:400});
  const names=await fs.readdir(assetsDir),projectFiles=(await fs.readdir(projectsDir)).filter(name=>name.toLowerCase().endsWith('.json')).sort();
  const metadata=names.filter(name=>name.toLowerCase().endsWith('.json')&&UUID.test(name.slice(0,-5))).sort(),issues=[];let complete=true,totalProjectBytes=0;
  if(metadata.length>maxEntries||projectFiles.length>maxEntries){complete=false;issues.push('The library or project count exceeds the audit limit.');}
  const entries=[];
  for(const filename of metadata.slice(0,maxEntries)){
    const id=filename.slice(0,-5);try{const metaPath=path.join(assetsDir,filename),dataPath=path.join(assetsDir,id),[metaStat,dataStat]=await Promise.all([fs.lstat(metaPath),fs.lstat(dataPath)]);if(!metaStat.isFile()||!dataStat.isFile()||metaStat.size>65536)throw new Error('Invalid media files.');const item=JSON.parse(await fs.readFile(metaPath,'utf8'));if(typeof item.id!=='string'||item.id.toLowerCase()!==id.toLowerCase()||typeof item.name!=='string'||item.name.length>500||!mediaTypes.has(item.type))throw new Error('Invalid media metadata.');entries.push({id,name:item.name,type:item.type,bytes:dataStat.size,modified_at:dataStat.mtime.toISOString(),references:[]});}catch{complete=false;if(issues.length<25)issues.push('Media '+id+' has missing or invalid files.');}
  }
  const byId=new Map();for(const item of entries){const key=item.id.toLowerCase();if(byId.has(key)){complete=false;if(issues.length<25)issues.push('Media IDs collide ignoring case.');}byId.set(key,item);}
  const targetKey=findId?.toLowerCase(),target=targetKey?(byId.get(targetKey)||{id:findId,references:[]}):null;if(target&&!byId.has(targetKey))byId.set(targetKey,target);
  for(const filename of projectFiles.slice(0,maxEntries)){
    const projectId=filename.slice(0,-5);try{if(!UUID.test(projectId))throw new Error('Invalid project name.');const file=path.join(projectsDir,filename),stat=await fs.lstat(file);if(!stat.isFile()||stat.size>maxProjectBytes)throw new Error('Invalid project size.');totalProjectBytes+=stat.size;if(totalProjectBytes>maxTotalProjectBytes)throw new Error('Project scan limit reached.');const project=JSON.parse(await fs.readFile(file,'utf8'));if(typeof project.id!=='string'||project.id.toLowerCase()!==projectId.toLowerCase()||!project.state||typeof project.state!=='object'||Array.isArray(project.state)||typeof project.state.name!=='string'||!Array.isArray(project.state.assets))throw new Error('Invalid project.');
      if(!Number.isInteger(project.revision)||project.revision<1||project.state.assets.some(asset=>!asset||typeof asset.id!=='string'||!UUID.test(asset.id)))throw new Error('Invalid project references.');const seen=new Set(),stack=[project.state];let nodes=0;while(stack.length){const value=stack.pop();if(++nodes>maxNodes)throw new Error('Project is too complex to audit.');if(typeof value==='string'&&value.length===36&&UUID.test(value)){const key=value.toLowerCase();if(byId.has(key))seen.add(key);}else if(value&&typeof value==='object')for(const child of Object.values(value))stack.push(child);}
      for(const id of seen)byId.get(id).references.push({project_id:projectId,name:project.state.name.slice(0,160),revision:project.revision});
    }catch{complete=false;if(issues.length<25)issues.push('Project '+projectId+' could not be fully inspected.');}
  }
  const items=entries.map(item=>({...item,status:item.references.length?'referenced':complete?'unreferenced':'unknown',reference_count:item.references.length,references:item.references.slice(0,20)})).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const nameSet=new Set(names.map(name=>name.toLowerCase())),filtered=filter==='unused'?items.filter(item=>item.status==='unreferenced'):items,unmanaged=names.filter(name=>UUID.test(name)&&!nameSet.has(name.toLowerCase()+'.json')).length;
  return {complete,project_count:projectFiles.length,scanned_projects:Math.min(projectFiles.length,maxEntries),media_count:metadata.length,scanned_media:Math.min(metadata.length,maxEntries),unmanaged_media:unmanaged,unreferenced_count:complete?items.filter(item=>item.status==='unreferenced').length:null,issues,offset,limit,total:filtered.length,next_offset:offset+limit<filtered.length?offset+limit:null,items:filtered.slice(offset,offset+limit),...(target?{target:{id:target.id,exists:entries.includes(target),reference_count:target.references.length,references:target.references.slice(0,20),modified_at:target.modified_at||null}}:{}),note:'Only saved projects are checked. Open or unsaved projects, external backups and exports may still need this media. Recheck immediately before any cleanup.'};
}
module.exports={audit};
