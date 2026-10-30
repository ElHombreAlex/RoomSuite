'use strict';
const $=id=>document.getElementById(id), escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current=null, dirty=false, serial=0, timer=0, saving=null, conflict=false, folders=[];
async function api(path,method='GET',body){const r=await RoomShared.request(path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return r.json();}
function status(text){$('saveStatus').textContent=text;$('sidebarStatus').textContent=current?'':text;$('saveCopy').classList.toggle('hidden',!conflict);$('reload').classList.toggle('hidden',!conflict);}
function fields(){return {title:$('title').value.trim()||'Untitled note',body:$('body').value,folder:$('noteFolder').value,tags:[...new Set($('tags').value.split(',').map(x=>x.trim()).filter(Boolean))]};}
async function loadFolders(){const data=await api('/api/notes/folders');folders=data.folders;const filter=$('folderFilter').value,note=$('noteFolder').value;
  $('folderFilter').replaceChildren(new Option('All notes','*'),new Option('Unfiled',''));$('noteFolder').replaceChildren(new Option('Unfiled',''));
  for(const item of folders){$('folderFilter').add(new Option(item,item));$('noteFolder').add(new Option(item,item));}$('folderFilter').value=[...$('folderFilter').options].some(o=>o.value===filter)?filter:'*';$('noteFolder').value=[...$('noteFolder').options].some(o=>o.value===note)?note:'';}
async function loadList(){const query=new URLSearchParams();if($('search').value.trim())query.set('search',$('search').value.trim());if($('folderFilter').value!=='*')query.set('folder',$('folderFilter').value);
  const data=await api('/api/notes?'+query),root=$('notesList');root.replaceChildren();
  if(!data.notes.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No notes here yet.';root.append(empty);}
  for(const note of data.notes){const button=document.createElement('button');button.className='note-item'+(current?.id===note.id?' active':'');button.type='button';const name=document.createElement('strong');name.textContent=note.title;const detail=document.createElement('small');detail.textContent=[note.folder||'Unfiled',...(note.tags||[]).map(t=>'#'+t)].join(' · ');button.append(name,detail);button.onclick=()=>openNote(note.id);root.append(button);}}
function display(note){current=note;dirty=false;conflict=false;serial++;$('empty').classList.add('hidden');$('editor').classList.remove('hidden');$('title').value=note.title;$('body').value=note.body;$('tags').value=note.tags.join(', ');$('noteFolder').value=note.folder;status('Saved');renderPreview();}
async function flush(){clearTimeout(timer);if(saving){await saving;if(dirty&&!conflict)return flush();return !dirty;}if(!current||!dirty)return true;if(conflict)return false;
  const id=current.id,version=serial,snapshot=fields(),baseRevision=current.revision;status('Saving…');
  saving=(async()=>{try{const saved=await api('/api/notes/'+id,'PUT',{baseRevision,...snapshot});if(current?.id===id){current=saved;if(serial===version){dirty=false;status('Saved');}else status('Saving changes…');}await loadFolders();await loadList();return true;}
    catch(error){if(error.message.includes('changed on another device')){conflict=true;status('Changed on another device. Save your version as a copy or reload.');}else status('Could not save: '+error.message);return false;}})();
  const success=await saving;saving=null;if(success&&dirty&&!conflict)return flush();return success&&!dirty;}
function changed(){if(!current)return;dirty=true;serial++;status('Unsaved changes');renderPreview();clearTimeout(timer);timer=setTimeout(flush,800);}
async function openNote(id){if(!await flush())return;try{const note=await api('/api/notes/'+id);await loadFolders();display(note);await loadList();}catch(error){status(error.message);}}
async function createNote(values={}){if(!await flush())return;try{const initial={title:'Untitled note',body:'',folder:$('folderFilter').value==='*'?'':$('folderFilter').value,tags:[],...values};const note=await api('/api/notes','POST',initial);await loadFolders();display(note);await loadList();$('title').focus();}catch(error){status(error.message);}}
function inline(value){return escapeHTML(value).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/(?!\/)[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');}
function markdown(text){const lines=text.replace(/\r\n/g,'\n').split('\n'),out=[];let list=false,code=false,block=[];
  const closeList=()=>{if(list){out.push('</ul>');list=false;}};
  for(const line of lines){if(/^```/.test(line)){closeList();if(code){out.push('<pre><code>'+escapeHTML(block.join('\n'))+'</code></pre>');block=[];code=false;}else code=true;continue;}if(code){block.push(line);continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line),bullet=/^\s*[-*]\s+(.+)$/.exec(line),quote=/^>\s?(.*)$/.exec(line);
    if(bullet){if(!list){out.push('<ul>');list=true;}out.push('<li>'+inline(bullet[1])+'</li>');continue;}closeList();
    if(heading)out.push('<h'+heading[1].length+'>'+inline(heading[2])+'</h'+heading[1].length+'>');else if(quote)out.push('<blockquote>'+inline(quote[1])+'</blockquote>');else if(line.trim())out.push('<p>'+inline(line)+'</p>');}
  closeList();if(code)out.push('<pre><code>'+escapeHTML(block.join('\n'))+'</code></pre>');return out.join('');}
function renderPreview(){$('preview').innerHTML=markdown($('body').value);}
for(const id of ['title','body','tags'])$(id).addEventListener('input',changed);$('noteFolder').addEventListener('change',changed);
$('writeTab').onclick=()=>{$('body').classList.remove('hidden');$('preview').classList.add('hidden');};$('previewTab').onclick=()=>{renderPreview();$('body').classList.add('hidden');$('preview').classList.remove('hidden');};
$('newNote').onclick=()=>createNote();$('emptyNew').onclick=()=>createNote();$('folderFilter').onchange=loadList;
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadList,200);};
$('newFolder').onclick=async()=>{const name=prompt('Folder name or nested path, such as Work/Projects');if(!name)return;try{await api('/api/notes/folders','POST',{path:name});await loadFolders();$('folderFilter').value=name;await loadList();}catch(e){status(e.message);alert(e.message);}};
$('deleteFolder').onclick=async()=>{const folder=$('folderFilter').value;if(!folder||folder==='*')return alert('Select a folder first.');if(!confirm('Delete the empty folder “'+folder+'”?'))return;try{await api('/api/notes/folders','DELETE',{path:folder});await loadFolders();await loadList();}catch(e){alert(e.message);}};
$('deleteNote').onclick=async()=>{if(!current||!await flush())return;if(!confirm('Delete “'+current.title+'”? This cannot be undone.'))return;try{await api('/api/notes/'+current.id,'DELETE',{baseRevision:current.revision});current=null;dirty=false;conflict=false;$('editor').classList.add('hidden');$('empty').classList.remove('hidden');await loadList();}catch(e){status(e.message);}};
$('saveCopy').onclick=async()=>{if(!current)return;try{const saved=await api('/api/notes','POST',fields());await loadFolders();display(saved);await loadList();}catch(e){status(e.message);}};
$('reload').onclick=async()=>{if(current&&confirm('Discard the unsaved version and reload the saved note?')){dirty=false;conflict=false;await openNote(current.id);}};
$('copyLink').onclick=async()=>{if(!current)return;const url=location.origin+'/notesroom/?'+new URLSearchParams({note:current.id});try{await navigator.clipboard.writeText(url);status('Note link copied.');}catch{prompt('Copy the note link:',url);}};
$('importShared').onclick=async()=>{try{const file=await RoomShared.choose(['.md','.txt']);if(file)await createNote({title:file.name.replace(/\.[^.]+$/,''),body:await file.text()});}catch(e){status(e.message);}};
$('saveShared').onclick=async()=>{if(!current)return;try{const file=($('title').value.trim()||'note').replace(/[\\/:*?"<>|]/g,'-')+'.md';const saved=await RoomShared.save(new Blob([$('body').value],{type:'text/markdown'}),file);if(saved)status('Saved to shared files: '+saved);}catch(e){status(e.message);}};
window.addEventListener('beforeunload',event=>{if(dirty||saving){event.preventDefault();event.returnValue='';}});
(async()=>{try{await loadFolders();await loadList();const query=new URLSearchParams(location.search),id=query.get('note');if(id){history.replaceState(null,'',location.pathname);await openNote(id);}else{const file=await RoomShared.fromQuery();if(file)await createNote({title:file.name.replace(/\.[^.]+$/,''),body:await file.text()});}}catch(error){status(error.message);}})();
