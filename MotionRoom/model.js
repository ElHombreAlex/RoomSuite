'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('../PaintRoom/model.js'),require('../VectorRoom/graphics.js'));else root.MotionModel=factory(root.PaintModel,root.VectorGraphics);})(typeof globalThis==='object'?globalThis:this,function(PaintModel,VectorGraphics){
  const defaults=Object.freeze({x:0,y:0,scale:1,rotation:0,opacity:1});
  const easings=['linear','ease-in','ease-out','ease-in-out','hold'];
  const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  const copy=value=>JSON.parse(JSON.stringify(value));
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
  function create(input){
    const prepared=prepareSource(input);
    if(!prepared.items.length)throw new Error('The artwork has no layers or objects to animate.');
    return {format:'motionroom',version:1,name:prepared.type==='paint'?prepared.source.name:'Untitled motion',duration:5,sourceType:prepared.type,source:prepared.source,
      width:prepared.width,height:prepared.height,background:prepared.type==='paint'?(prepared.source.background||'#ffffff'):'#ffffff',
      layers:prepared.items.map((item,index)=>({sourceIndex:index,name:prepared.type==='paint'?(item.name||`Layer ${index+1}`):item.type==='text'?(item.text.slice(0,32)||`Text ${index+1}`):`${item.type.charAt(0).toUpperCase()+item.type.slice(1)} ${index+1}`,visible:prepared.type==='paint'?item.visible:true,keyframes:[]}))};
  }
  function validate(input){
    if(!input||input.format!=='motionroom'||input.version!==1||typeof input.name!=='string'||!input.name.trim()||input.name.length>160||!finite(input.duration,.1,60)||!/^#[0-9a-f]{6}$/i.test(input.background||''))throw new Error('Invalid MotionRoom project.');
    const prepared=prepareSource(input.source);
    if(input.sourceType!==prepared.type||input.width!==prepared.width||input.height!==prepared.height||!Array.isArray(input.layers)||!input.layers.length||input.layers.length!==prepared.items.length)throw new Error('The animation does not match its artwork.');
    const seen=new Set();let total=0;
    for(const layer of input.layers){
      if(!layer||!Number.isInteger(layer.sourceIndex)||layer.sourceIndex<0||layer.sourceIndex>=prepared.items.length||seen.has(layer.sourceIndex)||typeof layer.name!=='string'||layer.name.length>160||typeof layer.visible!=='boolean'||!Array.isArray(layer.keyframes))throw new Error('Invalid motion layer.');
      seen.add(layer.sourceIndex);let last=-1;total+=layer.keyframes.length;if(total>10000)throw new Error('This project has too many keyframes.');
      for(const frame of layer.keyframes){if(!frame||!finite(frame.time,0,input.duration)||frame.time<=last||!finite(frame.x,-100000,100000)||!finite(frame.y,-100000,100000)||!finite(frame.scale,.01,10)||!finite(frame.rotation,-36000,36000)||!finite(frame.opacity,0,1)||!easings.includes(frame.easing))throw new Error('Invalid motion keyframe.');last=frame.time;}
    }
    const project=copy(input);project.source=prepared.source;return project;
  }
  function easing(name,t){if(name==='hold')return 0;if(name==='ease-in')return t*t;if(name==='ease-out')return 1-(1-t)*(1-t);if(name==='ease-in-out')return t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;return t;}
  function sample(layer,time){
    const frames=layer.keyframes;if(!frames.length)return {...defaults};
    if(time<=frames[0].time)return {...frames[0]};
    if(time>=frames.at(-1).time)return {...frames.at(-1)};
    const right=frames.findIndex(frame=>frame.time>=time);if(frames[right].time===time)return {...frames[right]};
    const a=frames[right-1],b=frames[right],t=easing(a.easing,(time-a.time)/(b.time-a.time)),value={};
    for(const key of Object.keys(defaults))value[key]=a[key]+(b[key]-a[key])*t;
    return value;
  }
  function setFrame(layer,time,values,ease='linear'){
    const rounded=Math.round(time*1000)/1000,frame={time:rounded,...Object.fromEntries(Object.keys(defaults).map(key=>[key,values[key]])),easing:ease};
    const index=layer.keyframes.findIndex(existing=>Math.abs(existing.time-rounded)<.0005);
    if(index<0)layer.keyframes.push(frame);else layer.keyframes[index]=frame;
    layer.keyframes.sort((a,b)=>a.time-b.time);return frame;
  }
  return {defaults,easings,prepareSource,create,validate,sample,setFrame};
});
