'use strict';
const $=id=>document.getElementById(id), canvas=$('stage');
let project=null,prepared=[],selected=0,time=0,playing=false,playStart=0,playOffset=0,raf=0,busy=false,loading=false,abortExport=null,dirty=false,undo=[],redo=[],gesture=null;
const layer=()=>project?.layers[selected], clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const nameFor=()=>((project?.name||'motion').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').slice(0,120)||'motion');
const snapshot=()=>JSON.stringify({name:project.name,duration:project.duration,layers:project.layers});
function record(before){if(before===snapshot())return;undo.push(before);if(undo.length>50)undo.shift();redo=[];dirty=true;$('openCliproom').classList.add('hidden');}
function change(fn){if(!project||busy||loading)return;const before=snapshot();fn();record(before);render();}
function restore(value){const previous=JSON.parse(value);project.name=previous.name;project.duration=previous.duration;project.layers=previous.layers;time=Math.min(time,project.duration);selected=Math.min(selected,project.layers.length-1);dirty=true;$('openCliproom').classList.add('hidden');render();}
function currentFrame(){return layer()?.keyframes.find(frame=>Math.abs(frame.time-time)<.005);}
function inheritedEase(){const frames=layer()?.keyframes||[];return currentFrame()?.easing||[...frames].reverse().find(frame=>frame.time<time)?.easing||'linear';}
function pause(){playing=false;cancelAnimationFrame(raf);$('play').textContent='▶ Play';}
function draw(){if(project)MotionRenderer.draw(canvas,project,prepared,time);}
function render(){
  const ready=!!project,hasLayer=!!layer(),disabled=busy||loading;$('stageEmpty').classList.toggle('hidden',ready);$('projectName').disabled=!ready||disabled;$('projectName').value=project?.name||'Untitled motion';
  $('layerCount').textContent=project?.layers.length||0;$('sourceLabel').textContent=project?(project.sourceType==='paint'?'PAINTROOM ARTWORK':'VECTORROOM ARTWORK'):'No artwork yet';
  for(const id of ['saveProject','saveShared','editSource','exportVideo','sendCliproom','seek','duration','play'])$(id).disabled=!ready||disabled;
  for(const id of ['openFile','openShared','importFile','importShared','startImport'])$(id).disabled=disabled;
  $('undo').disabled=!ready||disabled||!undo.length;$('redo').disabled=!ready||disabled||!redo.length;
  $('properties').disabled=!hasLayer||disabled;$('cancelExport').classList.toggle('hidden',!busy);$('layerCount').textContent=project?.layers.length||0;
  $('layers').replaceChildren();
  if(!ready){const empty=document.createElement('div');empty.className='empty';empty.textContent='Import artwork to see its layers here.';$('layers').append(empty);$('selectionLabel').textContent='Select a layer to begin.';return;}
  [...project.layers].map((item,index)=>({item,index})).reverse().forEach(({item,index})=>{
    const row=document.createElement('div');row.className='motion-layer'+(index===selected?' active':'');
    const visible=document.createElement('input');visible.type='checkbox';visible.checked=item.visible;visible.disabled=disabled;visible.setAttribute('aria-label','Show '+item.name);visible.onchange=()=>change(()=>{item.visible=visible.checked;});
    const button=document.createElement('button');button.textContent=item.name||'Untitled layer';button.disabled=disabled;button.onclick=()=>{pause();selected=index;render();};row.append(visible,button);$('layers').append(row);
  });
  $('selectionLabel').textContent=hasLayer?layer().name:'Select a layer to begin.';
  $('duration').value=project.duration;$('seek').max=project.duration;$('seek').value=time;$('rulerEnd').textContent=project.duration+'s';$('timeLabel').textContent=time.toFixed(2)+' / '+project.duration.toFixed(2)+' s';
  const frame=currentFrame(),value=MotionModel.sample(layer(),time);for(const key of ['x','y','rotation'])$(key).value=Math.round(value[key]*100)/100;$('scale').value=Math.round(value.scale*10000)/100;$('opacity').value=Math.round(value.opacity*10000)/100;$('easing').value=inheritedEase();
  $('keyframeState').textContent=frame?'Keyframe':'Between frames';$('deleteKey').disabled=!frame;$('previous').disabled=disabled||!layer().keyframes.some(item=>item.time<time-.005);$('next').disabled=disabled||!layer().keyframes.some(item=>item.time>time+.005);
  $('markers').replaceChildren();for(const item of layer().keyframes){const marker=document.createElement('button');marker.className='marker'+(frame===item?' current':'');marker.textContent='◆';marker.style.left=(item.time/project.duration*100)+'%';marker.title='Keyframe at '+item.time.toFixed(2)+' seconds';marker.setAttribute('aria-label',marker.title);marker.disabled=disabled;marker.onclick=()=>{pause();time=item.time;render();};$('markers').append(marker);}
  draw();
}
async function load(file){
  if(!file||busy||loading)return;if(dirty&&!confirm('Discard unsaved motion changes and open another project?'))return;
  if(file.size>40*1024*1024)throw new Error('Project files must be 40 MiB or smaller.');
  pause();loading=true;render();status('Preparing artwork…');
  try{const input=JSON.parse(await file.text());const next=input.format==='motionroom'?MotionModel.validate(input):MotionModel.validate(MotionModel.create(input));
    const nextPrepared=await MotionRenderer.prepare(next);project=next;prepared=nextPrepared;selected=0;time=0;dirty=false;undo=[];redo=[];$('openSource').classList.add('hidden');$('openCliproom').classList.add('hidden');status('Artwork ready. Select a layer and add keyframes.');
  }finally{loading=false;render();}
}
async function loadSafely(file){try{await load(file);}catch(error){status('Could not open project: '+error.message,true);}}
function projectBlob(){const blob=new Blob([JSON.stringify(MotionModel.validate(project))],{type:'application/json'});if(blob.size>40*1024*1024)throw new Error('The motion project is larger than the 40 MiB reopen limit. Reduce the artwork size or number of keyframes.');return blob;}
$('startImport').onclick=$('importFile').onclick=()=>$('artworkFile').click();$('openFile').onclick=()=>$('projectFile').click();
for(const id of ['artworkFile','projectFile'])$(id).onchange=event=>{const file=event.target.files[0];event.target.value='';void loadSafely(file);};
for(const [id,accept] of [['importShared',['.paintroom','.vectorroom']],['openShared',['.motionroom','.paintroom','.vectorroom']]])$(id).onclick=async()=>{try{const file=await RoomShared.choose(accept);if(file)await load(file);}catch(error){status(error.message,true);}};
$('saveProject').onclick=()=>{try{download(projectBlob(),nameFor()+'.motionroom');dirty=false;status('Editable motion project downloaded.');}catch(error){status(error.message,true);}};
$('saveShared').onclick=async()=>{try{const before=snapshot(),path=await RoomShared.save(projectBlob(),nameFor()+'.motionroom');if(path){if(before===snapshot())dirty=false;status('Motion project saved to shared files: '+path);}}catch(error){status(error.message,true);}};
$('editSource').onclick=async()=>{try{const kind=project.sourceType==='paint'?'paintroom':'vectorroom',blob=new Blob([JSON.stringify(project.source)],{type:'application/json'}),path=await RoomShared.save(blob,nameFor()+'.'+kind);if(path){$('openSource').href='/'+kind+'/?'+new URLSearchParams({shared_file:path});$('openSource').classList.remove('hidden');status('Artwork saved. Open it in '+(kind==='paintroom'?'PaintRoom':'VectorRoom')+'.');}}catch(error){status(error.message,true);}};
$('projectName').onchange=()=>change(()=>{project.name=$('projectName').value.trim().slice(0,160)||'Untitled motion';});
$('duration').onchange=()=>{const raw=Number($('duration').value),next=Math.round(raw*1000)/1000;if(!Number.isFinite(raw)||next<.1||next>60){status('Choose a duration between 0.1 and 60 seconds.',true);return render();}if(project.layers.some(item=>item.keyframes.some(frame=>frame.time>next))){status('Delete keyframes beyond the new duration first.',true);return render();}change(()=>{project.duration=next;time=Math.min(time,next);});};
$('seek').oninput=()=>{if(busy)return;pause();time=Number($('seek').value);render();};
$('previous').onclick=()=>{const frame=[...layer().keyframes].reverse().find(item=>item.time<time-.005);if(frame){pause();time=frame.time;render();}};
$('next').onclick=()=>{const frame=layer().keyframes.find(item=>item.time>time+.005);if(frame){pause();time=frame.time;render();}};
$('play').onclick=()=>{if(playing){pause();render();return;}if(time>=project.duration)time=0;playing=true;playStart=performance.now();playOffset=time;$('play').textContent='❚❚ Pause';function tick(now){if(!playing)return;time=Math.min(project.duration,playOffset+(now-playStart)/1000);$('seek').value=time;$('timeLabel').textContent=time.toFixed(2)+' / '+project.duration.toFixed(2)+' s';draw();if(time>=project.duration){pause();render();}else raf=requestAnimationFrame(tick);}raf=requestAnimationFrame(tick);};
$('properties').addEventListener('focusin',()=>{if(playing){pause();render();}});
$('addKey').onclick=()=>{pause();change(()=>MotionModel.setFrame(layer(),time,MotionModel.sample(layer(),time),inheritedEase()));status('Keyframe added. Change its properties or move the playhead.');};
$('deleteKey').onclick=()=>{pause();const frame=currentFrame();if(frame)change(()=>{layer().keyframes=layer().keyframes.filter(item=>item!==frame);});};
for(const key of ['x','y','scale','rotation','opacity','easing'])$(key).onchange=()=>{pause();const values=MotionModel.sample(layer(),time),limits={x:[-100000,100000],y:[-100000,100000],scale:[1,1000],rotation:[-36000,36000],opacity:[0,100]};let easing=inheritedEase();if(key==='easing')easing=$('easing').value;else{let value=Number($(key).value);if(!Number.isFinite(value))return render();value=clamp(value,...limits[key]);values[key]=['scale','opacity'].includes(key)?value/100:value;}change(()=>MotionModel.setFrame(layer(),time,values,easing));};
$('undo').onclick=()=>{if(!undo.length||busy)return;pause();redo.push(snapshot());restore(undo.pop());};$('redo').onclick=()=>{if(!redo.length||busy)return;pause();undo.push(snapshot());restore(redo.pop());};
canvas.addEventListener('pointerdown',event=>{if(!project||busy||loading||event.button!==0)return;pause();const box=canvas.getBoundingClientRect();gesture={id:event.pointerId,startX:event.clientX,startY:event.clientY,width:box.width,height:box.height,values:MotionModel.sample(layer(),time),ease:inheritedEase(),before:snapshot(),moved:false};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointermove',event=>{if(!gesture||gesture.id!==event.pointerId)return;const dx=(event.clientX-gesture.startX)/gesture.width*project.width,dy=(event.clientY-gesture.startY)/gesture.height*project.height;if(!gesture.moved&&Math.hypot(dx,dy)<1)return;gesture.moved=true;MotionModel.setFrame(layer(),time,{...gesture.values,x:clamp(gesture.values.x+dx,-100000,100000),y:clamp(gesture.values.y+dy,-100000,100000)},gesture.ease);render();});
function finishGesture(event,cancelled=false){if(!gesture||gesture.id!==event.pointerId)return;if(cancelled){const previous=JSON.parse(gesture.before);project.layers=previous.layers;}else if(gesture.moved)record(gesture.before);gesture=null;render();}
canvas.addEventListener('pointerup',event=>finishGesture(event));canvas.addEventListener('pointercancel',event=>finishGesture(event,true));
async function recordVideo(){
  if(!canvas.captureStream||!window.MediaRecorder)throw new Error('This browser cannot record the animation. Use a browser with WebM recording support.');
  const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));if(!mime)throw new Error('This browser cannot record WebM video.');
  pause();const oldTime=time;time=0;draw();const stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:mime}),chunks=[];let cancelled=false,frameId=0,draws=0,reason='Export cancelled.';
  abortExport=message=>{cancelled=true;reason=message||reason;cancelAnimationFrame(frameId);if(recorder.state!=='inactive')recorder.stop();};
  const onHidden=()=>{if(document.hidden)abortExport('Export stopped because the tab was hidden. Keep MotionRoom visible while recording.');};document.addEventListener('visibilitychange',onHidden);
  try{
    const done=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onerror=event=>reject(event.error||new Error('Video recording failed.'));recorder.onstop=()=>cancelled?reject(new Error(reason)):resolve();});
    recorder.start();const start=performance.now();
    function step(now){if(cancelled)return;time=Math.min(project.duration,(now-start)/1000);draw();draws++;$('timeLabel').textContent='Exporting '+time.toFixed(1)+' / '+project.duration.toFixed(1)+' s';if(time>=project.duration)recorder.stop();else frameId=requestAnimationFrame(step);}
    frameId=requestAnimationFrame(step);await done;let blob=new Blob(chunks,{type:'video/webm'});if(!blob.size)throw new Error('The browser produced an empty video. Try another browser.');try{blob=await RoomWebM.withDuration(blob,project.duration);}catch{}return {blob,slow:draws<project.duration*24};
  }finally{cancelAnimationFrame(frameId);document.removeEventListener('visibilitychange',onHidden);stream.getTracks().forEach(track=>track.stop());abortExport=null;time=oldTime;}
}
async function exportVideo(send){
  if(!project||busy)return;busy=true;$('openCliproom').classList.add('hidden');render();status('Recording your animation in real time…');
  try{const result=await recordVideo();$('cancelExport').classList.add('hidden');if(send){await RoomHandoff.send(result.blob,nameFor()+'.webm',project.duration,$('status'),$('openCliproom'));if(result.slow&&!$('openCliproom').classList.contains('hidden'))$('status').textContent+=' The recording was slow and may be missing frames.';}else{download(result.blob,nameFor()+'.webm');status(result.slow?'WebM exported, but recording was slow and may be missing frames.':'WebM video exported.');}}
  catch(error){status(error.message,true);}finally{busy=false;render();}
}
$('exportVideo').onclick=()=>exportVideo(false);$('sendCliproom').onclick=()=>exportVideo(true);$('cancelExport').onclick=()=>abortExport?.();
window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
render();(async()=>{try{const file=await RoomShared.fromQuery({maxBytes:40*1024*1024});if(file)await load(file);}catch(error){status(error.message,true);}})();
