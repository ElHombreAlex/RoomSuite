'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PaintModel=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  const color=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
  const coord=n=>finite(n,-100000,100000);
  function layer(id,name='Layer 1'){return {id,name,visible:true,opacity:1,x:0,y:0,scale:1,rotation:0,objects:[]};}
  function empty(id,name='Untitled artwork',width=1200,height=800){return {format:'paintroom-project',version:1,name,width,height,background:'#ffffff',layers:[layer(id())]};}
  function validate(project){
    if(!project||project.format!=='paintroom-project'||project.version!==1||typeof project.name!=='string'||!project.name.trim()||project.name.length>160||!Number.isInteger(project.width)||!Number.isInteger(project.height)||project.width<1||project.width>4096||project.height<1||project.height>4096||!(project.background===null||color(project.background))||!Array.isArray(project.layers)||!project.layers.length||project.layers.length>100)throw new Error('Invalid PaintRoom project.');
    const ids=new Set();let total=0;
    for(const l of project.layers){if(!l||typeof l.id!=='string'||!l.id||ids.has(l.id)||typeof l.name!=='string'||l.name.length>160||typeof l.visible!=='boolean'||!finite(l.opacity,0,1)||!coord(l.x)||!coord(l.y)||!finite(l.scale,.1,4)||!finite(l.rotation,-36000,36000)||!Array.isArray(l.objects))throw new Error('Invalid PaintRoom layer.');ids.add(l.id);total+=l.objects.length;if(total>10000)throw new Error('Too many artwork elements.');
      for(const o of l.objects){if(!o||!['stroke','rect','ellipse','line','image'].includes(o.type)||!finite(o.opacity,0,1))throw new Error('Invalid artwork element.');
        if(o.type==='stroke'){if(!Array.isArray(o.points)||!o.points.length||o.points.length>50000||o.points.some(p=>!p||!coord(p.x)||!coord(p.y))||!color(o.color)||!finite(o.width,.5,300)||typeof o.erase!=='boolean')throw new Error('Invalid brush stroke.');}
        else if(o.type==='image'){if(typeof o.data!=='string'||!/^data:image\/(png|jpeg|webp|gif|avif);base64,[a-z0-9+/=]+$/i.test(o.data)||!coord(o.x)||!coord(o.y)||!finite(o.width,.1,16384)||!finite(o.height,.1,16384))throw new Error('Invalid embedded image.');}
        else if(!coord(o.x)||!coord(o.y)||!coord(o.x2)||!coord(o.y2)||!color(o.color)||!finite(o.width,.5,300)||!(o.fill===null||color(o.fill)))throw new Error('Invalid shape.');
      }
    }return project;
  }
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function svg(project){validate(project);if(project.layers.some(l=>l.objects.some(o=>o.type==='image'||(o.type==='stroke'&&o.erase))))throw new Error('SVG export is available for artwork without photos or eraser strokes. Use PNG for this project.');
    const w=project.width,h=project.height,out=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];if(project.background)out.push(`<rect width="${w}" height="${h}" fill="${project.background}"/>`);
    for(const l of project.layers){if(!l.visible)continue;out.push(`<g opacity="${l.opacity}" transform="translate(${w/2+l.x} ${h/2+l.y}) rotate(${l.rotation}) scale(${l.scale}) translate(${-w/2} ${-h/2})">`);
      for(const o of l.objects){const style=`opacity="${o.opacity}" stroke="${esc(o.color)}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round"`;
        if(o.type==='stroke'){const d=o.points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');out.push(`<path d="${d}${o.points.length===1?' l 0.001 0':''}" ${style} fill="none"/>`);}
        else if(o.type==='line')out.push(`<line x1="${o.x}" y1="${o.y}" x2="${o.x2}" y2="${o.y2}" ${style}/>`);
        else{const x=Math.min(o.x,o.x2),y=Math.min(o.y,o.y2),width=Math.abs(o.x2-o.x),height=Math.abs(o.y2-o.y),fill=o.fill||'none';
          if(o.type==='rect')out.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" ${style} fill="${fill}"/>`);
          else out.push(`<ellipse cx="${x+width/2}" cy="${y+height/2}" rx="${width/2}" ry="${height/2}" ${style} fill="${fill}"/>`);}}
      out.push('</g>');}out.push('</svg>');return out.join('');}
  return {empty,layer,validate,svg};
});
