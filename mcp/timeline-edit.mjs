import crypto from 'node:crypto';
import Timeline from '../cliproom/public/timeline.js';
import CreativeFrames from '../cliproom/public/look-keyframes.js';
import { serverUrl } from './rooms.mjs';

// A short receipt travels with the same revision as an edit. Reusing an ID
// after a lost response returns the prior result instead of duplicating clips.
const maxReceipts=64;
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
async function request(url,options={}){const response=await fetch(serverUrl()+url,options),body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error||'Cliproom request failed.'),{status:response.status,code:response.status===409?'REVISION_CONFLICT':undefined});return body;}
function snapshot(clip){const {id,assetId,trackId,start,in:source_in,out:source_out,rate,volume,fadeIn,fadeOut,fit,scale,x,y,opacity,rotation,flipX,brightness,contrast,saturation}=clip;return {id,asset_id:assetId,track_id:trackId,start,source_in,source_out,speed:rate??1,volume,fade_in:fadeIn??0,fade_out:fadeOut??0,...(fit!==undefined?{fit,scale,x,y,opacity,rotation,flip_x:flipX,brightness,contrast,saturation}:{})};}
function opDigest(args){const {base_revision,dry_run,operation_id,...operation}=args;return crypto.createHash('sha256').update(canonical(operation)).digest('hex');}
function prior(project,args,digest){const matches=Array.isArray(project.state.agentTimelineOps)?project.state.agentTimelineOps.filter(entry=>entry?.id===args.operation_id&&entry?.project_id===args.project_id):[];if(matches.length>1)throw new Error('The operation history is inconsistent; inspect the project.');const entry=matches[0];if(!entry)return null;if(entry.digest!==digest)throw Object.assign(new Error('This operation ID was already used for a different timeline edit.'),{code:'OPERATION_ID_CONFLICT'});return {...entry.result,project_id:project.id,revision:project.revision,applied_revision:entry.applied_revision,already_applied:true};}
function idInUse(state,id){return [...state.assets,...state.videoTracks,...state.audioTracks,...state.clips,...state.audioClips,...state.titles].some(item=>item?.id===id||(item?.keyframes||[]).some(frame=>frame?.id===id));}
function requireNewId(state,id){if(idInUse(state,id))throw new Error('The operation ID is already used by a project item; choose a new UUID.');}
function frameTime(clip,args){if((args.timeline_time===undefined)===(args.source_time===undefined))throw new Error('Provide exactly one timeline_time or source_time.');if(args.timeline_time!==undefined){if(args.timeline_time<clip.start-1e-9||args.timeline_time>Timeline.end(clip)+1e-9)throw new Error('The keyframe time must fall within the clip.');return Math.round(Timeline.sourceAt(clip,args.timeline_time)*1000)/1000;}return args.source_time;}

function edit(state,args,operationId){
  const lists=[['video',state.clips],['audio',state.audioClips]],matches=lists.flatMap(([kind,clips])=>clips.filter(item=>item?.id===args.clip_id).map(item=>({kind,clips,item})));
  if(matches.length!==1)throw new Error('The clip ID must identify exactly one picture or audio clip.');
  const {kind,clips,item}=matches[0],asset=state.assets.find(value=>value.id===item.assetId),before=snapshot(item),warnings=[];if(!asset||!['image','video','audio'].includes(asset.kind)||(kind==='audio')!==(asset.kind==='audio'))throw new Error('The clip source is missing or has an incompatible media type.');
  const result={action:args.action,clip_id:item.id,before,warnings};
  if(args.action==='update'){
    const properties=args.properties;if(!properties||!Object.keys(properties).length)throw new Error('Provide clip properties to update.');
    const picture=['fit','scale','x','y','opacity','rotation','flip_x','brightness','contrast','saturation'];
    if(kind==='audio'&&picture.some(key=>properties[key]!==undefined))throw new Error('Picture properties apply only to picture clips.');
    const names={track_id:'trackId',source_in:'in',source_out:'out',speed:'rate',fade_in:'fadeIn',fade_out:'fadeOut',flip_x:'flipX'};
    for(const [key,value] of Object.entries(properties))item[names[key]||key]=key==='rotation'?Timeline.normalizeRotation(value):value;
    const tracks=kind==='audio'?state.audioTracks:state.videoTracks;if(!tracks.some(track=>track.id===item.trackId))throw new Error('The requested track does not exist for this clip.');
    const max=asset.kind==='image'?3600:asset.duration;if(![item.start,item.in,item.out,item.rate??1,max].every(Number.isFinite)||item.start<0||(item.rate??1)<.5||(item.rate??1)>4||item.in<0||item.out-item.in<.05-1e-9||item.out>max+1e-6)throw new Error('The source range must be at least 0.05 seconds and fit the source media, with valid clip timing.');
    if(Timeline.end(item)>86400)throw new Error('The clip would extend past the 24-hour timeline limit.');
    for(const key of ['fadeIn','fadeOut'])if((item[key]??0)>Timeline.length(item)){item[key]=Timeline.length(item);warnings.push('The '+(key==='fadeIn'?'fade-in':'fade-out')+' was shortened to fit the clip.');}
    if(['start','source_in','source_out','speed','track_id'].some(key=>properties[key]!==undefined)&&(item.transitionFrom||clips.some(clip=>clip.transitionFrom===item.id)))warnings.push('Existing transitions were retained; review their overlap after changing timing or tracks.');
    result.after=snapshot(item);
  }else if(args.action==='split'){
    if(state.clips.length+state.audioClips.length>=10000)throw new Error('The project already has 10,000 clips.');requireNewId(state,operationId);const second=Timeline.split(state,item.id,kind,args.timeline_time,()=>operationId);if(!second)throw new Error('Split at least 0.05 seconds from either end of the clip.');result.after=snapshot(item);result.new_clip=snapshot(second);
  }else if(args.action==='duplicate'){
    if(state.clips.length+state.audioClips.length>=10000)throw new Error('The project already has 10,000 clips.');requireNewId(state,operationId);const copy=structuredClone(item);copy.id=operationId;copy.start=Timeline.end(item);delete copy.transitionFrom;if(Timeline.end(copy)>86400)throw new Error('The duplicate would extend past the 24-hour timeline limit.');clips.push(copy);result.after=snapshot(item);result.new_clip=snapshot(copy);
  }else if(args.action==='remove'){
    clips.splice(clips.indexOf(item),1);if(clips.some(clip=>clip.transitionFrom===item.id))warnings.push('A remaining clip refers to the removed transition; review its fade.');warnings.push('The source remains in the media library.');result.after=null;
  }else if(args.action==='dissolve'){
    const transition=Timeline.dissolve(state,item.id,kind,args.duration_seconds);if(!transition)throw new Error('Add another clip earlier on this track before creating a transition.');result.after=snapshot(item);result.transition=transition;
  }else if(args.action==='set_keyframe'||args.action==='delete_keyframe'){
    const time=frameTime(item,args),max=asset.kind==='image'?3600:asset.duration;if(!Number.isFinite(max)||time<0||time>max+1e-6)throw new Error('The keyframe time must fit the source media.');
    const frames=item.keyframes||[],index=frames.findIndex(frame=>Math.abs(frame.time-time)<.0005);
    if(args.action==='delete_keyframe'){
      if(index<0)throw new Error('There is no keyframe at that source time.');result.keyframe_removed={id:frames[index].id,time:frames[index].time};frames.splice(index,1);
    }else{
      const values=args.keyframe;if(!values||!Object.keys(values).length)throw new Error('Provide keyframe properties to update.');
      if(kind==='audio'&&Object.keys(values).some(key=>key!=='volume'))throw new Error('Audio keyframes support volume only.');
      if(index<0&&Object.keys(values).length===1&&values.creative_look===null)throw new Error('There is no captured creative look at that source time.');
      let frame;if(index<0){if(frames.length>=10000)throw new Error('This clip already has 10,000 keyframes.');requireNewId(state,operationId);frame={id:operationId,time};frames.push(frame);item.keyframes=frames;}else frame=frames[index];
      for(const [key,value]of Object.entries(values)){
        if(key==='creative_look'){if(value===null)delete frame.creativeLook;else{frame.creativeLook=CreativeFrames.validate(value);state.version=5;}}
        else frame[key]=value;
      }
      frames.sort((a,b)=>a.time-b.time);result.keyframe={id:frame.id,time:frame.time,properties:Object.keys(values)};
    }
    result.after=snapshot(item);
  }else throw new Error('Unknown timeline edit.');
  return result;
}

export async function editTimeline(args,signal){
  const perAction={update:['properties'],split:['timeline_time'],duplicate:[],remove:[],dissolve:['duration_seconds'],set_keyframe:['timeline_time','source_time','keyframe'],delete_keyframe:['timeline_time','source_time']},allowed=perAction[args.action];
  for(const field of ['properties','timeline_time','source_time','duration_seconds','keyframe'])if(args[field]!==undefined&&!allowed.includes(field))throw new Error(field+' does not apply to '+args.action+'.');
  if(args.action==='split'&&args.timeline_time===undefined)throw new Error('Provide timeline_time for the split.');
  if(args.action==='set_keyframe'&&args.keyframe===undefined)throw new Error('Provide keyframe properties to update.');
  if(!args.dry_run&&!args.operation_id)throw new Error('Provide a new UUIDv4 operation_id for a retry-safe edit.');
  const operationId=args.operation_id||crypto.randomUUID(),digest=opDigest(args),url='/api/projects/'+encodeURIComponent(args.project_id),project=await request(url,{signal});
  if(args.operation_id&&!args.dry_run){const previous=prior(project,args,digest);if(previous)return previous;}
  if(project.revision!==args.base_revision)throw Object.assign(new Error('This project changed. Read its latest revision before editing.'),{code:'REVISION_CONFLICT',currentRevision:project.revision});
  const state=Timeline.migrate(structuredClone(project.state),()=>crypto.randomUUID()),before=JSON.stringify(state),result=edit(state,args,operationId);
  if(state.version<5&&Timeline.requiresV5(state))state.version=5;
  const changed=before!==JSON.stringify(state);
  const response={...result,project_id:project.id,revision:project.revision,operation_id:operationId,dry_run:!!args.dry_run,changed,already_applied:false};
  if(args.dry_run||!changed)return response;
  const history=Array.isArray(state.agentTimelineOps)?state.agentTimelineOps.filter(entry=>entry&&typeof entry==='object').slice(-(maxReceipts-1)):[];
  history.push({id:operationId,project_id:project.id,digest,applied_revision:project.revision+1,result:{...result,operation_id:operationId,dry_run:false,changed:true}});state.agentTimelineOps=history;state.version=5;
  if(Buffer.byteLength(JSON.stringify({baseRevision:project.revision,state}))>2*1024*1024)throw new Error('The edit would exceed the 2 MiB project save limit.');
  const origin=serverUrl();try{const saved=await request(url,{method:'PUT',signal,headers:{Origin:origin,'X-Cliproom-Request':'1','Content-Type':'application/json'},body:JSON.stringify({baseRevision:project.revision,state})});return {...response,revision:saved.revision,applied_revision:saved.revision};}
  catch(error){if(error.status===409&&args.operation_id){const latest=await request(url,{signal}),previous=prior(latest,args,digest);if(previous)return previous;}throw error;}
}
export {request,opDigest,prior,idInUse,maxReceipts};
