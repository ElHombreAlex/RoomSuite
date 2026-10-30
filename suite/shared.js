'use strict';
(function () {
  const types = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',flac:'audio/flac',md:'text/markdown',txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',paintroom:'application/json',vectorroom:'application/json',pixelroom:'application/json',docsuite:'application/json',gridsuite:'application/json',decksuite:'application/json',plansuite:'application/json',json:'application/json'};
  const typeOf = name => types[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {}); if (options.method && options.method !== 'GET') headers.set('X-Cliproom-Request','1');
    const response = await fetch(url,{...options,headers});
    if (!response.ok) { const data=await response.json().catch(()=>({})); throw new Error(data.error || 'Shared files request failed.'); }
    return response;
  }
  async function list(path = '') { return (await request('/api/workspace/list?' + new URLSearchParams({path}))).json(); }
  async function get(path, options = {}) {
    const response = await request('/api/workspace/file?' + new URLSearchParams({path})), declared=Number(response.headers.get('content-length')||0);
    if(options.maxBytes&&declared>options.maxBytes){await response.body?.cancel();throw new Error('The shared file is too large to open here.');}
    const blob = await response.blob(), name = path.split('/').pop();if(options.maxBytes&&blob.size>options.maxBytes)throw new Error('The shared file is too large to open here.');
    return new File([blob],name,{type:typeOf(name)});
  }
  async function put(blob,path) { return (await request('/api/workspace/upload?' + new URLSearchParams({path}),{method:'POST',body:blob})).json(); }
  function valid(name, accept) {
    if (!accept || !accept.length) return true;
    const extension = '.' + name.split('.').pop().toLowerCase(), type = typeOf(name);
    return accept.some(rule => rule.startsWith('.') ? extension === rule.toLowerCase() : rule.endsWith('/*') ? type.startsWith(rule.slice(0,-1)) : type === rule);
  }
  let busy = false;
  async function picker({mode,accept,filename,blob,returnPath=false,selectOnly=false}) {
    if (busy) throw new Error('Finish the current shared-files selection first.');
    busy=true;
    const dialog=document.createElement('dialog'); dialog.className='shared-picker';
    dialog.innerHTML='<div class="shared-head"><div><p>ROOMSUITE WORKSPACE</p><h2></h2></div><button class="shared-close" aria-label="Close">×</button></div><p class="shared-path"></p><div class="shared-items"></div><label class="shared-name">File name<input maxlength="180"></label><p class="shared-status" role="status" aria-live="polite"></p><div class="shared-actions"><button class="shared-back">← Parent folder</button><button class="shared-cancel">Cancel</button><button class="shared-save">Save here</button></div>';
    document.body.append(dialog); const $=selector=>dialog.querySelector(selector), root=$('.shared-items'); let current='';
    $('.shared-head h2').textContent=mode==='save'?'Save to shared files':'Open shared file';
    $('.shared-name').hidden=mode!=='save'; $('.shared-save').hidden=mode!=='save'; $('.shared-name input').value=filename || '';
    return new Promise((resolve,reject) => {
      const finish = (value,error) => { if (!dialog.isConnected) return; dialog.close(); dialog.remove(); busy=false; error ? reject(error) : resolve(value); };
      const show = async next => {
        try {
          $('.shared-status').textContent='Loading…'; const data=await list(next); current=data.path; $('.shared-path').textContent='Shared files / ' + (current || '');
          $('.shared-back').disabled=!current; root.replaceChildren();
          const entries=data.entries.filter(item=>item.type==='folder' || (mode==='open' && valid(item.name,accept)));
          if (!entries.length) { const empty=document.createElement('p');empty.className='shared-empty';empty.textContent=mode==='save'?'No subfolders here.':'No matching files here.';root.append(empty); }
          for (const item of entries) {
            const button=document.createElement('button');button.className='shared-item';button.type='button';button.textContent=(item.type==='folder'?'📁  ':'▧  ')+item.name;
            button.addEventListener('click',async()=>{if(item.type==='folder')return show(item.path);try{$('.shared-status').textContent='Opening…';finish(returnPath?item.path:await get(item.path));}catch(e){$('.shared-status').textContent=e.message;}});root.append(button);
          }
          $('.shared-status').textContent='';
        } catch(error) { $('.shared-status').textContent=error.message; }
      };
      $('.shared-close').onclick=()=>finish(null);$('.shared-cancel').onclick=()=>finish(null);
      dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
      $('.shared-back').onclick=()=>show(current.split('/').slice(0,-1).join('/'));
      $('.shared-save').onclick=async()=>{const name=$('.shared-name input').value.trim();if(!name){$('.shared-status').textContent='Enter a file name.';return;}
        $('.shared-save').disabled=true;try{const path=current?current+'/'+name:name;if(!selectOnly){$('.shared-status').textContent='Saving…';await put(blob,path);}finish(path);}catch(error){$('.shared-status').textContent=error.message;}finally{if(dialog.isConnected)$('.shared-save').disabled=false;}};
      dialog.showModal(); void show('');
    });
  }
  async function fromQuery() {
    const query=new URLSearchParams(location.search), target=query.get('shared_file'); if (!target) return null;
    query.delete('shared_file'); const next=query.toString();history.replaceState(null,'',location.pathname+(next?'?'+next:'')+location.hash);
    return get(target);
  }
  window.RoomShared={request,list,get,put,typeOf,choose:accept=>picker({mode:'open',accept}),choosePath:accept=>picker({mode:'open',accept,returnPath:true}),chooseSavePath:filename=>picker({mode:'save',filename,selectOnly:true}),save:(blob,filename)=>picker({mode:'save',blob,filename}),fromQuery};
})();
