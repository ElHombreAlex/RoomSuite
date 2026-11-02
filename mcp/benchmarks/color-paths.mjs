// Small exposure-like kernel used to compare transfer/readback costs, not the full RoomGrade pipeline.
import {chromium} from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';

const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Color path benchmark</title>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/');
  const measurements=await page.evaluate(async()=>{
    const width=1280,height=720,count=width*height,length=count*4,source=new Uint8Array(length);
    for(let i=0;i<count;i++){source[i*4]=(i*13)%256;source[i*4+1]=(i*7)%256;source[i*4+2]=(i*19)%256;source[i*4+3]=255;}
    const transform=data=>{for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){const v=data[i+c];data[i+c]=Math.min(255,v+Math.floor((v+2)/5)+4);}return data;};
    const expected=transform(source.slice()),difference=data=>{let max=0;for(let i=0;i<data.length;i++)max=Math.max(max,Math.abs(data[i]-expected[i]));return max;};
    const measure=async fn=>{await fn();const times=[];let output;for(let i=0;i<5;i++){const start=performance.now();output=await fn();times.push(performance.now()-start);}return {milliseconds:times,maxDifference:difference(output)};};
    const result={width,height,kernel:'Each RGB byte becomes min(255, value + floor((value + 2) / 5) + 4); alpha is unchanged.',iterations:5,paths:{}};
    result.paths.cpu_bytes=await measure(()=>transform(source.slice()));
    const original=document.createElement('canvas');original.width=width;original.height=height;const oc=original.getContext('2d',{willReadFrequently:true});oc.putImageData(new ImageData(new Uint8ClampedArray(source),width,height),0,0);
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d',{willReadFrequently:true});
    result.paths.canvas2d_cpu=await measure(()=>{ctx.drawImage(original,0,0);const image=ctx.getImageData(0,0,width,height);transform(image.data);ctx.putImageData(image,0,0);return image.data;});
    const workerUrl=URL.createObjectURL(new Blob([`onmessage=event=>{const data=new Uint8Array(event.data);for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){const v=data[i+c];data[i+c]=Math.min(255,v+Math.floor((v+2)/5)+4);}postMessage(data.buffer,[data.buffer]);};`],{type:'text/javascript'}));
    try{const worker=new Worker(workerUrl);try{result.paths.worker=await measure(()=>new Promise((resolve,reject)=>{worker.onmessage=event=>resolve(new Uint8Array(event.data));worker.onerror=reject;const copy=source.slice();worker.postMessage(copy.buffer,[copy.buffer]);}));}finally{worker.terminate();}}finally{URL.revokeObjectURL(workerUrl);}
    try{
      // This tiny WASM module applies the same integer kernel in linear memory.
      const leb=value=>{const bytes=[];do{let byte=value&127;value>>>=7;if(value)byte|=128;bytes.push(byte);}while(value);return bytes;},section=(id,bytes)=>[id,...leb(bytes.length),...bytes],name=value=>[...leb(value.length),...Array.from(value,ch=>ch.charCodeAt(0))];
      const code=[0x02,0x40,0x03,0x40,0x20,0x01,0x20,0x00,0x4f,0x0d,0x01];
      for(let c=0;c<3;c++)code.push(0x20,0x01,0x41,c,0x6a,0x20,0x01,0x41,c,0x6a,0x2d,0,0,0x21,0x02,0x20,0x02,0x20,0x02,0x41,2,0x6a,0x41,5,0x6e,0x6a,0x41,4,0x6a,0x21,0x02,0x20,0x02,0x41,0xff,0x01,0x20,0x02,0x41,0xff,0x01,0x49,0x1b,0x3a,0,0);
      code.push(0x20,0x01,0x41,4,0x6a,0x21,0x01,0x0c,0,0x0b,0x0b,0x0b);
      const body=[1,2,0x7f,...code],module=new Uint8Array([0,97,115,109,1,0,0,0,...section(1,[1,0x60,1,0x7f,0]),...section(3,[1,0]),...section(5,[1,0,64]),...section(7,[2,...name('memory'),2,0,...name('adjust'),0,0]),...section(10,[1,...leb(body.length),...body])]);
      const instance=(await WebAssembly.instantiate(module)).instance,view=new Uint8Array(instance.exports.memory.buffer,0,length);
      result.paths.wasm=await measure(()=>{view.set(source);instance.exports.adjust(length);return view.slice();});
    }catch(error){result.paths.wasm={unavailable:error.message};}
    try{
      const glCanvas=document.createElement('canvas');glCanvas.width=width;glCanvas.height=height;const gl=glCanvas.getContext('webgl2',{premultipliedAlpha:false,preserveDrawingBuffer:true});if(!gl)throw new Error('WebGL2 is unavailable.');
      function shader(type,text){const value=gl.createShader(type);gl.shaderSource(value,text);gl.compileShader(value);if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(value));return value;}
      const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'#version 300 es\nin vec2 p; out vec2 uv; void main(){uv=(p+1.0)*0.5;gl_Position=vec4(p,0,1);}'));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float; in vec2 uv; uniform sampler2D tex; out vec4 color; void main(){vec4 v=texture(tex,uv);vec3 b=floor(v.rgb*255.0+0.5);color=vec4(min(vec3(255),b+floor((b+2.0)/5.0)+4.0)/255.0,v.a);}'));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
      const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);const position=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.viewport(0,0,width,height);
      const renderer=gl.getExtension('WEBGL_debug_renderer_info');result.paths.webgl2=await measure(()=>{gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.drawArrays(gl.TRIANGLES,0,3);const output=new Uint8Array(length);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,output);return output;});result.paths.webgl2.renderer=renderer?gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    }catch(error){result.paths.webgl2={unavailable:error.message};}
    try{
      if(!navigator.gpu)throw new Error('WebGPU is unavailable in this browser context.');const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter is available.');const device=await adapter.requestDevice();
      const shader=device.createShaderModule({code:`@group(0) @binding(0) var<storage,read> src:array<u32>; @group(0) @binding(1) var<storage,read_write> dst:array<u32>; fn fix(v:u32)->u32{return min(255u,v+(v+2u)/5u+4u);} @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=arrayLength(&src)){return;}let p=src[i];dst[i]=fix(p&255u)|(fix((p>>8u)&255u)<<8u)|(fix((p>>16u)&255u)<<16u)|(p&0xff000000u);}`});
      const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module:shader,entryPoint:'main'}}),input=device.createBuffer({size:length,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),output=device.createBuffer({size:length,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:length,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]});
      result.paths.webgpu=await measure(async()=>{device.queue.writeBuffer(input,0,source);const commands=device.createCommandEncoder(),pass=commands.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();commands.copyBufferToBuffer(output,0,read,0,length);device.queue.submit([commands.finish()]);await read.mapAsync(GPUMapMode.READ);const result=new Uint8Array(read.getMappedRange().slice(0));read.unmap();return result;});
      result.paths.webgpu.adapter=adapter.info?{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter}:null;input.destroy();output.destroy();read.destroy();device.destroy();
    }catch(error){result.paths.webgpu={unavailable:error.message};}
    return result;
  });
  const result={recordedAt:new Date().toISOString(),os:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model.trim()},browser:browser.version(),...measurements},json=JSON.stringify(result,null,2)+'\n';if(process.argv[2])await fs.writeFile(process.argv[2],json);process.stdout.write(json);
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
