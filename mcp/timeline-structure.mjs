import crypto from 'node:crypto';
import Timeline from '../cliproom/public/timeline.js';
import {serverUrl} from './rooms.mjs';
import {request,opDigest,prior,idInUse,maxReceipts} from './timeline-edit.mjs';

const actionFields={add_track:['kind','track'],update_track:['track_id','track'],remove_track:['track_id','remove_clips'],add_title:['title'],update_title:['title_id','title'],remove_title:['title_id']};
function trackFor(state,id){const found=[['video',state.videoTracks],['audio',state.audioTracks]].flatMap(([kind,list])=>list.filter(track=>track?.id===id).map(track=>({kind,list,track})));if(found.length!==1)throw new Error('The track ID must identify exactly one track.');return found[0];}
function titleFor(state,id){const found=state.titles.filter(title=>title?.id===id);if(found.length!==1)throw new Error('The title ID must identify exactly one title.');return found[0];}
function newId(state,id){if(idInUse(state,id))throw new Error('The operation ID is already used by a project item; choose a new UUID.');}
function trackValues(track,kind,values){if(!values||!Object.keys(values).length)throw new Error('Provide track properties.');if(kind==='audio'&&values.hidden!==undefined)throw new Error('Only picture tracks have a visibility setting.');if(values.name!==undefined){const name=values.name.trim();if(!name||/[\x00-\x1f\x7f]/.test(name))throw new Error('Provide a valid track name.');track.name=name;}if(values.muted!==undefined)track.muted=values.muted;if(values.hidden!==undefined)track.hidden=values.hidden;}
function titleValues(title,values,state,requireTiming=false){
  if(!values||!Object.keys(values).length)throw new Error('Provide title properties.');
  if(values.position&&values.position!=='custom'&&(values.x!==undefined||values.y!==undefined))throw new Error('Use custom position when setting x or y.');
  if(values.position){title.position=values.position;if(values.position!=='custom'){title.x=50;title.y=values.position==='top'?18:values.position==='bottom'?82:50;}}
  if(values.x!==undefined||values.y!==undefined){title.position='custom';if(values.x!==undefined)title.x=values.x;if(values.y!==undefined)title.y=values.y;}
  for(const key of ['text','start','end','width','font','bold','italic','size','color'])if(values[key]!==undefined)title[key]=values[key];
  if(values.rotation!==undefined)title.rotation=Timeline.normalizeRotation(values.rotation);
  const minimum=title.subtitle ? .001 : .05,total=Timeline.duration(state);if((requireTiming||values.start!==undefined||values.end!==undefined)&&(!Number.isFinite(title.start)||!Number.isFinite(title.end)||title.start<0||title.end-title.start<minimum-1e-9||title.end>total+1e-6))throw new Error('Title timing must fit the timeline and have a positive duration.');
}
function edit(state,args,id){
  const result={action:args.action,warnings:[]};
  if(args.action==='add_track'){
    if(!args.kind)throw new Error('Choose video or audio for the new track.');const list=args.kind==='video'?state.videoTracks:state.audioTracks;if(list.length>=100)throw new Error('A project supports up to 100 tracks of each type.');newId(state,id);const prefix=args.kind==='video'?'Video':'Audio';let n=1;while(list.some(track=>track.name===prefix+' '+n))n++;const track={id,name:prefix+' '+n,muted:false,...(args.kind==='video'?{hidden:false}:{})};if(args.track)trackValues(track,args.kind,args.track);list.push(track);result.track=structuredClone(track);result.kind=args.kind;
  }else if(args.action==='update_track'){
    const {kind,track}=trackFor(state,args.track_id);result.before=structuredClone(track);trackValues(track,kind,args.track);result.track=structuredClone(track);result.kind=kind;
  }else if(args.action==='remove_track'){
    const {kind,list,track}=trackFor(state,args.track_id);if(list.length===1)throw new Error('Keep at least one track of each type.');const clips=kind==='video'?state.clips:state.audioClips,used=clips.filter(clip=>clip.trackId===track.id);if(used.length&&!args.remove_clips)throw new Error('This track contains clips. Set remove_clips to remove them from the timeline.');for(const clip of used)clips.splice(clips.indexOf(clip),1);list.splice(list.indexOf(track),1);result.before=structuredClone(track);result.kind=kind;result.removed_clips=used.map(clip=>clip.id);if(used.length)result.warnings.push('The source media remains in the library.');
  }else if(args.action==='add_title'){
    if(state.titles.length>=1000)throw new Error('A project supports up to 1,000 titles.');newId(state,id);const total=Timeline.duration(state),title={id,text:'Your title here',start:0,end:Math.min(3,total),position:'middle',x:50,y:50,width:84,rotation:0,font:'sans-serif',bold:true,italic:false,size:6,color:'#ffffff'};titleValues(title,args.title||{text:title.text},state,true);state.titles.push(title);result.title=structuredClone(title);
  }else if(args.action==='update_title'){
    const title=titleFor(state,args.title_id);result.before=structuredClone(title);titleValues(title,args.title,state);result.title=structuredClone(title);
  }else if(args.action==='remove_title'){
    const title=titleFor(state,args.title_id);result.before=structuredClone(title);state.titles.splice(state.titles.indexOf(title),1);
  }else throw new Error('Unknown timeline structure action.');
  return result;
}
export async function editTimelineStructure(args,signal){
  const allowed=actionFields[args.action];for(const key of ['kind','track_id','track','remove_clips','title_id','title'])if(args[key]!==undefined&&!allowed.includes(key))throw new Error(key+' does not apply to '+args.action+'.');
  if(!args.dry_run&&!args.operation_id)throw new Error('Provide a new UUIDv4 operation_id for a retry-safe edit.');
  const id=args.operation_id||crypto.randomUUID(),digest=opDigest(args),url='/api/projects/'+encodeURIComponent(args.project_id),project=await request(url,{signal});
  if(args.operation_id&&!args.dry_run){const previous=prior(project,args,digest);if(previous)return previous;}
  if(project.revision!==args.base_revision)throw Object.assign(new Error('This project changed. Read its latest revision before editing.'),{code:'REVISION_CONFLICT',currentRevision:project.revision});
  const state=Timeline.migrate(structuredClone(project.state),()=>crypto.randomUUID()),before=JSON.stringify(state),result=edit(state,args,id),changed=before!==JSON.stringify(state),response={...result,project_id:project.id,revision:project.revision,operation_id:id,dry_run:!!args.dry_run,changed,already_applied:false};
  if(args.dry_run||!changed)return response;
  const history=Array.isArray(state.agentTimelineOps)?state.agentTimelineOps.filter(entry=>entry&&typeof entry==='object').slice(-(maxReceipts-1)):[];history.push({id,project_id:project.id,digest,applied_revision:project.revision+1,result:{...result,operation_id:id,dry_run:false,changed:true}});state.agentTimelineOps=history;state.version=5;
  if(Buffer.byteLength(JSON.stringify({baseRevision:project.revision,state}))>2*1024*1024)throw new Error('The edit would exceed the 2 MiB project save limit.');
  const origin=serverUrl();try{const saved=await request(url,{method:'PUT',signal,headers:{Origin:origin,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,state})});return {...response,revision:saved.revision,applied_revision:saved.revision};}
  catch(error){if(error.status===409&&args.operation_id){const latest=await request(url,{signal}),previous=prior(latest,args,digest);if(previous)return previous;}throw error;}
}
