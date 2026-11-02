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
import JSZip from '../../ProductivitySuite/vendor/jszip.js';

const root=fileURLToPath(new URL('../../',import.meta.url)),port=24000+Math.floor(Math.random()*18000),base='http://127.0.0.1:'+port;
let temp,work,server,client,browser,page,doc;
async function call(name,args={}){const result=await client.callTool({name,arguments:args},{timeout:180000});if(result.isError)throw new Error(result.content.map(item=>item.text).join(' '));return result.structuredContent;}
before(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-word-comments-'));work=path.join(temp,'work');await fs.mkdir(work);server=spawn(process.execPath,[path.join(root,'server.js')],{env:{...process.env,CLIPROOM_PORT:String(port),CLIPROOM_DATA:path.join(temp,'data')},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);server.once('error',reject);server.once('exit',code=>reject(Error('Server exited '+code)));server.stdout.on('data',data=>{if(String(data).includes('RoomSuite is running')){clearTimeout(timer);resolve();}});});client=new Client({name:'word-comments-test',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'mcp/server.mjs')],env:{...process.env,ROOMSUITE_MCP_MODE:'full',ROOMSUITE_MCP_WORKSPACE:work,ROOMSUITE_MCP_URL:base},stderr:'pipe'}));browser=await chromium.launch({headless:true,...(process.env.ROOMSUITE_BROWSER_PATH?{executablePath:process.env.ROOMSUITE_BROWSER_PATH}:{})});page=await browser.newPage({viewport:{width:1440,height:1000}});});
after(async()=>{if(browser)await browser.close();if(client)await client.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}if(temp){const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-word-comments-'));await fs.rm(actual,{recursive:true,force:true});}});

test('an anchored comment survives an agent Word export and import with real Word range markup',async()=>{
  doc=await call('docsuite_create',{path:'source.docsuite',title:'Notes',text:'Hello brave world'});doc=await call('docsuite_add_comment',{path:'source.docsuite',base_revision:doc.revision,text:'Please review',author:'Alex',anchor_quote:'brave'});doc=await call('docsuite_update_comment',{path:'source.docsuite',base_revision:doc.revision,comment_id:doc.state.comments[0].id,resolved:true});doc=await call('docsuite_add_comment',{path:'source.docsuite',base_revision:doc.revision,text:'General note'});
  const exported=await call('docsuite_export_docx',{path:'source.docsuite',output:'comments.docx'});assert.ok(exported.warnings.some(value=>/not included/i.test(value)));assert.ok(exported.warnings.some(value=>/resolved status/i.test(value)));const archive=await JSZip.loadAsync(await fs.readFile(path.join(work,'comments.docx'))),xml=await archive.file('word/document.xml').async('string'),comments=await archive.file('word/comments.xml').async('string');assert.match(xml,/<w:commentRangeStart/);assert.match(xml,/<w:commentRangeEnd/);assert.match(xml,/<w:commentReference/);assert.match(comments,/Please review/);assert.match(comments,/Alex/);assert.doesNotMatch(comments,/General note/);
  const imported=await call('docsuite_import_docx',{path:'imported.docsuite',input:'comments.docx'});assert.equal(imported.state.version,2);assert.equal(imported.state.comments.length,1);assert.equal(imported.state.comments[0].text,'Please review');assert.equal(imported.state.comments[0].author,'Alex');assert.equal(imported.state.comments[0].anchor.text,'brave');
});

test('the editor imports the same Word comment and selects its anchored text',async()=>{
  await page.goto(base+'/docsuite/');page.on('dialog',dialog=>dialog.accept());await page.locator('#officeInput').setInputFiles(path.join(work,'comments.docx'));await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Imported '));assert.match(await page.locator('#docComments').textContent(),/Please review/);assert.match(await page.locator('#docComments').textContent(),/Linked to text/);await page.locator('#docComments button').filter({hasText:'Show text'}).click();assert.equal(await page.evaluate(()=>window.getSelection().toString()),'brave');
});

test('styled text preserves its comment and unsupported overlapping anchors are reported',async()=>{
  const result=await page.evaluate(async()=>{const html='<p>Hello <b>brave</b> world</p>',comments=[{text:'Styled',author:'Alex',anchor:{start:6,end:11,text:'brave',orphaned:false}},{text:'Overlap',author:'',anchor:{start:7,end:10,text:'rav',orphaned:false}}],output=await RoomOffice.writeDocx(html,'Styled',comments),round=await RoomOffice.readDocx(await output.blob.arrayBuffer());return {warnings:output.warnings,comments:round.comments,html:round.html};});assert.ok(result.warnings.some(value=>/overlap/i.test(value)));assert.match(result.html,/<strong>|<b>/);assert.equal(result.comments.length,1);assert.equal(result.comments[0].anchor.text,'brave');
});

test('Word comments on repeated words use their range position instead of the first matching word',async()=>{
  const result=await page.evaluate(async()=>{await RoomOffice.writeDocx('<p>load</p>','Load');const D=window.docx,document=new D.Document({comments:{children:[{id:0,author:'Reviewer',children:[new D.Paragraph('Second word')]}]},sections:[{children:[new D.Paragraph({children:[new D.TextRun('same '),new D.CommentRangeStart(0),new D.TextRun('same'),new D.CommentRangeEnd(0),new D.TextRun({children:[new D.CommentReference(0)]})]})]}]});return RoomOffice.readDocx(await (await D.Packer.toBlob(document)).arrayBuffer());});assert.equal(result.comments.length,1);assert.equal(result.comments[0].anchor.text,'same');assert.equal(result.comments[0].anchor.start,5);
});

test('ambiguous Word text is imported as a general comment instead of guessing an anchor',async()=>{
  const result=await page.evaluate(async()=>{const D=window.docx,document=new D.Document({comments:{children:[{id:0,author:'Reviewer',children:[new D.Paragraph('Needs review')]}]},sections:[{children:[new D.Paragraph({children:[new D.TextRun({children:['same',new D.Tab()]}),new D.CommentRangeStart(0),new D.TextRun('same'),new D.CommentRangeEnd(0),new D.TextRun({children:[new D.CommentReference(0)]})]})]}]});return RoomOffice.readDocx(await (await D.Packer.toBlob(document)).arrayBuffer());});assert.equal(result.comments.length,1);assert.equal(result.comments[0].anchor,undefined);assert.ok(result.warnings.some(value=>/general comment/i.test(value)));
});
