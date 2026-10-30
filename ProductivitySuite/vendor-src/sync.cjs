'use strict';
// Copy the published browser distributions and their dependency notices.
// Run npm ci --ignore-scripts in this directory before running this file.
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname,modules=path.join(root,'node_modules'),out=path.join(root,'..','vendor');
const files={
  'docx.js':'docx/dist/index.iife.js',
  'exceljs.js':'exceljs/dist/exceljs.min.js',
  'fflate.js':'fflate/umd/index.js',
  'jszip.js':'jszip/dist/jszip.min.js',
  'mammoth.js':'mammoth/mammoth.browser.min.js',
  'pptxgen.js':'pptxgenjs/dist/pptxgen.bundle.js'
};
fs.mkdirSync(out,{recursive:true});
for(const [target,source] of Object.entries(files))fs.copyFileSync(path.join(modules,source),path.join(out,target));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')),notices=[];
for(const [entry,meta] of Object.entries(lock.packages)){
  if(!entry.startsWith('node_modules/'))continue;
  const dir=path.join(root,entry),manifest=path.join(dir,'package.json');if(!fs.existsSync(manifest))continue;
  const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
  const license=fs.readdirSync(dir).find(name=>/^(license|licence|copying)(\..*)?$/i.test(name));
  notices.push('===== '+pkg.name+' '+pkg.version+' ('+(pkg.license||'see package')+') =====\n'+(license?fs.readFileSync(path.join(dir,license),'utf8'):'No separate license file in this package.')+'\n');
}
fs.writeFileSync(path.join(out,'THIRD_PARTY_LICENSES.txt'),notices.join('\n'));
console.log('Copied Office browser libraries and license notices.');
