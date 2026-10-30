'use strict';
const { chromium } = require('../mcp/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ headless:true });
  try { const page = await browser.newPage(); await page.setContent('<title>RoomSuite browser check</title>'); if (await page.title() !== 'RoomSuite browser check') throw new Error('Browser check failed.'); }
  finally { await browser.close(); }
  console.log('Bundled headless browser is working.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
