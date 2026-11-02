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
    return {format:'motionroom',version:2,name,duration,sourceType:'none',source:null,width,height,background,fps,holdFrames,fonts:[],assets:[],layers:[]};
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
    if(!input||input.format!=='motionroom'||![1,2].includes(input.version)||typeof input.name!=='string'||!input.name.trim()||input.name.length>160||!finite(input.duration,.1,60)||!(input.background===null||color(input.background)))throw new Error('Invalid MotionRoom project.');
    const project=copy(input),legacy=project.version===1;project.version=2;project.fps=project.fps??30;project.holdFrames=project.holdFrames??1;project.fonts=project.fonts??[];project.assets=project.assets??[];
    if(!Number.isInteger(project.width)||!Number.isInteger(project.height)||project.width<1||project.height<1||project.width>4096||project.height>4096||!Number.isInteger(project.fps)||project.fps<1||project.fps>60||!Number.isInteger(project.holdFrames)||project.holdFrames<1||project.holdFrames>60)throw new Error('Invalid stage size or frame rate.');
    let prepared=null;if(project.sourceType==='none'){if(project.source!==null)throw new Error('Invalid empty artwork source.');}else{prepared=prepareSource(project.source);if(project.sourceType!==prepared.type)throw new Error('The animation does not match its artwork.');project.source=prepared.source;}
    if(!Array.isArray(project.fonts)||project.fonts.length>32||!Array.isArray(project.assets)||project.assets.length>1000||!Array.isArray(project.layers)||project.layers.length>1000)throw new Error('Invalid motion project resources.');
    const fontIds=new Set(),assetIds=new Set();
    for(const font of project.fonts){if(!font||!id(font.id)||genericFonts.includes(font.id)||fontIds.has(font.id)||typeof font.name!=='string'||!font.name.trim()||font.name.length>160||typeof font.data!=='string'||font.data.length>14*1024*1024||!/^data:font\/(woff2|woff|ttf|otf);base64,[a-z0-9+/=]+$/i.test(font.data))throw new Error('Invalid embedded font.');fontIds.add(font.id);}
    for(const asset of project.assets){if(!asset||!id(asset.id)||assetIds.has(asset.id)||typeof asset.data!=='string'||asset.data.length>28*1024*1024||!/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(asset.data))throw new Error('Invalid embedded image.');assetIds.add(asset.id);}
    const seen=new Set(),layerIds=new Set();let total=0;
    for(const [index,layer] of project.layers.entries()){
      if(legacy){layer.id='source-'+index;layer.kind=project.sourceType;}
      if(!layer||!id(layer.id)||layerIds.has(layer.id)||typeof layer.name!=='string'||layer.name.length>160||typeof layer.visible!=='boolean'||!Array.isArray(layer.keyframes)||!['paint','vector','text','shape','image','lens'].includes(layer.kind))throw new Error('Invalid motion layer.');layerIds.add(layer.id);
      if(['paint','vector'].includes(layer.kind)){if(!prepared||layer.kind!==prepared.type||!Number.isInteger(layer.sourceIndex)||layer.sourceIndex<0||layer.sourceIndex>=prepared.items.length||seen.has(layer.sourceIndex))throw new Error('Invalid motion layer source.');seen.add(layer.sourceIndex);}
      if(layer.kind==='text'){
        const t=layer.text;if(!t||typeof t.content!=='string'||t.content.length>5000||!finite(t.x,-100000,100000)||!finite(t.y,-100000,100000)||!finite(t.fontSize,1,2000)||typeof t.font!=='string'||(!genericFonts.includes(t.font)&&!fontIds.has(t.font))||!['normal','bold'].includes(t.weight)||!['normal','italic'].includes(t.style)||!['left','center','right'].includes(t.align)||!finite(t.lineHeight,.5,4)||!color(t.color))throw new Error('Invalid text layer.');
      }
      if(layer.kind==='shape'){
        const s=layer.shape;if(!s||!['rect','ellipse'].includes(s.type)||!finite(s.x,-100000,100000)||!finite(s.y,-100000,100000)||!finite(s.width,1,16384)||!finite(s.height,1,16384)||!(s.fill===null||color(s.fill))||!color(s.stroke)||!finite(s.strokeWidth,0,1000)||!finite(s.radius,0,8192))throw new Error('Invalid shape layer.');
      }
      if(layer.kind==='image'){
        const image=layer.image;if(!image||!assetIds.has(image.assetId)||!finite(image.x,-100000,100000)||!finite(image.y,-100000,100000)||!finite(image.width,1,16384)||!finite(image.height,1,16384))throw new Error('Invalid image layer.');
      }
      if(layer.kind==='lens'){
        const lens=layer.lens;if(!lens||!finite(lens.x,-100000,100000)||!finite(lens.y,-100000,100000)||!finite(lens.radius,1,4096)||!finite(lens.zoom,1,10)||!finite(lens.offsetX,-100000,100000)||!finite(lens.offsetY,-100000,100000)||!color(lens.stroke)||!finite(lens.strokeWidth,0,500))throw new Error('Invalid lens layer.');
      }
      let last=-1;total+=layer.keyframes.length;if(total>100000)throw new Error('This project has too many keyframes.');
      for(const frame of layer.keyframes){if(!frame||!finite(frame.time,0,project.duration)||frame.time<=last||!finite(frame.x,-100000,100000)||!finite(frame.y,-100000,100000)||!finite(frame.scale,.01,10)||!finite(frame.rotation,-36000,36000)||!finite(frame.opacity,0,1)||!easings.includes(frame.easing)||(frame.reveal!==undefined&&!finite(frame.reveal,0,1))||(frame.zoom!==undefined&&!finite(frame.zoom,1,10)))throw new Error('Invalid motion keyframe.');last=frame.time;}
    }
    if(legacy&&(!prepared||project.layers.length!==prepared.items.length))throw new Error('The animation does not match its artwork.');
    return project;
  }
  function easing(name,t){if(name==='hold')return 0;if(name==='ease-in')return t*t;if(name==='ease-out')return 1-(1-t)*(1-t);if(name==='ease-in-out')return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;return t;}
  function sample(layer,time){
    const base={...defaults,...(layer.kind==='text'?{reveal:1}:{}),...(layer.kind==='lens'?{zoom:layer.lens.zoom}:{})},frames=layer.keyframes;
    if(!frames.length)return base;
    const frameValue=frame=>Object.fromEntries(Object.keys(base).map(key=>[key,frame[key]??base[key]]));
    if(time<=frames[0].time)return frameValue(frames[0]);if(time>=frames.at(-1).time)return frameValue(frames.at(-1));
    const right=frames.findIndex(frame=>frame.time>=time);if(frames[right].time===time)return frameValue(frames[right]);
    const a=frames[right-1],b=frames[right],t=easing(a.easing,(time-a.time)/(b.time-a.time)),value={};
    for(const key of Object.keys(base)){const av=a[key]??base[key],bv=b[key]??base[key];value[key]=av+(bv-av)*t;}return value;
  }
  function setFrame(layer,time,values,ease='linear'){
    const frame={time,...Object.fromEntries(Object.keys(defaults).map(key=>[key,values[key]??defaults[key]])),...(values.reveal===undefined?{}:{reveal:values.reveal}),...(values.zoom===undefined?{}:{zoom:values.zoom}),easing:ease};
    const index=layer.keyframes.findIndex(existing=>Math.abs(existing.time-time)<1e-9);if(index<0)layer.keyframes.push(frame);else layer.keyframes[index]=frame;layer.keyframes.sort((a,b)=>a.time-b.time);return frame;
  }
  return {defaults,easings,genericFonts,prepareSource,empty,create,attachSource,validate,sample,setFrame};
});
