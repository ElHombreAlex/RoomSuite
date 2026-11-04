'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('../PaintRoom/model.js'),require('../VectorRoom/graphics.js'));else root.MotionModel=factory(root.PaintModel,root.VectorGraphics);})(typeof globalThis==='object'?globalThis:this,function(PaintModel,VectorGraphics){
  const defaults=Object.freeze({x:0,y:0,scale:1,rotation:0,opacity:1});
  const easings=['linear','ease-in','ease-out','ease-in-out','hold'];
  const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  const color=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
  const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const genericFonts=['sans-serif','serif','monospace','Arial','Georgia','Verdana','Times New Roman','Trebuchet MS','Courier New','Bricolage Grotesque','Gelasio'];
  function prepareSource(input){
    const source=copy(input);
    if(source?.format==='paintroom-project'){
      PaintModel.validate(source);PaintModel.ensureIds(source);
      return {type:'paint',source,width:source.width,height:source.height,items:source.layers};
    }
    if(source?.format==='vectorroom'){
      const objects=VectorGraphics.validateDocument(source);
      return {type:'vector',source:{format:'vectorroom',version:1,objects},width:1000,height:700,items:objects};
    }
    throw new Error('Choose a PaintRoom, VectorRoom or MotionRoom project.');
  }
  function empty({name='Untitled motion',width=1080,height=1920,duration=5,background='#ffffff',fps=30,holdFrames=1}={}){
    return {format:'motionroom',version:3,name,duration,sourceType:'none',source:null,width,height,background,fps,holdFrames,fonts:[],assets:[],symbols:[],behaviors:[],layers:[]};
  }
  function create(input){
    const prepared=prepareSource(input);if(!prepared.items.length)throw new Error('The artwork has no layers or objects to animate.');
    return {...empty({name:prepared.type==='paint'?prepared.source.name:'Untitled motion',width:prepared.width,height:prepared.height,background:prepared.type==='paint'?(prepared.source.background||'#ffffff'):'#ffffff'}),sourceType:prepared.type,source:prepared.source,
      layers:prepared.items.map((item,index)=>({id:'source-'+index,kind:prepared.type,sourceIndex:index,name:prepared.type==='paint'?(item.name||`Layer ${index+1}`):item.type==='text'?(item.text.slice(0,32)||`Text ${index+1}`):`${item.type.charAt(0).toUpperCase()+item.type.slice(1)} ${index+1}`,visible:prepared.type==='paint'?item.visible:true,keyframes:[]}))};
  }
  function attachSource(project,input,index=0){
    if(project.sourceType!=='none')throw new Error('This composition already has an artwork source.');if(!Number.isInteger(index)||index<0||index>project.layers.length)throw new Error('Invalid artwork insertion position.');
    const imported=create(input),used=new Set(project.layers.map(layer=>layer.id));for(const layer of imported.layers){let candidate=layer.id,suffix=1;while(used.has(candidate))candidate=layer.id+'-'+suffix++;layer.id=candidate;used.add(candidate);}project.sourceType=imported.sourceType;project.source=imported.source;project.layers.splice(index,0,...imported.layers);return imported.layers.length;
  }
  function validate(input){
    if(!input||input.format!=='motionroom'||![1,2,3,4].includes(input.version)||typeof input.name!=='string'||!input.name.trim()||input.name.length>160||!finite(input.duration,.1,60)||!(input.background===null||color(input.background)))throw new Error('Invalid MotionRoom project.');
    const project=copy(input),legacy=project.version===1;project.version=project.version===4?4:3;project.fps=project.fps??30;project.holdFrames=project.holdFrames??1;project.fonts=project.fonts??[];project.assets=project.assets??[];project.symbols=project.symbols??[];project.behaviors=project.behaviors??[];
    if(!Number.isInteger(project.width)||!Number.isInteger(project.height)||project.width<1||project.height<1||project.width>4096||project.height>4096||!Number.isInteger(project.fps)||project.fps<1||project.fps>60||!Number.isInteger(project.holdFrames)||project.holdFrames<1||project.holdFrames>60)throw new Error('Invalid stage size or frame rate.');
    let prepared=null;if(project.sourceType==='none'){if(project.source!==null)throw new Error('Invalid empty artwork source.');}else{prepared=prepareSource(project.source);if(project.sourceType!==prepared.type)throw new Error('The animation does not match its artwork.');project.source=prepared.source;}
    if(!Array.isArray(project.fonts)||project.fonts.length>32||!Array.isArray(project.assets)||project.assets.length>1000||!Array.isArray(project.layers)||project.layers.length>1000)throw new Error('Invalid motion project resources.');
    const fontIds=new Set(),assetIds=new Set();
    for(const font of project.fonts){if(!font||!id(font.id)||genericFonts.includes(font.id)||fontIds.has(font.id)||typeof font.name!=='string'||!font.name.trim()||font.name.length>160||typeof font.data!=='string'||font.data.length>14*1024*1024||!/^data:font\/(woff2|woff|ttf|otf);base64,[a-z0-9+/=]+$/i.test(font.data))throw new Error('Invalid embedded font.');fontIds.add(font.id);}
    for(const asset of project.assets){const embedded=typeof asset?.data==='string'&&asset.data.length<=28*1024*1024&&/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(asset.data),linked=typeof asset?.sharedPath==='string'&&asset.sharedPath.length<=1024&&!/[\\\x00-\x1f]/.test(asset.sharedPath)&&!asset.sharedPath.startsWith('/')&&asset.sharedPath.split('/').every(part=>part&&part!=='.'&&part!=='..')&&/\.(png|jpe?g|webp|gif|avif)$/i.test(asset.sharedPath);if(!asset||!id(asset.id)||assetIds.has(asset.id)||embedded===linked||(asset.data!==undefined&&!embedded)||(asset.sharedPath!==undefined&&!linked))throw new Error('Invalid image asset.');assetIds.add(asset.id);}
    if(!Array.isArray(project.symbols)||project.symbols.length>200||!Array.isArray(project.behaviors)||project.behaviors.length>200)throw new Error('Invalid reusable resources.');
    const symbolIds=new Set(),behaviorIds=new Set();
    for(const symbol of project.symbols){if(!symbol||!id(symbol.id)||symbolIds.has(symbol.id)||typeof symbol.name!=='string'||!symbol.name.trim()||symbol.name.length>160||!id(symbol.rootId)||!Array.isArray(symbol.layers)||!symbol.layers.length||symbol.layers.length>1000)throw new Error('Invalid symbol.');symbolIds.add(symbol.id);}
    for(const behavior of project.behaviors){
      if(!behavior||!id(behavior.id)||behaviorIds.has(behavior.id)||typeof behavior.name!=='string'||!behavior.name.trim()||behavior.name.length>160||!Array.isArray(behavior.keyframes)||!behavior.keyframes.length||behavior.keyframes.length>1000)throw new Error('Invalid behavior.');behaviorIds.add(behavior.id);let last=-1;
      for(const frame of behavior.keyframes){if(!frame||!finite(frame.at,0,1)||frame.at<=last||!easings.includes(frame.easing)||Object.keys(defaults).some(key=>!finite(frame[key],key==='scale'?.01:key==='opacity'?0:-100000,key==='scale'?10:key==='opacity'?1:100000))||(frame.reveal!==undefined&&!finite(frame.reveal,0,1)))throw new Error('Invalid behavior keyframe.');last=frame.at;}
    }
    const seen=new Set();let total=0;
    function validateLayers(layers,sourceAllowed=true,countFrames=true){
    const layerIds=new Set();
    for(const [index,layer] of layers.entries()){
      if(legacy){layer.id='source-'+index;layer.kind=project.sourceType;}
      if(!layer||!id(layer.id)||layerIds.has(layer.id)||typeof layer.name!=='string'||layer.name.length>160||typeof layer.visible!=='boolean'||!Array.isArray(layer.keyframes)||!['paint','vector','text','shape','image','lens','group','instance'].includes(layer.kind))throw new Error('Invalid motion layer.');layerIds.add(layer.id);
      if(['paint','vector'].includes(layer.kind)){if(!sourceAllowed||!prepared||layer.kind!==prepared.type||!Number.isInteger(layer.sourceIndex)||layer.sourceIndex<0||layer.sourceIndex>=prepared.items.length||seen.has(layer.sourceIndex))throw new Error('Invalid motion layer source.');seen.add(layer.sourceIndex);}
      if(layer.kind==='text'){
        const t=layer.text;if(!t||typeof t.content!=='string'||t.content.length>5000||!finite(t.x,-100000,100000)||!finite(t.y,-100000,100000)||!finite(t.fontSize,1,2000)||typeof t.font!=='string'||(!genericFonts.includes(t.font)&&!fontIds.has(t.font))||!['normal','bold'].includes(t.weight)||!['normal','italic'].includes(t.style)||!['left','center','right'].includes(t.align)||!finite(t.lineHeight,.5,4)||!color(t.color)||(t.width!==undefined&&!finite(t.width,1,16384))||(t.height!==undefined&&!finite(t.height,1,16384))||(t.padding!==undefined&&!finite(t.padding,0,4096))||(t.autoFit!==undefined&&typeof t.autoFit!=='boolean'))throw new Error('Invalid text layer.');
        if(t.fontVariations!==undefined){const axes=t.fontVariations;if(!axes||typeof axes!=='object'||Array.isArray(axes)||!Object.keys(axes).length||Object.keys(axes).length>16||Object.entries(axes).some(([tag,value])=>!/^[A-Za-z0-9]{4}$/.test(tag)||!finite(value,-10000,10000)))throw new Error('Invalid font variations on text layer '+layer.id+'. Use up to 16 four-character axis tags and numeric values.');if(!fontIds.has(t.font)&&!['Bricolage Grotesque','Gelasio'].includes(t.font))throw new Error('Font variations require a bundled or embedded font on layer '+layer.id+'.');project.version=4;}
      }
      if(layer.kind==='shape'){
        const s=layer.shape;if(!s||!['rect','ellipse'].includes(s.type)||!finite(s.x,-100000,100000)||!finite(s.y,-100000,100000)||!finite(s.width,1,16384)||!finite(s.height,1,16384)||!(s.fill===null||color(s.fill))||!color(s.stroke)||!finite(s.strokeWidth,0,1000)||!finite(s.radius,0,8192))throw new Error('Invalid shape layer.');
      }
      if(layer.kind==='image'){
        const image=layer.image;if(image&&!assetIds.has(image.assetId))throw new Error('Image layer '+layer.id+' refers to a missing asset: '+String(image.assetId));if(!image||!finite(image.x,-100000,100000)||!finite(image.y,-100000,100000)||!finite(image.width,1,16384)||!finite(image.height,1,16384)||(image.fit!==undefined&&!['fill','contain','cover'].includes(image.fit)))throw new Error('Invalid image layer: '+layer.id);
      }
      if(layer.kind==='lens'){
        const lens=layer.lens;if(!lens||!finite(lens.x,-100000,100000)||!finite(lens.y,-100000,100000)||!finite(lens.radius,1,4096)||!finite(lens.zoom,1,10)||!finite(lens.offsetX,-100000,100000)||!finite(lens.offsetY,-100000,100000)||!color(lens.stroke)||!finite(lens.strokeWidth,0,500))throw new Error('Invalid lens layer.');
      }
      if(layer.kind==='group'){const g=layer.group;if(!g||!finite(g.x,-100000,100000)||!finite(g.y,-100000,100000)||(g.width!==undefined&&!finite(g.width,1,16384))||(g.height!==undefined&&!finite(g.height,1,16384)))throw new Error('Invalid group.');}
      if(layer.kind==='instance'){const v=layer.instance;if(!v||!symbolIds.has(v.symbolId)||!finite(v.x,-100000,100000)||!finite(v.y,-100000,100000)||(v.overrides!==undefined&&(!v.overrides||Array.isArray(v.overrides)||typeof v.overrides!=='object')))throw new Error('Invalid symbol instance.');}
      if(layer.parentId!==undefined&&layer.parentId!==null&&!id(layer.parentId))throw new Error('Invalid layer parent.');
      if(layer.attach!==undefined){const a=layer.attach;if(!a||!id(a.targetId)||!['center','top','bottom','left','right','top-left','top-right','bottom-left','bottom-right','angle'].includes(a.targetAnchor)||!['center','top','bottom','left','right','top-left','top-right','bottom-left','bottom-right'].includes(a.selfAnchor)||!finite(a.offsetX??0,-100000,100000)||!finite(a.offsetY??0,-100000,100000)||!finite(a.angle??0,-36000,36000)||typeof (a.followRotation??false)!=='boolean'||(a.orientation!==undefined&&!['fixed','radial','tangent'].includes(a.orientation))||(a.orientation&&a.orientation!=='fixed'&&a.targetAnchor!=='angle'))throw new Error('Invalid layer attachment.');}
      if(layer.style!==undefined){const s=layer.style;if(!s||typeof s!=='object'||(s.radius!==undefined&&!finite(s.radius,0,8192))||(s.clip!==undefined&&typeof s.clip!=='boolean')||(s.blend!==undefined&&!['source-over','multiply','screen','overlay','darken','lighten'].includes(s.blend))||(s.border!==undefined&&(!s.border||!color(s.border.color)||!finite(s.border.width,0,1000)))||(s.shadow!==undefined&&(!s.shadow||!color(s.shadow.color)||!finite(s.shadow.blur,0,1000)||!finite(s.shadow.x,-4096,4096)||!finite(s.shadow.y,-4096,4096))))throw new Error('Invalid layer style.');if(s.clip&&layer.kind==='group'&&(!layer.group.width||!layer.group.height))throw new Error('A clipped group needs width and height.');}
      if(layer.layout!==undefined){const l=layer.layout;if(!l||!finite(l.width,1,16384)||!finite(l.height,1,16384)||!finite(l.padding??0,0,4096)||(l.padding||0)*2>=Math.min(l.width,l.height)||!['none','contain','cover'].includes(l.fit??'none')||(l.clip!==undefined&&typeof l.clip!=='boolean')||!['start','center','end'].includes(l.alignX??'center')||!['start','center','end'].includes(l.alignY??'center')||(layer.kind==='group'&&(!layer.group.width||!layer.group.height)))throw new Error('Invalid layer layout box.');}
      if(layer.effects!==undefined){if(!Array.isArray(layer.effects)||layer.effects.length>32)throw new Error('Invalid behavior effects.');for(const e of layer.effects)if(!e||!behaviorIds.has(e.behaviorId)||!finite(e.start,0,project.duration)||!finite(e.duration,.001,60)||!finite(e.amountX??1,-100000,100000)||!finite(e.amountY??1,-100000,100000)||!finite(e.amountRotation??1,-1000,1000)||!finite(e.amountScale??1,-10,10)||!finite(e.amountOpacity??1,0,1))throw new Error('Invalid behavior effect.');}
      let last=-1;if(countFrames)total+=layer.keyframes.length;if(total>100000)throw new Error('This project has too many keyframes.');
      for(const [index,frame] of layer.keyframes.entries()){const label='Layer '+layer.id+', keyframe '+(index+1)+': ';if(frame&&(!finite(frame.scale,.01,10)||(frame.scaleX!==undefined&&!finite(frame.scaleX,.01,10))||(frame.scaleY!==undefined&&!finite(frame.scaleY,.01,10))))throw new Error(label+'scale, scaleX and scaleY must be between 0.01 and 10.');if(!frame||!finite(frame.time,0,project.duration)||frame.time<=last||!finite(frame.x,-100000,100000)||!finite(frame.y,-100000,100000)||!finite(frame.rotation,-36000,36000)||!finite(frame.opacity,0,1)||!easings.includes(frame.easing)||(frame.reveal!==undefined&&!finite(frame.reveal,0,1))||(frame.zoom!==undefined&&!finite(frame.zoom,1,10)))throw new Error(label+'invalid motion keyframe; check time, order, transform and easing.');if(frame.scaleX!==undefined||frame.scaleY!==undefined)project.version=4;last=frame.time;}
    }
    const byId=new Map(layers.map(layer=>[layer.id,layer]));
    for(const layer of layers){if(layer.parentId){const parent=byId.get(layer.parentId);if(!parent||parent.kind!=='group'||parent===layer)throw new Error('A layer parent must be another group.');}if(layer.attach){const target=byId.get(layer.attach.targetId);if(!target||target===layer||(target.parentId||null)!==(layer.parentId||null))throw new Error('Attached layers must share a parent and have different IDs.');}}
    function checkChain(layer,key){const visited=new Set();let current=layer;while(current?.[key]){if(visited.has(current.id))throw new Error('Layer relationships cannot contain cycles.');visited.add(current.id);current=byId.get(key==='attach'?current.attach.targetId:current[key]);}}
    for(const layer of layers){checkChain(layer,'parentId');checkChain(layer,'attach');}
    }
    validateLayers(project.layers);
    for(const symbol of project.symbols){validateLayers(symbol.layers,false);const roots=symbol.layers.filter(layer=>!layer.parentId);if(roots.length!==1||roots[0].id!==symbol.rootId||roots[0].kind!=='group')throw new Error('A symbol must have one group root.');}
    const symbols=new Map(project.symbols.map(s=>[s.id,s]));
    const checkedSymbols=new Set();function visitSymbol(symbol,stack){if(stack.has(symbol.id))throw new Error('Symbol instances cannot be recursive.');if(checkedSymbols.has(symbol.id))return;const next=new Set(stack);next.add(symbol.id);for(const layer of symbol.layers)if(layer.kind==='instance')visitSymbol(symbols.get(layer.instance.symbolId),next);checkedSymbols.add(symbol.id);}
    for(const symbol of project.symbols)visitSymbol(symbol,new Set());
    function validateOverrides(layers){for(const layer of layers)if(layer.kind==='instance'){const symbol=symbols.get(layer.instance.symbolId),root=symbol.layers.find(item=>item.id===symbol.rootId),overrides=layer.instance.overrides||{};if((layer.layout||layer.style?.clip)&&(!root.group.width||!root.group.height))throw new Error('A framed or clipped instance needs a symbol root with width and height.');for(const [key,value] of Object.entries(overrides)){const original=symbol.layers.find(item=>item.id===key);if(!original||!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid symbol override.');for(const field of Object.keys(value))if(!['name','visible','text','shape','image','lens','style','layout','effects'].includes(field)||(['text','shape','image','lens'].includes(field)&&field!==original.kind))throw new Error('Unsupported symbol override.');}const changed=symbol.layers.map(item=>{const v=overrides[item.id];if(!v)return item;const clone={...item,...v};for(const field of ['text','shape','image','lens','style','layout'])if(v[field])clone[field]={...item[field],...v[field]};return clone;});validateLayers(changed,false,false);}}
    validateOverrides(project.layers);for(const symbol of project.symbols)validateOverrides(symbol.layers);
    const expanded=expand(project),variants=new Set();for(const layer of expanded)if(layer.kind==='text'&&layer.text.fontVariations){const t=layer.text;variants.add(JSON.stringify([t.font,t.font==='Gelasio'?t.style:'normal',Object.entries(t.fontVariations).sort(([a],[b])=>a.localeCompare(b))]));}if(variants.size>32)throw new Error('A composition supports at most 32 different variable-font configurations.');
    if(legacy&&(!prepared||project.layers.length!==prepared.items.length))throw new Error('The animation does not match its artwork.');
    return project;
  }
  function easing(name,t){if(name==='hold')return 0;if(name==='ease-in')return t*t;if(name==='ease-out')return 1-(1-t)*(1-t);if(name==='ease-in-out')return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;return t;}
  function sample(layer,time){
    const frames=layer.keyframes,base={...defaults,...(frames.some(frame=>frame.scaleX!==undefined||frame.scaleY!==undefined)?{scaleX:1,scaleY:1}:{}),...(layer.kind==='text'?{reveal:1}:{}),...(layer.kind==='lens'?{zoom:layer.lens.zoom}:{})};
    if(!frames.length)return base;
    const frameValue=frame=>Object.fromEntries(Object.keys(base).map(key=>[key,frame[key]??base[key]]));
    if(time<=frames[0].time)return frameValue(frames[0]);if(time>=frames.at(-1).time)return frameValue(frames.at(-1));
    const right=frames.findIndex(frame=>frame.time>=time);if(frames[right].time===time)return frameValue(frames[right]);
    const a=frames[right-1],b=frames[right],t=easing(a.easing,(time-a.time)/(b.time-a.time)),value={};
    for(const key of Object.keys(base)){const av=a[key]??base[key],bv=b[key]??base[key];value[key]=av+(bv-av)*t;}return value;
  }
  function setFrame(layer,time,values,ease='linear'){
    const frame={time,...Object.fromEntries(Object.keys(defaults).map(key=>[key,values[key]??defaults[key]])),...(values.scaleX===undefined?{}:{scaleX:values.scaleX}),...(values.scaleY===undefined?{}:{scaleY:values.scaleY}),...(values.reveal===undefined?{}:{reveal:values.reveal}),...(values.zoom===undefined?{}:{zoom:values.zoom}),easing:ease};
    const index=layer.keyframes.findIndex(existing=>Math.abs(existing.time-time)<1e-9);if(index<0)layer.keyframes.push(frame);else layer.keyframes[index]=frame;layer.keyframes.sort((a,b)=>a.time-b.time);return frame;
  }
  // Expand reusable components into a transient tree. Instances own only their
  // placement and overrides; the component definition remains editable once.
  function expand(project){
    const symbols=new Map((project.symbols||[]).map(symbol=>[symbol.id,symbol])),out=[];let expandedFrames=0;
    function append(layer,prefix='',parent=null,override=null){
      expandedFrames+=Math.max(1,layer.keyframes.length);if(expandedFrames>250000)throw new Error('Expanded composition exceeds 250,000 keyframes.');let item=prefix?{...layer}:layer;
      if(override){item={...item,...override};for(const key of ['text','shape','image','lens','style','layout'])if(override[key])item[key]={...layer[key],...override[key]};}
      const mapped=prefix+layer.id;
      if(prefix){item.id=mapped;item.parentId=layer.parentId?prefix+layer.parentId:parent;if(item.attach)item.attach={...item.attach,targetId:prefix+item.attach.targetId};}
      if(item.kind!=='instance'){out.push(item);if(out.length>5000)throw new Error('Expanded composition exceeds 5,000 layers.');return;}
      const symbol=symbols.get(item.instance.symbolId);if(!symbol)throw new Error('Symbol not found.');const root=symbol.layers.find(child=>child.id===symbol.rootId),dx=item.instance.x-root.group.x,dy=item.instance.y-root.group.y;
      const frames=item.keyframes.length?item.keyframes.map(frame=>({...frame,x:frame.x+dx,y:frame.y+dy})):[{time:0,...defaults,x:dx,y:dy,easing:'linear'}];
      out.push({id:mapped,kind:'group',name:item.name,visible:item.visible,parentId:item.parentId,group:{...root.group},keyframes:frames,...(item.attach?{attach:item.attach}:{}),...(item.style?{style:item.style}:{}),...(item.layout?{layout:item.layout}:{}),...(item.effects?{effects:item.effects}:{})});
      if(out.length>5000)throw new Error('Expanded composition exceeds 5,000 layers.');
      const childPrefix=mapped+'~';for(const child of symbol.layers)append(child,childPrefix,mapped,item.instance.overrides?.[child.id]);
    }
    for(const layer of project.layers)append(layer);return out;
  }
  function sampleAnimated(layer,time,project){
    const value=sample(layer,time),behaviors=new Map((project.behaviors||[]).map(item=>[item.id,item]));
    for(const effect of layer.effects||[]){const behavior=behaviors.get(effect.behaviorId);if(!behavior)continue;const t=Math.min(1,Math.max(0,(time-effect.start)/effect.duration));const fake={kind:'text',keyframes:behavior.keyframes.map(frame=>({...frame,time:frame.at}))},v=sample(fake,t);
      value.x+=v.x*(effect.amountX??1);value.y+=v.y*(effect.amountY??1);value.rotation+=v.rotation*(effect.amountRotation??1);value.scale*=Math.max(.001,1+(v.scale-1)*(effect.amountScale??1));value.opacity*=Math.max(0,Math.min(1,1+(v.opacity-1)*(effect.amountOpacity??1)));if(value.reveal!==undefined)value.reveal*=v.reveal;
    }
    return value;
  }
  return {defaults,easings,genericFonts,prepareSource,empty,create,attachSource,validate,sample,sampleAnimated,setFrame,expand};
});
