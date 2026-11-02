'use strict';

// Versioned, bounded creative color transforms shared by all render paths.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomColorLook=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  const channels=['master','red','green','blue'], ranges=['red','yellow','green','cyan','blue','magenta'], regions=['shadows','midtones','highlights'];
  const effectSpecs=Object.freeze({grain:[0,100],vignette:[-100,100],sharpen:[0,100]});
  const identity=[0,.25,.5,.75,1],maxCubeBytes=2*1024*1024,maxCubeSize=33;
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
  const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
  function keys(value,allowed,label){if(!plain(value))throw new Error(label+' must be an object.');for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error('Unsupported '+label+' field: '+key+'.');}
  function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('Invalid '+label+'.');return value;}
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
  const lutCache=new WeakMap(),lookCache=new WeakMap(),compiledCache=new WeakMap(),typedLutCache=new WeakMap();
  function lut(input){
    if(input===null||input===undefined)return null;if(lutCache.has(input))return lutCache.get(input);
    keys(input,['title','size','domain_min','domain_max','data'],'LUT');
    const size=number(input.size,2,maxCubeSize,'LUT size');if(!Number.isInteger(size))throw new Error('LUT size must be an integer.');
    const title=input.title===undefined?'Imported LUT':input.title;if(typeof title!=='string'||title.length>100||/[\x00-\x1f\x7f]/.test(title))throw new Error('Invalid LUT title.');
    const vector=(value,fallback,label)=>{const result=value===undefined?fallback:value;if(!Array.isArray(result)||result.length!==3)throw new Error('Invalid LUT '+label+'.');return result.map(n=>number(n,-4,4,'LUT '+label));};
    const domain_min=vector(input.domain_min,[0,0,0],'domain minimum'),domain_max=vector(input.domain_max,[1,1,1],'domain maximum');
    if(domain_min.some((n,i)=>n>=domain_max[i]))throw new Error('Each LUT domain minimum must be below its maximum.');
    if(!Array.isArray(input.data)||input.data.length!==size**3*3)throw new Error('The LUT has the wrong number of color values.');
    const data=input.data.map(value=>number(value,-4,4,'LUT entry'));
    const result=freeze({title,size,domain_min,domain_max,data});lutCache.set(input,result);lutCache.set(result,result);return result;
  }
  function validate(input){
    if(input===undefined||input===null)return neutral;if(lookCache.has(input))return lookCache.get(input);
    keys(input,['curves','hsl','wheels','lut','grain','grain_seed','vignette','sharpen'],'creative look');
    const curves={},hsl={},wheels={};
    if(input.curves!==undefined)keys(input.curves,channels,'curves');
    for(const channel of channels){const values=input.curves?.[channel]??identity;if(!Array.isArray(values)||values.length!==5)throw new Error('A curve needs five values.');curves[channel]=values.map(value=>number(value,0,1,channel+' curve'));}
    if(input.hsl!==undefined)keys(input.hsl,ranges,'HSL');
    for(const range of ranges){const value=input.hsl?.[range]??{};keys(value,['hue','saturation','luminance'],'HSL range');hsl[range]={hue:number(value.hue??0,-30,30,'HSL hue'),saturation:number(value.saturation??0,-100,100,'HSL saturation'),luminance:number(value.luminance??0,-100,100,'HSL luminance')};}
    if(input.wheels!==undefined)keys(input.wheels,regions,'color wheels');
    for(const region of regions){const value=input.wheels?.[region]??{};keys(value,['color','amount'],'color wheel');const color=value.color??'#ffffff';if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Invalid color wheel color.');wheels[region]={color:color.toLowerCase(),amount:number(value.amount??0,-100,100,'color wheel amount')};}
    const grain=number(input.grain??0,0,100,'grain'),grain_seed=number(input.grain_seed??1,0,2147483647,'grain seed');if(!Number.isInteger(grain_seed))throw new Error('Grain seed must be an integer.');
    const result=freeze({curves,hsl,wheels,lut:lut(input.lut),grain,grain_seed,vignette:number(input.vignette??0,-100,100,'vignette'),sharpen:number(input.sharpen??0,0,100,'sharpen')});
    lookCache.set(input,result);lookCache.set(result,result);return result;
  }
  const neutral=validate({});
  function compile(look){
    if(compiledCache.has(look))return compiledCache.get(look);
    const curvesActive=channels.some(channel=>look.curves[channel].some((value,i)=>value!==identity[i]));
    const hslActive=ranges.some(range=>Object.values(look.hsl[range]).some(value=>value!==0));
    const wheelsActive=regions.some(region=>look.wheels[region].amount!==0);
    const curves={};if(curvesActive)for(const channel of channels){const source=look.curves[channel],table=new Float32Array(1025);for(let i=0;i<table.length;i++){const x=i/1024*4,index=Math.min(3,Math.floor(x)),fraction=x-index;table[i]=source[index]+(source[index+1]-source[index])*fraction;}curves[channel]=table;}
    const wheels=regions.map(region=>{const {color,amount}=look.wheels[region],r=parseInt(color.slice(1,3),16),g=parseInt(color.slice(3,5),16),b=parseInt(color.slice(5,7),16),gray=.2126*r+.7152*g+.0722*b;return [(r-gray)*amount/400,(g-gray)*amount/400,(b-gray)*amount/400];});
    let compiledLut=null;if(look.lut){compiledLut=typedLutCache.get(look.lut);if(!compiledLut){compiledLut={...look.lut,data:Float32Array.from(look.lut.data)};typedLutCache.set(look.lut,compiledLut);}}
    const result={curvesActive,hslActive,wheelsActive,curves,wheels,lut:compiledLut,active:curvesActive||hslActive||wheelsActive||!!look.lut||!!look.grain||!!look.vignette||!!look.sharpen};compiledCache.set(look,result);return result;
  }
  function active(look){return compile(look||neutral).active;}
  function hasSettings(look){look=look||neutral;return active(look)||look.grain_seed!==1||regions.some(region=>look.wheels[region].color!=='#ffffff');}
  const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  function parseCube(text){
    if(typeof text!=='string'||new TextEncoder().encode(text).length>maxCubeBytes)throw new Error('.cube files must be 2 MiB or smaller.');
    let size=null,title='Imported LUT',domain_min=[0,0,0],domain_max=[1,1,1],seenMin=false,seenMax=false,seenTitle=false,reading=false;const data=[];
    for(const original of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
      if(original.length>1024)throw new Error('A .cube line is too long.');const line=original.split('#',1)[0].trim();if(!line)continue;
      const parts=line.split(/\s+/),directive=parts[0].toUpperCase();
      if(directive==='TITLE'){if(reading||seenTitle)throw new Error('Duplicate or misplaced LUT title.');const match=/^TITLE\s+"([^"\r\n]*)"\s*$/i.exec(line);if(!match)throw new Error('The .cube TITLE must be quoted.');title=match[1];seenTitle=true;continue;}
      if(directive==='LUT_3D_SIZE'){if(reading||size!==null||parts.length!==2||!/^\d+$/.test(parts[1]))throw new Error('Invalid or duplicate LUT_3D_SIZE.');size=Number(parts[1]);if(size<2||size>maxCubeSize)throw new Error('.cube 3D sizes from 2 to '+maxCubeSize+' are supported.');continue;}
      if(directive==='DOMAIN_MIN'||directive==='DOMAIN_MAX'){if(reading||parts.length!==4||parts.slice(1).some(value=>!numeric.test(value)))throw new Error('Invalid .cube domain.');if(directive==='DOMAIN_MIN'){if(seenMin)throw new Error('Duplicate DOMAIN_MIN.');domain_min=parts.slice(1).map(Number);seenMin=true;}else{if(seenMax)throw new Error('Duplicate DOMAIN_MAX.');domain_max=parts.slice(1).map(Number);seenMax=true;}continue;}
      if(size===null||parts.length!==3||parts.some(value=>!numeric.test(value)))throw new Error('Unsupported or malformed .cube directive: '+parts[0]+'. Only 3D LUTs are supported.');
      reading=true;for(const part of parts)data.push(Number(part));if(data.length>size**3*3)throw new Error('The .cube file contains too many entries.');
    }
    if(size===null)throw new Error('The .cube file has no LUT_3D_SIZE.');return lut({title,size,domain_min,domain_max,data});
  }
  function sampleLut(lut,r,g,b,out){
    const n=lut.size,rd=clamp((r-lut.domain_min[0])/(lut.domain_max[0]-lut.domain_min[0]),0,1)*(n-1),gd=clamp((g-lut.domain_min[1])/(lut.domain_max[1]-lut.domain_min[1]),0,1)*(n-1),bd=clamp((b-lut.domain_min[2])/(lut.domain_max[2]-lut.domain_min[2]),0,1)*(n-1);
    const r0=Math.floor(rd),g0=Math.floor(gd),b0=Math.floor(bd),r1=Math.min(n-1,r0+1),g1=Math.min(n-1,g0+1),b1=Math.min(n-1,b0+1),fr=rd-r0,fg=gd-g0,fb=bd-b0,data=lut.data;
    const a=((b0*n+g0)*n+r0)*3,b_=((b0*n+g0)*n+r1)*3,c=((b0*n+g1)*n+r0)*3,d=((b0*n+g1)*n+r1)*3,e=((b1*n+g0)*n+r0)*3,f=((b1*n+g0)*n+r1)*3,g_=((b1*n+g1)*n+r0)*3,h=((b1*n+g1)*n+r1)*3;
    for(let i=0;i<3;i++){const low=(data[a+i]*(1-fr)+data[b_+i]*fr)*(1-fg)+(data[c+i]*(1-fr)+data[d+i]*fr)*fg,high=(data[e+i]*(1-fr)+data[f+i]*fr)*(1-fg)+(data[g_+i]*(1-fr)+data[h+i]*fr)*fg;out[i]=low*(1-fb)+high*fb;}
  }
  function hueChannel(p,q,t){if(t<0)t+=1;else if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
  function apply(data,width,height,look,mix=1){
    if(!look||!mix)return data;const c=compile(look);if(!c.active)return data;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height*4!==data.length)throw new Error('Creative effects require matching image dimensions.');
    const out=[0,0,0],curve=(table,value)=>table[Math.round(clamp(value/255,0,1)*1024)]*255;
    for(let i=0;i<data.length;i+=4){
      if(!data[i+3])continue;let r=data[i],g=data[i+1],b=data[i+2];
      if(c.curvesActive){r+=mix*(curve(c.curves.master,r)-r);g+=mix*(curve(c.curves.master,g)-g);b+=mix*(curve(c.curves.master,b)-b);r+=mix*(curve(c.curves.red,r)-r);g+=mix*(curve(c.curves.green,g)-g);b+=mix*(curve(c.curves.blue,b)-b);}
      if(c.hslActive){
        let rr=clamp(r/255,0,1),gg=clamp(g/255,0,1),bb=clamp(b/255,0,1),max=Math.max(rr,gg,bb),min=Math.min(rr,gg,bb),delta=max-min,l=(max+min)/2;
        if(delta>1e-8){let h=max===rr?((gg-bb)/delta+(gg<bb?6:0)):max===gg?(bb-rr)/delta+2:(rr-gg)/delta+4;const sector=Math.min(5,Math.floor(h)),fraction=h-sector,first=look.hsl[ranges[sector]],second=look.hsl[ranges[(sector+1)%6]],hue=first.hue*(1-fraction)+second.hue*fraction,saturation=first.saturation*(1-fraction)+second.saturation*fraction,luminance=first.luminance*(1-fraction)+second.luminance*fraction;let sat=delta/(1-Math.abs(2*l-1));
          h=h/6+hue*mix/360;if(h<0)h+=1;else if(h>=1)h-=1;sat=clamp(sat*(1+saturation/100*mix),0,1);l=clamp(l+luminance/100*.5*mix,0,1);
          const q=l<.5?l*(1+sat):l+sat-l*sat,p=2*l-q;r=hueChannel(p,q,h+1/3)*255;g=hueChannel(p,q,h)*255;b=hueChannel(p,q,h-1/3)*255;
        }
      }
      if(c.wheelsActive){const l=clamp((.2126*r+.7152*g+.0722*b)/255,0,1),shadow=(1-l)*(1-l),middle=4*l*(1-l),highlight=l*l,w=c.wheels;r+=(w[0][0]*shadow+w[1][0]*middle+w[2][0]*highlight)*mix;g+=(w[0][1]*shadow+w[1][1]*middle+w[2][1]*highlight)*mix;b+=(w[0][2]*shadow+w[1][2]*middle+w[2][2]*highlight)*mix;}
      if(c.lut){sampleLut(c.lut,r/255,g/255,b/255,out);r+=mix*(out[0]*255-r);g+=mix*(out[1]*255-g);b+=mix*(out[2]*255-b);}
      if(look.grain||look.vignette){const pixel=i/4,x=pixel%width,y=Math.floor(pixel/width);if(look.vignette){const dx=(x+.5)/width*2-1,dy=(y+.5)/height*2-1,factor=1-look.vignette/100*.65*(dx*dx+dy*dy)/2*mix;r*=factor;g*=factor;b*=factor;}if(look.grain){let hash=Math.imul(x+look.grain_seed,374761393)^Math.imul(y+look.grain_seed,668265263);hash=Math.imul(hash^(hash>>>13),1274126177);const noise=((hash>>>0)/4294967295-.5)*look.grain*.6*mix;r+=noise;g+=noise;b+=noise;}}
      data[i]=clamp(r,0,255);data[i+1]=clamp(g,0,255);data[i+2]=clamp(b,0,255);
    }
    if(look.sharpen){const source=new Uint8ClampedArray(data),amount=look.sharpen/100*mix;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(!source[i+3])continue;const left=x>0?i-4:-1,right=x+1<width?i+4:-1,top=y>0?i-width*4:-1,bottom=y+1<height?i+width*4:-1;for(let ch=0;ch<3;ch++){let sum=0,count=0;if(left>=0&&source[left+3]){sum+=source[left+ch];count++;}if(right>=0&&source[right+3]){sum+=source[right+ch];count++;}if(top>=0&&source[top+3]){sum+=source[top+ch];count++;}if(bottom>=0&&source[bottom+3]){sum+=source[bottom+ch];count++;}if(count)data[i+ch]=clamp(source[i+ch]+amount*(source[i+ch]-sum/count),0,255);}}}
    return data;
  }
  return {channels,ranges,regions,effectSpecs,maxCubeBytes,maxCubeSize,neutral,validate,active,hasSettings,parseCube,apply};
});
