'use strict';
const { chromium } = require(process.argv[2]);
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>RoomSuite browser check</title>');
    if (await page.title() !== 'RoomSuite browser check') throw new Error('Browser check failed.');
  } finally { await browser.close(); }
  console.log('Bundled headless browser is working.');
})().catch(error => { console.error(error); process.exitCode = 1; });
