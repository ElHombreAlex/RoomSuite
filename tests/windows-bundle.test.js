'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');

test('Windows bundle stages application files without local data or dependency directories',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'roomsuite-bundle-test-')),dest=path.join(temp,'app');
  try {
    const run=()=>spawnSync(process.execPath,[path.join(root,'windows','prepare-bundle.cjs'),dest],{encoding:'utf8'});
    const result=run();assert.equal(result.status,0,result.stderr);
    await fs.access(path.join(dest,'server.js'));await fs.access(path.join(dest,'RELEASE_NOTES.md'));await fs.access(path.join(dest,'COLOR_GRADING.md'));await fs.access(path.join(dest,'PERFORMANCE.md'));await fs.access(path.join(dest,'UPGRADE_STATUS.md'));await fs.access(path.join(dest,'workspace','caldav.js'));await fs.access(path.join(dest,'PaintRoom','model.js'));await fs.access(path.join(dest,'MotionRoom','index.html'));await fs.access(path.join(dest,'MotionRoom','fonts','BricolageGrotesque.ttf'));await fs.access(path.join(dest,'MotionRoom','fonts','Bricolage-OFL.txt'));await fs.access(path.join(dest,'MotionRoom','fonts','Gelasio.ttf'));await fs.access(path.join(dest,'MotionRoom','fonts','Gelasio-OFL.txt'));await fs.access(path.join(dest,'VectorRoom','graphics.js'));await fs.access(path.join(dest,'PixelRoom','dist','index.html'));await fs.access(path.join(dest,'ProductivitySuite','app.js'));await fs.access(path.join(dest,'ProductivitySuite','reminders.js'));await fs.access(path.join(dest,'ProductivitySuite','vendor','exceljs.js'));await fs.access(path.join(dest,'ProductivitySuite','vendor','fflate.js'));await fs.access(path.join(dest,'mcp','server.mjs'));
    for(const file of ['SKILL.md','references/shared-notes.md','references/visual-motion.md','references/video-audio-capture.md','references/productivity.md'])await fs.access(path.join(dest,'mcp','skills','roomsuite',file));
    await assert.rejects(fs.stat(path.join(dest,'mcp','node_modules')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(dest,'mcp','workspace')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(dest,'cliproom','data')),{code:'ENOENT'});
    assert.notEqual(run().status,0,'existing staging directories must never be overwritten');
  } finally { const actual=await fs.realpath(temp),parent=await fs.realpath(os.tmpdir());assert.equal(path.dirname(actual),parent);assert.ok(path.basename(actual).startsWith('roomsuite-bundle-test-'));await fs.rm(actual,{recursive:true,force:true}); }
});
