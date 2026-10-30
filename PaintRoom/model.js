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
        else if(!coord(o.x)||!coord(o.y)||!coord(o.x2)||!coord(o.y2)||!color(o.color)||!finite(o.width,.5,300)||!(o.fill===null||color(o.fill))||(o.stroke!==undefined&&typeof o.stroke!=='boolean')||(o.type==='line'&&o.stroke===false))throw new Error('Invalid shape.');
      }
    }return project;
  }
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function svg(project){validate(project);if(project.layers.some(l=>l.objects.some(o=>o.type==='image'||(o.type==='stroke'&&o.erase))))throw new Error('SVG export is available for artwork without photos or eraser strokes. Use PNG for this project.');
    const w=project.width,h=project.height,out=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];if(project.background)out.push(`<rect width="${w}" height="${h}" fill="${project.background}"/>`);
    for(const l of project.layers){if(!l.visible)continue;out.push(`<g opacity="${l.opacity}" transform="translate(${w/2+l.x} ${h/2+l.y}) rotate(${l.rotation}) scale(${l.scale}) translate(${-w/2} ${-h/2})">`);
      for(const o of l.objects){const style=`opacity="${o.opacity}" stroke="${o.stroke===false?'none':esc(o.color)}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round"`;
        if(o.type==='stroke'){const d=o.points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');out.push(`<path d="${d}${o.points.length===1?' l 0.001 0':''}" ${style} fill="none"/>`);}
        else if(o.type==='line')out.push(`<line x1="${o.x}" y1="${o.y}" x2="${o.x2}" y2="${o.y2}" ${style}/>`);
        else{const x=Math.min(o.x,o.x2),y=Math.min(o.y,o.y2),width=Math.abs(o.x2-o.x),height=Math.abs(o.y2-o.y),fill=o.fill||'none';
          if(o.type==='rect')out.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" ${style} fill="${fill}"/>`);
          else out.push(`<ellipse cx="${x+width/2}" cy="${y+height/2}" rx="${width/2}" ry="${height/2}" ${style} fill="${fill}"/>`);}}
      out.push('</g>');}out.push('</svg>');return out.join('');}
  function toVector(project){
    validate(project);const output=[],fit=Math.min(1000/project.width,700/project.height),ox=(1000-project.width*fit)/2,oy=(700-project.height*fit)/2;
    const base=(fill,stroke,width)=>({fillMode:fill?'solid':'none',fill:fill||'#000000',fill2:fill||'#000000',stroke:stroke||'#000000',strokeWidth:width});
    if(project.background)output.push({type:'rect',x:ox,y:oy,width:project.width*fit,height:project.height*fit,...base(project.background,null,0)});
    for(const l of project.layers){if(!l.visible)continue;if(l.opacity!==1)throw new Error('VectorRoom transfer requires opaque layers. Use PNG for transparent layers.');
      const angle=l.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
      const transform=p=>{const x=(p.x-project.width/2)*l.scale,y=(p.y-project.height/2)*l.scale;return {x:ox+fit*(project.width/2+l.x+x*cos-y*sin),y:oy+fit*(project.height/2+l.y+x*sin+y*cos)};};
      const node=(point,inHandle=point,outHandle=point)=>{const p=transform(point),i=transform(inHandle),o=transform(outHandle);return {x:p.x,y:p.y,inX:i.x,inY:i.y,outX:o.x,outY:o.y};};
      for(const item of l.objects){
        if(item.type==='image'||item.erase)throw new Error('VectorRoom transfer supports vector artwork without photos or eraser strokes. Use PNG for this artwork.');
        if(item.opacity!==1)throw new Error('VectorRoom transfer requires opaque objects. Use PNG for transparent artwork.');
        const width=(item.stroke===false?0:item.width*l.scale*fit);if(width>100)throw new Error('A stroke is too wide for VectorRoom. Reduce the stroke or layer scale.');
        const radius=item.stroke===false?0:item.width/2,points=item.type==='stroke'?item.points:item.type==='line'?[{x:item.x,y:item.y},{x:item.x2,y:item.y2}]:[{x:item.x,y:item.y},{x:item.x2,y:item.y},{x:item.x2,y:item.y2},{x:item.x,y:item.y2}];
        for(const p of points){const q=transform(p),r=radius*l.scale*fit;if(p.x-radius<0||p.y-radius<0||p.x+radius>project.width||p.y+radius>project.height||q.x-r<ox||q.y-r<oy||q.x+r>ox+project.width*fit||q.y+r>oy+project.height*fit)throw new Error('Artwork clipped by the canvas must be flattened for VectorRoom.');}
        const style=base(item.fill,item.color,width),add=(points,closed)=>output.push({type:'path',points,closed,...style});
        if(item.type==='stroke'){
          const points=item.points;if(points.length===1){const p=points[0];add([node(p),node({x:p.x+.001,y:p.y})],false);}
          else for(let i=0;i<points.length-1;i+=4999)add(points.slice(i,Math.min(points.length,i+5000)).map(p=>node(p)),false);
        }else if(item.type==='line')add([node({x:item.x,y:item.y}),node({x:item.x2,y:item.y2})],false);
        else {const x=Math.min(item.x,item.x2),y=Math.min(item.y,item.y2),w=Math.abs(item.x2-item.x),h=Math.abs(item.y2-item.y);
          if(item.type==='rect')add([{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}].map(p=>node(p)),true);
          else {const cx=x+w/2,cy=y+h/2,rx=w/2,ry=h/2,k=.5522847498307936;
            add([node({x:cx+rx,y:cy},{x:cx+rx,y:cy-ry*k},{x:cx+rx,y:cy+ry*k}),node({x:cx,y:cy+ry},{x:cx+rx*k,y:cy+ry},{x:cx-rx*k,y:cy+ry}),node({x:cx-rx,y:cy},{x:cx-rx,y:cy+ry*k},{x:cx-rx,y:cy-ry*k}),node({x:cx,y:cy-ry},{x:cx-rx*k,y:cy-ry},{x:cx+rx*k,y:cy-ry})],true);}
        }
      }
    }
    if(output.length>1000)throw new Error('VectorRoom supports up to 1,000 objects per project.');
    for(const item of output)for(const p of item.points||[])for(const value of Object.values(p))if(!coord(value))throw new Error('Artwork extends beyond VectorRoom’s coordinate range.');
    return {format:'vectorroom',version:1,objects:output};
  }
  return {empty,layer,validate,svg,toVector};
});
