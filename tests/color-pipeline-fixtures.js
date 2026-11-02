'use strict';

// Fixed inputs for the version 3.0 color-rendering compatibility snapshots.
function pixels(width,height){
  const data=new Uint8ClampedArray(width*height*4);let seed=0x61c88647;
  for(let i=0;i<data.length;i+=4){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    data[i]=seed>>>24;data[i+1]=(seed>>>16)&255;data[i+2]=(seed>>>8)&255;
    data[i+3]=[0,1,64,127,200,255][(seed>>>4)%6];
  }
  return data;
}
function cases(Look){
  const lut=Look.parseCube('TITLE "Reference"\nLUT_3D_SIZE 2\n0.02 0.04 0.06\n0.9 0.12 0.03\n0.04 0.85 0.1\n0.95 0.92 0.2\n0.05 0.15 0.8\n0.9 0.18 0.95\n0.12 0.9 0.92\n1 1 1\n');
  const primary={exposure_ev:.35,temperature:35,tint:-22,highlights:-45,shadows:30,whites:23,blacks:-17,vibrance:42};
  const curves={master:[0,.15,.48,.86,1],red:[0,.32,.55,.8,1],green:[0,.25,.5,.75,1],blue:[.03,.27,.53,.73,.97]};
  const hsl={red:{hue:18,saturation:25,luminance:-12},yellow:{hue:-8,saturation:-35,luminance:18},blue:{hue:22,saturation:40,luminance:5}};
  const wheels={shadows:{color:'#3299ff',amount:36},midtones:{color:'#f4a060',amount:-24},highlights:{color:'#ffffaa',amount:17}};
  return [
    {name:'identity',width:1,height:1,adjustments:{},look:{}},
    {name:'primaries',width:97,height:37,adjustments:primary,look:{}},
    {name:'primary-no-tones',width:97,height:37,adjustments:{exposure_ev:.2,temperature:12,vibrance:10},look:{}},
    {name:'curves',width:97,height:37,adjustments:{},look:{curves}},
    {name:'hsl',width:97,height:37,adjustments:{},look:{hsl}},
    {name:'wheels',width:97,height:37,adjustments:{},look:{wheels}},
    {name:'lut',width:97,height:37,adjustments:{},look:{lut}},
    {name:'finishing',width:97,height:37,adjustments:{},look:{grain:37,grain_seed:912,vignette:-42,sharpen:50}},
    {name:'all-half-strength',width:97,height:37,adjustments:primary,look:{curves,hsl,wheels,lut,grain:23,grain_seed:11,vignette:33,sharpen:24},mix:.37},
    {name:'all-full-strength',width:64,height:33,adjustments:primary,look:{curves,hsl,wheels,lut,grain:51,grain_seed:99,vignette:-62,sharpen:80}},
    {name:'opaque-sharpen',width:127,height:53,opaque:true,adjustments:primary,look:{hsl,grain:17,grain_seed:77,vignette:24,sharpen:65}},
    {name:'narrow-sharpen',width:1,height:19,adjustments:{},look:{sharpen:100,grain:4}}
  ];
}
function* variedCases(Look){
  let seed=987654321;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const pick=(min,max)=>min+(max-min)*random(),integer=(min,max)=>Math.floor(pick(min,max+1)),chance=probability=>random()<probability;
  for(let n=0;n<128;n++){
    const width=n%16<4?n%4+1:integer(1,80),height=n%24<4?n%4+1:integer(1,60),data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<data.length;i+=4){data[i]=integer(0,255);data[i+1]=integer(0,255);data[i+2]=integer(0,255);data[i+3]=n%2?255:[0,1,64,127,255][integer(0,4)];}
    const adjustments={exposure_ev:chance(.5)?0:pick(-2,2),temperature:chance(.5)?0:pick(-100,100),tint:chance(.5)?0:pick(-100,100),vibrance:chance(.5)?0:pick(-100,100)};
    for(const key of ['highlights','shadows','whites','blacks'])adjustments[key]=chance(.7)?0:pick(-100,100);
    const curves={},hsl={},wheels={};
    for(const key of Look.channels)curves[key]=chance(.5)?[0,.25,.5,.75,1]:Array.from({length:5},()=>random());
    for(const key of Look.ranges)hsl[key]={hue:chance(.6)?0:pick(-30,30),saturation:chance(.6)?0:pick(-100,100),luminance:chance(.6)?0:pick(-100,100)};
    for(const key of Look.regions)wheels[key]={color:'#'+integer(0,0xffffff).toString(16).padStart(6,'0'),amount:chance(.5)?0:pick(-100,100)};
    const look={curves,hsl,wheels,grain:chance(.5)?0:pick(0,100),grain_seed:integer(0,2147483647),vignette:chance(.5)?0:pick(-100,100),sharpen:chance(.2)?0:pick(0,100)};
    yield {width,height,data,adjustments,look,mix:random()};
  }
}
module.exports={pixels,cases,variedCases};
