'use strict';
(function () {
  const G = window.RoomGrade, storageKey = 'roomsuite.color-presets.v1';
  const labels = { exposure_ev:'Exposure (EV)', temperature:'Temperature', tint:'Tint', highlights:'Highlights', shadows:'Shadows', whites:'Whites', blacks:'Blacks', vibrance:'Vibrance' };
  const openDetails={advanced:false,library:false,creative:false,curves:false,hsl:false,wheels:false,lut:false,effects:false};
  let selection = 'b:0', search = '', curveChannel='master', hslRange='red', wheelRegion='shadows';
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function wheelColor(hue,saturation){const i=Math.floor(hue*6),f=hue*6-i,p=1-saturation,q=1-f*saturation,t=1-(1-f)*saturation,values=[[1,t,p],[q,1,p],[p,1,t],[p,q,1],[t,p,1],[1,p,q]][i%6];return '#'+values.map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('');}
  let wheelBase;
  function drawWheel(canvas,color){
    const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,radius=Math.min(w,h)/2-2;
    if(!wheelBase){wheelBase=document.createElement('canvas');wheelBase.width=w;wheelBase.height=h;const ctx=wheelBase.getContext('2d'),img=ctx.createImageData(w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const dx=(x-w/2)/radius,dy=(y-h/2)/radius,s=Math.hypot(dx,dy),index=(y*w+x)*4;if(s>1)continue;const hex=wheelColor((Math.atan2(dy,dx)/(2*Math.PI)+1)%1,s);img.data[index]=parseInt(hex.slice(1,3),16);img.data[index+1]=parseInt(hex.slice(3,5),16);img.data[index+2]=parseInt(hex.slice(5,7),16);img.data[index+3]=255;}ctx.putImageData(img,0,0);}
    c.clearRect(0,0,w,h);c.drawImage(wheelBase,0,0);
    const r=parseInt(color.slice(1,3),16)/255,g=parseInt(color.slice(3,5),16)/255,b=parseInt(color.slice(5,7),16)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min,s=max?d/max:0;let hue=0;if(d)hue=(max===r?((g-b)/d+(g<b?6:0)):max===g?(b-r)/d+2:(r-g)/d+4)/6;
    const x=w/2+Math.cos(hue*2*Math.PI)*s*radius,y=h/2+Math.sin(hue*2*Math.PI)*s*radius;c.beginPath();c.arc(x,y,5,0,2*Math.PI);c.lineWidth=3;c.strokeStyle='#fff';c.stroke();c.lineWidth=1;c.strokeStyle='#222';c.stroke();
  }
  function readLibrary() {
    try {
      const stored = localStorage.getItem(storageKey); if (!stored || stored.length > G.maxBytes * 50) return [];
      const list = JSON.parse(stored); return Array.isArray(list) ? list.slice(0, 50).flatMap(item => { try { return [G.preset(item)]; } catch { return []; } }) : [];
    } catch { return []; }
  }
  function saveLibrary(items) {
    if (items.length > 50) throw new Error('The local library holds at most 50 presets.');
    try { localStorage.setItem(storageKey, JSON.stringify(items)); } catch { throw new Error('This browser could not save the local preset library.'); }
  }
  function download(preset) {
    const name = preset.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'RoomSuite-look';
    const url = URL.createObjectURL(new Blob([G.serializePreset(preset)], { type:'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = name + '.roomgrade'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file) {
    if (!file) return null;
    if (file.size > G.maxBytes) throw new Error('Preset files must be 2 MiB or smaller.');
    const item = G.parse(await file.text()), items = readLibrary(), existing = items.findIndex(value => JSON.stringify(value) === JSON.stringify(item));
    if (existing >= 0) selection = 'u:' + existing;
    else { items.push(item); saveLibrary(items); selection = 'u:' + (items.length - 1); }
    search = ''; openDetails.library = true; return item;
  }
  function capture(root) {
    if (!root) return;
    // A details element changes synchronously, but its toggle event is queued.
    for (const detail of root.querySelectorAll('[data-grade-details]')) openDetails[detail.dataset.gradeDetails] = detail.open;
  }
  function mount(root, adapter) {
    if (!root) return;
    // Capture before replacing the panel, even if toggle has not fired yet.
    capture(root);
    const grade = adapter.get(), user = readLibrary();
    const all = [...G.builtins.map((item, index) => ({ id:'b:' + index, item, kind:'Built in' })), ...user.map((item, index) => ({ id:'u:' + index, item, kind:'Saved' }))];
    const visible = all.filter(({item}) => (item.name + ' ' + item.tags.join(' ')).toLowerCase().includes(search.toLowerCase()));
    if (!visible.some(entry => entry.id === selection)) selection = visible[0]?.id || '';
    const options = visible.map(({id,item,kind}) => `<option value="${id}" ${id === selection ? 'selected' : ''}>${escape(item.name)} · ${kind}</option>`).join('');
    const sliders = G.advanced.map(key => {
      const [min,max] = G.specs[key], value = grade.adjustments[key], step = key === 'exposure_ev' ? '.1' : '1';
      return `<label class="grade-slider"><span>${labels[key]} <output data-grade-output="${key}">${value}</output></span><input data-grade-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    }).join('');
    const look=grade.look, select=(items,current)=>items.map(value=>`<option value="${value}" ${value===current?'selected':''}>${escape(value[0].toUpperCase()+value.slice(1))}</option>`).join('');
    const lookSlider=(label,key,value,min,max,step=1,extra='')=>`<label class="grade-slider"><span>${label} <output data-look-output="${key}" ${extra}>${value}</output></span><input data-look-key="${key}" ${extra} type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
    const curveLabels=['Black','Shadows','Midtones','Highlights','White'];
    const curveControls=look.curves[curveChannel].map((value,index)=>lookSlider(curveLabels[index],'curve',Math.round(value*100),0,100,1,`data-look-index="${index}"`)).join('');
    const hslControls=[['Hue shift','hue',-30,30],['Saturation','saturation',-100,100],['Luminance','luminance',-100,100]].map(([label,key,min,max])=>lookSlider(label,'hsl-'+key,look.hsl[hslRange][key],min,max)).join('');
    const wheel=look.wheels[wheelRegion];
    root.innerHTML = `<div class="grade-box">
      <details data-grade-details="advanced" ${openDetails.advanced ? 'open' : ''}><summary>Advanced color</summary><p class="grade-hint">Adjust the selected picture without changing its source.</p>${sliders}</details>
      <details data-grade-details="creative" ${openDetails.creative?'open':''}><summary>Creative grading</summary>
        <details data-grade-details="curves" ${openDetails.curves?'open':''}><summary>RGB curves</summary><p class="grade-hint">Shape five points on the master or individual color curve.</p><label class="grade-select">Channel<select data-look-select="curve">${select(G.Look.channels,curveChannel)}</select></label>${curveControls}</details>
        <details data-grade-details="hsl" ${openDetails.hsl?'open':''}><summary>Hue ranges</summary><label class="grade-select">Color range<select data-look-select="hsl">${select(G.Look.ranges,hslRange)}</select></label>${hslControls}</details>
        <details data-grade-details="wheels" ${openDetails.wheels?'open':''}><summary>Shadow / midtone / highlight color wheels</summary><label class="grade-select">Tonal range<select data-look-select="wheel">${select(G.Look.regions,wheelRegion)}</select></label><canvas class="grade-wheel" data-look-wheel width="128" height="128" aria-hidden="true"></canvas><label class="grade-select">Color (keyboard accessible)<input type="color" data-look-key="wheel-color" value="${wheel.color}"></label>${lookSlider('Color amount','wheel-amount',wheel.amount,-100,100)}</details>
        <details data-grade-details="lut" ${openDetails.lut?'open':''}><summary>3D LUT</summary><p class="grade-hint">${look.lut?escape(look.lut.title)+' · '+look.lut.size+'³ embedded':'No LUT applied.'} Import a supported .cube transform; it is stored inside projects and exported presets.</p><div class="grade-actions"><button type="button" data-grade-action="import-cube">Import .cube</button><button type="button" data-grade-action="open-cube-shared">Open shared .cube</button><button type="button" data-grade-action="remove-cube">Remove LUT</button></div><input data-grade-cube type="file" accept=".cube,text/plain" hidden></details>
        <details data-grade-details="effects" ${openDetails.effects?'open':''}><summary>Finishing effects</summary>${lookSlider('Grain','effect-grain',look.grain,0,100)}${lookSlider('Vignette','effect-vignette',look.vignette,-100,100)}${lookSlider('Sharpen','effect-sharpen',look.sharpen,0,100)}<label class="grade-select">Grain seed<input type="number" min="0" max="2147483647" step="1" data-look-key="effect-grain_seed" value="${look.grain_seed}"></label><p class="grade-hint">Grain is deterministic and stays fixed in the source frame.</p></details>
      </details>
      <label class="grade-slider"><span>Look strength <output data-grade-output="strength">${grade.strength}%</output></span><input data-grade-key="strength" type="range" min="0" max="100" step="1" value="${grade.strength}"></label>
      <label class="grade-check"><input data-grade-key="enabled" type="checkbox" ${grade.enabled ? 'checked' : ''}> Enable color adjustments</label>
      <label class="grade-select">Compare<select data-grade-compare><option value="off">After</option><option value="before">Before</option><option value="split">Split before / after</option></select></label>
      <details data-grade-details="library" ${openDetails.library ? 'open' : ''}><summary>Looks &amp; presets</summary>
        <p class="grade-hint">Presets work in PixelRoom and Cliproom. Saved looks stay on this browser; export or use Shared files to move them.</p>
        <input data-grade-search type="search" maxlength="100" placeholder="Search names or tags" aria-label="Search presets" value="${escape(search)}">
        <select data-grade-library aria-label="Choose a color preset">${options || '<option value="">No matching presets</option>'}</select>
        <div class="grade-actions"><button type="button" data-grade-action="apply">Apply look</button>${adapter.applyBatch?'<button type="button" data-grade-action="apply-track">Apply to this track</button>':''}<button type="button" data-grade-action="export">Download</button><button type="button" data-grade-action="delete">Delete saved</button></div>
        <input data-grade-name maxlength="100" placeholder="Name this look" aria-label="Preset name"><input data-grade-description maxlength="500" placeholder="Optional description" aria-label="Preset description"><input data-grade-tags maxlength="250" placeholder="Tags, separated by commas" aria-label="Preset tags">
        <div class="grade-actions"><button type="button" data-grade-action="save">Save current as new</button><button type="button" data-grade-action="import">Import file</button></div>
        <div class="grade-actions"><button type="button" data-grade-action="open-shared">Open shared</button><button type="button" data-grade-action="save-shared">Save shared</button></div>
        <input data-grade-file type="file" accept=".roomgrade,application/json" hidden>
      </details>
    </div>`;
    root.querySelector('[data-grade-compare]').value = adapter.getCompare();
    const wheelCanvas=root.querySelector('[data-look-wheel]');drawWheel(wheelCanvas,wheel.color);
    let draggingWheel=false;
    const changeWheel=(event,commit)=>{const bounds=wheelCanvas.getBoundingClientRect(),dx=(event.clientX-bounds.left)/bounds.width*2-1,dy=(event.clientY-bounds.top)/bounds.height*2-1,s=Math.min(1,Math.hypot(dx,dy)),hue=(Math.atan2(dy,dx)/(2*Math.PI)+1)%1,color=wheelColor(hue,s),current=adapter.get();current.look={...current.look,wheels:{...current.look.wheels,[wheelRegion]:{...current.look.wheels[wheelRegion],color}}};drawWheel(wheelCanvas,color);const input=root.querySelector('[data-look-key="wheel-color"]');if(input)input.value=color;adapter.update(current,commit);};
    wheelCanvas.addEventListener('pointerdown',event=>{draggingWheel=true;wheelCanvas.setPointerCapture(event.pointerId);event.preventDefault();changeWheel(event,false);});
    wheelCanvas.addEventListener('pointermove',event=>{if(draggingWheel)changeWheel(event,false);});
    wheelCanvas.addEventListener('pointerup',event=>{if(draggingWheel){draggingWheel=false;changeWheel(event,true);}});
    wheelCanvas.addEventListener('pointercancel',event=>{if(draggingWheel){draggingWheel=false;changeWheel(event,true);}});
    for (const detail of root.querySelectorAll('[data-grade-details]')) detail.addEventListener('toggle', () => { if (root.isConnected && root.contains(detail)) openDetails[detail.dataset.gradeDetails]=detail.open; });
    const selectedPreset = () => all.find(entry => entry.id === selection)?.item;
    function updateInput(event, commit) {
      const input = event.target.closest('[data-grade-key]'); if (!input) return;
      const key = input.dataset.gradeKey, current = adapter.get();
      if (key === 'enabled') current.enabled = input.checked;
      else if (key === 'strength') current.strength = Number(input.value);
      else current.adjustments[key] = Number(input.value);
      const output = root.querySelector(`[data-grade-output="${key}"]`); if (output) output.textContent = input.value + (key === 'strength' ? '%' : '');
      adapter.update(current, commit);
    }
    function updateLook(event,commit){
      const input=event.target.closest('[data-look-key]');if(!input)return;const key=input.dataset.lookKey,current=adapter.get(),old=current.look,value=input.type==='color'?input.value:Number(input.value);
      if(key==='curve'){const points=old.curves[curveChannel].slice();points[Number(input.dataset.lookIndex)]=value/100;current.look={...old,curves:{...old.curves,[curveChannel]:points}};}
      else if(key.startsWith('hsl-')){const name=key.slice(4);current.look={...old,hsl:{...old.hsl,[hslRange]:{...old.hsl[hslRange],[name]:value}}};}
      else if(key.startsWith('wheel-')){const name=key.slice(6);current.look={...old,wheels:{...old.wheels,[wheelRegion]:{...old.wheels[wheelRegion],[name]:value}}};}
      else if(key.startsWith('effect-'))current.look={...old,[key.slice(7)]:value};
      const output=root.querySelector(`[data-look-output="${key}"]${input.dataset.lookIndex===undefined?'':`[data-look-index="${input.dataset.lookIndex}"]`}`);if(output)output.textContent=input.value;
      try{adapter.update(current,commit);}catch(error){adapter.notify(error.message);}
    }
    root.oninput = event => { if (event.target.matches('[data-grade-key]:not([type=checkbox])')) updateInput(event, false);if(event.target.matches('[data-look-key]'))updateLook(event,false); };
    root.onchange = event => {
      if (event.target.matches('[data-grade-key], [data-grade-library], [data-grade-compare], [data-look-key], [data-look-select]')) event.stopPropagation();
      if (event.target.matches('[data-grade-key]')) updateInput(event, true);
      if (event.target.matches('[data-look-key]')) updateLook(event,true);
      if(event.target.matches('[data-look-select]')){const kind=event.target.dataset.lookSelect,focused=document.activeElement===event.target;if(kind==='curve')curveChannel=event.target.value;else if(kind==='hsl')hslRange=event.target.value;else wheelRegion=event.target.value;mount(root,adapter);if(focused)[...root.querySelectorAll('[data-look-select]')].find(input=>input.dataset.lookSelect===kind)?.focus({preventScroll:true});}
      if (event.target.matches('[data-grade-library]')) selection = event.target.value;
      if (event.target.matches('[data-grade-compare]')) adapter.compare(event.target.value);
    };
    root.querySelector('[data-grade-search]').addEventListener('input', event => { search = event.target.value; const focus = event.target.selectionStart; mount(root, adapter); const input = root.querySelector('[data-grade-search]'); input.focus(); input.setSelectionRange(focus, focus); });
    async function addFile(file) {
      if (!await importFile(file)) return;
      mount(root, adapter); adapter.notify('Preset added to the local library.');
    }
    root.querySelector('[data-grade-file]').addEventListener('change', event => { addFile(event.target.files[0]).catch(error => adapter.notify(error.message)); });
    async function addCube(file){if(!file)return;if(file.size>G.Look.maxCubeBytes)throw new Error('.cube files must be 2 MiB or smaller.');const lut=G.Look.parseCube(await file.text()),current=adapter.get();current.look={...current.look,lut};if(adapter.update(current,true)!==false)adapter.notify('LUT embedded in the selected item.');}
    root.querySelector('[data-grade-cube]').addEventListener('change',event=>{addCube(event.target.files[0]).catch(error=>adapter.notify(error.message));});
    root.onclick = async event => {
      const button = event.target.closest('[data-grade-action]'); if (!button) return;
      try {
        const action = button.dataset.gradeAction, chosen = selectedPreset();
        if (action === 'apply') {
          if (!chosen) throw new Error('Choose a preset first.');
          const current = adapter.get(); current.adjustments = { ...chosen.adjustments }; current.look=chosen.look||G.Look.neutral;current.enabled = true; if(adapter.update(current, true)!==false)adapter.notify('Look applied to the selected item.');
        } else if (action === 'apply-track') {
          if (!chosen) throw new Error('Choose a preset first.');
          const current = adapter.get(); current.adjustments = { ...chosen.adjustments };current.look=chosen.look||G.Look.neutral; current.enabled = true; adapter.applyBatch(current);
        } else if (action === 'save') {
          const name = root.querySelector('[data-grade-name]').value.trim(), description = root.querySelector('[data-grade-description]').value, tags = root.querySelector('[data-grade-tags]').value.split(',').map(tag => tag.trim()).filter(Boolean);
          const current=adapter.get(),item = G.makePreset(name, current.adjustments, description, tags,current.look), items = readLibrary(); items.push(item); saveLibrary(items); selection = 'u:' + (items.length - 1); search = ''; mount(root, adapter); adapter.notify('Saved as a new local preset.');
        } else if (action === 'delete') {
          if (!selection.startsWith('u:')) throw new Error('Choose a saved preset to delete.');
          const items = readLibrary(); items.splice(Number(selection.slice(2)), 1); saveLibrary(items); selection = 'b:0'; mount(root, adapter); adapter.notify('Saved preset removed.');
        } else if (action === 'export') { if (!chosen) throw new Error('Choose a preset first.'); download(chosen); }
        else if (action === 'import') root.querySelector('[data-grade-file]').click();
        else if (action === 'import-cube') root.querySelector('[data-grade-cube]').click();
        else if (action === 'remove-cube') {const current=adapter.get();current.look={...current.look,lut:null};adapter.update(current,true);adapter.notify('LUT removed.');}
        else if (action === 'open-cube-shared') {if(!window.RoomShared)throw new Error('Shared files require RoomSuite.');const path=await RoomShared.choosePath(['.cube']);if(path)await addCube(await RoomShared.get(path,{maxBytes:G.Look.maxCubeBytes}));}
        else if (action === 'open-shared') {
          if (!window.RoomShared) throw new Error('Shared files require RoomSuite.');
          const path = await RoomShared.choosePath(['.roomgrade']); if (path) await addFile(await RoomShared.get(path, {maxBytes:G.maxBytes}));
        } else if (action === 'save-shared') {
          if (!window.RoomShared) throw new Error('Shared files require RoomSuite.'); if (!chosen) throw new Error('Choose a preset first.');
          const name = (chosen.name.replace(/[^a-z0-9_-]+/gi, '-') || 'look') + '.roomgrade';
          const path = await RoomShared.save(new Blob([G.serializePreset(chosen)], {type:'application/json'}), name); if (path) adapter.notify('Preset saved to shared files: ' + path);
        }
      } catch (error) { adapter.notify(error.message || 'Could not use this preset.'); }
    };
  }
  window.RoomGradeUI = { mount, capture, importFile };
})();
