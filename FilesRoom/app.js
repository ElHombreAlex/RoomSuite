'use strict';
const $=id=>document.getElementById(id);let folder='',refreshId=0,searchTimer;
let movingItem=null,moveFolder='',moveRequest=0,moveBusy=false,draggedItem=null;
const formatSize=n=>n>=1024*1024*1024?(n/1024/1024/1024).toFixed(1)+' GB':n>=1024*1024?(n/1024/1024).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';
function message(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
async function action(url,data){return (await RoomShared.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();}
const parentPath=path=>path.split('/').slice(0,-1).join('/');
function moveProblem(item,destination){
  if(destination===parentPath(item.path))return 'This item is already in that folder.';
  if(item.type==='folder'&&(destination===item.path||destination.startsWith(item.path+'/')))return 'A folder cannot be moved inside itself.';
  return '';
}
async function moveTo(item,destination,dialog=false){
  const problem=moveProblem(item,destination);if(problem){if(dialog)$('moveStatus').textContent=problem;else message(problem,true);return;}
  if(moveBusy)return;moveBusy=true;$('moveHere').disabled=true;$('moveCancel').disabled=true;$('moveClose').disabled=true;$('moveRoot').disabled=true;$('moveUp').disabled=true;$('moveFolders').querySelectorAll('button').forEach(button=>{button.disabled=true;});
  try{const to=destination?destination+'/'+item.name:item.name;await action('/api/workspace/move',{from:item.path,to});
    if(dialog&&$('moveDialog').open)$('moveDialog').close();await refresh();message('Moved “'+item.name+'” to '+(destination||'Shared files')+'.');
  }catch(error){if(dialog&&$('moveDialog').open)$('moveStatus').textContent=error.message;else message(error.message,true);}
  finally{moveBusy=false;$('moveCancel').disabled=false;$('moveClose').disabled=false;if(dialog&&$('moveDialog').open){$('moveRoot').disabled=!moveFolder;$('moveUp').disabled=!moveFolder;$('moveFolders').querySelectorAll('button').forEach(button=>{button.disabled=false;});$('moveHere').disabled=!!moveProblem(item,moveFolder);}}
}
async function browseMove(destination){
  if(moveBusy)return;const request=++moveRequest;$('moveStatus').textContent='Loading folders…';$('moveHere').disabled=true;$('moveFolders').replaceChildren();
  try{const result=await RoomShared.list(destination);if(request!==moveRequest||!$('moveDialog').open)return;moveFolder=result.path;$('movePath').textContent='Shared files'+(moveFolder?' / '+moveFolder:'');$('moveRoot').disabled=!moveFolder;$('moveUp').disabled=!moveFolder;
    const root=$('moveFolders'),folders=result.entries.filter(item=>item.type==='folder'&&!(movingItem.type==='folder'&&(item.path===movingItem.path||item.path.startsWith(movingItem.path+'/'))));
    if(!folders.length){const empty=document.createElement('p');empty.className='move-empty';empty.textContent='No subfolders here.';root.append(empty);}
    for(const item of folders){const button=document.createElement('button');button.type='button';button.className='move-folder';button.textContent='▣  '+item.name;button.setAttribute('aria-label','Open folder '+item.name);button.onclick=()=>browseMove(item.path);root.append(button);}
    $('moveStatus').textContent=moveProblem(movingItem,moveFolder);$('moveHere').disabled=!!moveProblem(movingItem,moveFolder);
  }catch(error){if(request===moveRequest&&$('moveDialog').open)$('moveStatus').textContent=error.message;}
}
function openMove(item){if(moveBusy)return;movingItem=item;$('moveTitle').textContent='Move “'+item.name+'”';$('moveDialog').showModal();void browseMove(parentPath(item.path));}
function dropTarget(element,destination){
  element.addEventListener('dragover',event=>{if(!draggedItem||moveBusy||moveProblem(draggedItem,destination))return;event.preventDefault();event.dataTransfer.dropEffect='move';element.classList.add('drop-target');});
  element.addEventListener('dragleave',event=>{if(!element.contains(event.relatedTarget))element.classList.remove('drop-target');});
  element.addEventListener('drop',event=>{element.classList.remove('drop-target');if(!draggedItem)return;event.preventDefault();const item=draggedItem;draggedItem=null;void moveTo(item,destination);});
}
function choices(name){const ext=name.split('.').pop().toLowerCase(), out=[];
  if(['png','jpg','jpeg','webp','gif','avif'].includes(ext))out.push(['PaintRoom','/paintroom/'],['PixelRoom','/pixelroom/'],['VectorRoom','/vectorroom/'],['CaptureRoom','/captureroom/'],['Cliproom','/cliproom/']);
  if(['paintroom'].includes(ext))out.push(['PaintRoom','/paintroom/']);if(['pixelroom'].includes(ext))out.push(['PixelRoom','/pixelroom/']);if(['vectorroom'].includes(ext))out.push(['VectorRoom','/vectorroom/']);
  if(['mp3','wav','m4a','ogg','flac'].includes(ext))out.push(['SoundRoom','/soundroom/'],['Cliproom','/cliproom/']);
  if(['mp4','webm','mov','m4v'].includes(ext))out.push(['Cliproom','/cliproom/']);if(['md','txt'].includes(ext))out.push(['NotesRoom','/notesroom/']);
  if(['docsuite','docx'].includes(ext))out.push(['DocSuite','/docsuite/']);if(['gridsuite','csv','xlsx'].includes(ext))out.push(['GridSuite','/gridsuite/']);if(['decksuite','pptx'].includes(ext))out.push(['DeckSuite','/decksuite/']);if(ext==='plansuite')out.push(['PlanSuite','/plansuite/']);return out;}
async function refresh(){
  const requestId=++refreshId,query=$('search').value.trim();
  try{const [result,usage]=await Promise.all([query?RoomShared.request('/api/workspace/search?'+new URLSearchParams({q:query})).then(r=>r.json()):RoomShared.list(folder),RoomShared.request('/api/workspace/info').then(r=>r.json())]);if(requestId!==refreshId)return;if(!query)folder=result.path;$('currentFolder').textContent=query?'Search results':folder||'Shared files';$('up').disabled=!folder;
    $('usage').textContent=formatSize(usage.used_bytes)+' of '+formatSize(usage.max_storage_bytes);$('usageBar').style.width=Math.min(100,usage.used_bytes/usage.max_storage_bytes*100)+'%';
    const root=$('list');root.replaceChildren();if(query)message(result.truncated?'Results are limited. Try a more specific search.':result.entries.length+' result'+(result.entries.length===1?'':'s')+'.');if(!result.entries.length){const empty=document.createElement('div');empty.className='file-empty';empty.textContent=query?'No shared files match this search.':'This folder is empty. Upload something or create a folder to get started.';root.append(empty);}
    for(const item of result.entries){const row=document.createElement('div');row.className='file-row';row.draggable=true;row.addEventListener('dragstart',event=>{if(event.target.closest('button,select,a')){event.preventDefault();return;}draggedItem=item;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.name);row.classList.add('dragging');});row.addEventListener('dragend',()=>{draggedItem=null;row.classList.remove('dragging');document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});if(item.type==='folder')dropTarget(row,item.path);const icon=document.createElement('span');icon.className='file-icon';icon.textContent=item.type==='folder'?'▣':'▧';const main=document.createElement('div');main.className='file-main';const title=document.createElement('strong');title.textContent=query?item.path:item.name;const sub=document.createElement('small');sub.textContent=(item.type==='folder'?'Folder':formatSize(item.bytes))+' · '+new Date(item.updatedAt).toLocaleString();main.append(title,sub);const buttons=document.createElement('div');buttons.className='file-actions';
      if(item.type==='folder'){const open=document.createElement('button');open.className='btn small';open.textContent='Open';open.onclick=()=>{folder=item.path;$('search').value='';refresh();};buttons.append(open);}else{
        const download=document.createElement('a');download.className='btn small';download.textContent='Download';download.href='/api/workspace/file?'+new URLSearchParams({path:item.path});download.download=item.name;buttons.append(download);
        const destinations=choices(item.name);if(destinations.length){const select=document.createElement('select');select.setAttribute('aria-label','Open '+item.name+' in');select.add(new Option('Open in…',''));for(const [name,url]of destinations)select.add(new Option(name,url));select.onchange=()=>{if(select.value){window.open(select.value+'?'+new URLSearchParams({shared_file:item.path}),'_blank','noopener');select.value='';}};buttons.append(select);}}
      const rename=document.createElement('button');rename.className='btn small';rename.textContent='Rename';rename.onclick=async()=>{const value=prompt('New name',item.name);if(!value||value===item.name)return;try{const parent=item.path.split('/').slice(0,-1).join('/');await action('/api/workspace/move',{from:item.path,to:parent?parent+'/'+value:value});message('Renamed.');await refresh();}catch(e){message(e.message,true);}};
      const move=document.createElement('button');move.className='btn small';move.textContent='Move';move.setAttribute('aria-label','Move '+item.name);move.onclick=()=>openMove(item);
      const remove=document.createElement('button');remove.className='btn small danger';remove.textContent='Delete';remove.onclick=async()=>{if(!confirm('Delete “'+item.name+'”'+(item.type==='folder'?' and everything inside it':'')+'? This cannot be undone.'))return;try{await action('/api/workspace/delete',{path:item.path,recursive:item.type==='folder'});message('Deleted.');await refresh();}catch(e){message(e.message,true);}};
      buttons.append(rename,move,remove);row.append(icon,main,buttons);root.append(row);
    }
  }catch(e){message(e.message,true);}}
$('up').onclick=()=>{folder=folder.split('/').slice(0,-1).join('/');$('search').value='';refresh();};
$('up').addEventListener('dragover',event=>{if(!folder||!draggedItem||moveBusy||moveProblem(draggedItem,parentPath(folder)))return;event.preventDefault();event.dataTransfer.dropEffect='move';$('up').classList.add('drop-target');});
$('up').addEventListener('dragleave',()=>$('up').classList.remove('drop-target'));
$('up').addEventListener('drop',event=>{$('up').classList.remove('drop-target');if(!draggedItem||!folder)return;event.preventDefault();const item=draggedItem;draggedItem=null;void moveTo(item,parentPath(folder));});
$('moveRoot').onclick=()=>browseMove('');$('moveUp').onclick=()=>browseMove(parentPath(moveFolder));$('moveHere').onclick=()=>{if(movingItem)void moveTo(movingItem,moveFolder,true);};
$('moveCancel').onclick=$('moveClose').onclick=()=>{if(!moveBusy)$('moveDialog').close();};$('moveDialog').addEventListener('cancel',event=>{if(moveBusy)event.preventDefault();});$('moveDialog').addEventListener('close',()=>{moveRequest++;movingItem=null;});
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(refresh,200);};
$('newFolder').onclick=async()=>{const name=prompt('New folder name');if(!name)return;try{await action('/api/workspace/folder',{path:folder?folder+'/'+name:name});message('Folder created.');await refresh();}catch(e){message(e.message,true);}};
$('upload').onchange=async event=>{const files=[...event.target.files];event.target.value='';if(!files.length)return;for(const file of files){try{message('Uploading '+file.name+'…');await RoomShared.put(file,folder?folder+'/'+file.name:file.name);}catch(error){message('Could not upload '+file.name+': '+error.message,true);await refresh();return;}}message(files.length+' file'+(files.length===1?'':'s')+' uploaded.');await refresh();};
refresh();
