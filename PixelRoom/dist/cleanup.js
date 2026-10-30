'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PixelCleanup=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  // A separable sliding window keeps mask expansion linear even for large brushes.
  function dilate(input,w,h,radius){
    const hor=new Uint8Array(w*h),out=new Uint8Array(w*h),r=Math.max(0,Math.round(radius));
    for(let y=0;y<h;y++){let count=0;for(let x=0;x<=Math.min(w-1,r);x++)count+=input[y*w+x]?1:0;for(let x=0;x<w;x++){hor[y*w+x]=count?1:0;if(x-r>=0)count-=input[y*w+x-r]?1:0;if(x+r+1<w)count+=input[y*w+x+r+1]?1:0;}}
    for(let x=0;x<w;x++){let count=0;for(let y=0;y<=Math.min(h-1,r);y++)count+=hor[y*w+x]?1:0;for(let y=0;y<h;y++){out[y*w+x]=count?1:0;if(y-r>=0)count-=hor[(y-r)*w+x]?1:0;if(y+r+1<h)count+=hor[(y+r+1)*w+x]?1:0;}}
    return out;
  }
  function feather(input,w,h,radius){
    const r=Math.max(0,Math.round(radius));if(!r)return Uint8Array.from(input,v=>v?255:0);
    const hor=new Uint8Array(w*h),out=new Uint8Array(w*h);
    for(let y=0;y<h;y++){let sum=0;for(let x=0;x<=Math.min(w-1,r);x++)sum+=input[y*w+x]*255;for(let x=0;x<w;x++){hor[y*w+x]=Math.round(sum/(Math.min(w-1,x+r)-Math.max(0,x-r)+1));if(x-r>=0)sum-=input[y*w+x-r]*255;if(x+r+1<w)sum+=input[y*w+x+r+1]*255;}}
    for(let x=0;x<w;x++){let sum=0;for(let y=0;y<=Math.min(h-1,r);y++)sum+=hor[y*w+x];for(let y=0;y<h;y++){out[y*w+x]=input[y*w+x]?Math.round(sum/(Math.min(h-1,y+r)-Math.max(0,y-r)+1)):0;if(y-r>=0)sum-=hor[(y-r)*w+x];if(y+r+1<h)sum+=hor[(y+r+1)*w+x];}}
    return out;
  }
  function plan(bounds){
    const bw=bounds.maxX-bounds.minX+1,bh=bounds.maxY-bounds.minY+1;
    let side=Math.ceil(Math.max(256,Math.min(2048,Math.min(bw,bh)*4),Math.max(bw,bh)/6));
    function positions(min,max){const first=min-side*.25,last=max+1-side*.75;if(last<=first)return [Math.floor((min+max+1-side)/2)];const steps=Math.ceil((last-first)/(side*.5));return Array.from({length:steps+1},(_,i)=>Math.floor(first+(last-first)*i/steps));}
    let xs=positions(bounds.minX,bounds.maxX),ys=positions(bounds.minY,bounds.maxY);
    while(xs.length*ys.length>16){side=Math.ceil(side*1.25);xs=positions(bounds.minX,bounds.maxX);ys=positions(bounds.minY,bounds.maxY);}
    return {side,tiles:ys.flatMap(top=>xs.map(left=>({left,top})))};
  }
  return {dilate,feather,plan};
});
