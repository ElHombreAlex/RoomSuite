'use strict';
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./model'):root.ProductivityModel);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DeckTemplate=api;
})(typeof globalThis==='object'?globalThis:this,function(Model){
  const maxBytes=7*1024*1024,maxDeckRequestBytes=8*1024*1024;
  function validate(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['format','version','name','slide'].includes(key)))throw new Error('Invalid slide template.');
    if(input.format!=='roomsuite-slide-template'||input.version!==1)throw new Error('Unsupported slide template version.');
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160||/[\x00-\x1f\x7f]/.test(input.name))throw new Error('Invalid slide template name.');
    const state=Model.validate({format:Model.formats.decksuite,version:1,title:'Template',slides:[input.slide]},'decksuite');
    return {format:'roomsuite-slide-template',version:1,name:input.name,slide:state.slides[0]};
  }
  function parse(source){
    if(typeof source!=='string'||new TextEncoder().encode(source).length>maxBytes)throw new Error('Slide templates must be 7 MiB or smaller.');
    let input;try{input=JSON.parse(source);}catch{throw new Error('Slide template is not valid JSON.');}return validate(input);
  }
  function serialize(input){const result=JSON.stringify(validate(input));if(new TextEncoder().encode(result).length>maxBytes)throw new Error('The slide template exceeds 7 MiB.');return result;}
  function create(slide,name){return validate({format:'roomsuite-slide-template',version:1,name,slide});}
  function instantiate(input,makeId){const template=validate(input),slide=template.slide;return {...slide,id:makeId(),...(slide.elements?{elements:slide.elements.map(item=>({...item,id:makeId()}))}:{})};}
  function assertFits(state){const value=Model.validate(state,'decksuite'),request=JSON.stringify({baseRevision:'f'.repeat(64),state:value});if(new TextEncoder().encode(request).length>maxDeckRequestBytes)throw new Error('This presentation exceeds the 8 MiB save limit. Remove or resize images.');return value;}
  return {maxBytes,maxDeckRequestBytes,validate,parse,serialize,create,instantiate,assertFits};
});
