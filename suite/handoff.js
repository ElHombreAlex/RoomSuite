'use strict';
// Explicit handoff: uploads only when the user chooses Send to Cliproom.
window.RoomHandoff = {
  async send(blob, filename, duration, status, link, editable = null) {
    status.textContent = 'Sending your media to the Cliproom server…';
    status.classList.remove('error');
    link.classList.add('hidden');
    try {
      async function upload(content,name,id){const response=await fetch(id?'/api/assets/'+encodeURIComponent(id)+'/idempotent':'/api/assets',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Cliproom-Request':'1','X-File-Type':content.type.split(';')[0],'X-File-Name':encodeURIComponent(name)},body:content}),data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not send this file.');return data;}
      let source;if(editable){source=await upload(editable.source,editable.sourceName,editable.sourceId);status.textContent='Source uploaded. Sending the processed audio…';}
      let data;try{data=await upload(blob,filename,editable?.processedId);}catch(error){if(source)throw new Error(error.message+' The uploaded source remains in the server media library.');throw error;}
      const query = new URLSearchParams({ asset: data.id, duration: String(duration) });
      if(editable){query.set('source_asset',source.id);query.set('processing',JSON.stringify(editable.processing));}
      link.href = '/cliproom/?' + query.toString();
      link.classList.remove('hidden');
      status.textContent = 'Ready in Cliproom. Open it to add this media to a new project.';
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
  }
};
