import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port,phrases={eng:'HELLO WORLD',fra:'BONJOUR ÉLÈVE',spa:'HOLA MAÑANA',ita:'CIAO CITTÀ'};
let temp,work,server,browser,page,client;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-pixel-ocr-'));work=path.join(temp,'work');await fs.mkdir(work);server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(new Error('Server exited '+code)));server.stdout.on('data',chunk=>{if(String(chunk).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});client=new Client({name:'pixel-ocr-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(base+'/pixelroom/');await page.locator('#layersList [data-layer]').first().waitFor();for(const [language,text] of Object.entries(phrases)){const data=await page.evaluate(text=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=200;const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.fillStyle='black';context.font='bold 76px Arial';context.textBaseline='middle';context.fillText(text,25,100);return canvas.toDataURL('image/png').split(',')[1];},text);await fs.writeFile(path.join(work,language+'.png'),Buffer.from(data,'base64'));}});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-pixel-ocr-'));await fs.rm(actual,{recursive:true,force:true});}});

test('the local browser switches among English, French, Spanish and Italian models',async()=>{
  for(const [language,phrase] of Object.entries(phrases)){const result=await page.evaluate(async({language,phrase})=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=200;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,900,200);c.fillStyle='black';c.font='bold 76px Arial';c.textBaseline='middle';c.fillText(phrase,25,100);return PixelRoomOCR.recognize(canvas,language,'block');},{language,phrase});assert.equal(result.language,language);assert.match(result.text.toUpperCase(),new RegExp(phrase.split(' ')[0]));assert.ok(result.lines.length>0);}
});

test('MCP recognizes each supported language with bounded source coordinates',async()=>{
  for(const [language,phrase] of Object.entries(phrases)){const result=await call('pixelroom_recognize_text',{input:language+'.png',language});assert.equal(result.language,language);assert.match(result.text.toUpperCase(),new RegExp(phrase.split(' ')[0]));assert.equal(result.source_width,900);assert.ok(result.lines[0].box.width>0);assert.ok(result.lines[0].box.x>=0);}
  await assert.rejects(call('pixelroom_recognize_text',{input:'eng.png',language:'deu'}));
});

test('the editor uses its selected language and carries it into text conversion',async()=>{
  await page.locator('#imageInput').setInputFiles(path.join(work,'fra.png'));await page.waitForFunction(()=>document.querySelector('#editorCanvas').width===900);await page.evaluate(()=>{PixelVision.contrastTextRegions=()=>[];});await page.locator('[data-tab=isolate]').click();await page.locator('#ocrLanguage').selectOption('fra');await page.locator('#findTextBtn').click();await page.locator('[data-detection-index="0"]').waitFor({timeout:30000});assert.match((await page.locator('[data-detection-index="0"]').textContent()).toUpperCase(),/BONJOUR/);await page.locator('[data-detection-index="0"]').click();await page.locator('#isolateTextBtn').click();await page.locator('#inpaintOriginal').uncheck();await page.locator('#applyMaskBtn').click();await page.locator('#textConversionDialog').waitFor({state:'visible'});assert.equal(await page.locator('#conversionLanguage').inputValue(),'fra');await page.locator('#conversionLanguage').selectOption('spa');assert.match(await page.locator('#conversionStatus').textContent(),/Read again/);await page.locator('#closeTextConversion').click();
});
