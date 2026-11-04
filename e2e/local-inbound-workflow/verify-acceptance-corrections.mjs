import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {startFixture} from './server.mjs';
// Real page/editor, synthetic HTTP persistence; separate PostgreSQL tests prove durable state.
const server=await startFixture(4203),browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
let page;
try {
 await mkdir('node_modules/.cache/ai-intake-acceptance',{recursive:true});
 page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(30000);page.on('dialog',dialog=>dialog.accept());const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:4203/inbound-orders?po-parse&creation-recovery',{waitUntil:'domcontentloaded',timeout:90000});
 const job=page.getByLabel('Job Label',{exact:true});await expect(job).toBeVisible();await job.fill('Titan Bassett Yard Signs - staff');await job.blur();
 await page.getByRole('checkbox',{name:'Select PO-123.pdf'}).check();await page.getByRole('button',{name:'Classify as PO',exact:true}).click();await expect(page.getByText('Confirmed PO',{exact:true}).first()).toBeVisible();await expect(job).toHaveValue('Titan Bassett Yard Signs - staff');
 const source=page.locator('section[aria-label="Source evidence review"]'),toggle=source.locator('button[aria-expanded]');await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(source.getByRole('button',{name:'Refresh from Latest Parse'})).toHaveCount(0);await expect(source.getByRole('button',{name:'Confirm source review without AI'})).toBeVisible();await toggle.click();
 await page.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(page.getByText(/Synthetic first draft save failure/).first()).toBeVisible();await expect(job).toHaveValue('Titan Bassett Yard Signs - staff');await page.getByRole('button',{name:'Save Draft',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__fixtureState().savedReviewDraft?.reviewedOrderJson.jobLabel)).toBe('Titan Bassett Yard Signs - staff');
 await page.reload({waitUntil:'domcontentloaded'});await expect(job).toHaveValue('Titan Bassett Yard Signs - staff');await expect(toggle).toHaveAttribute('aria-expanded','false');await job.fill('Staff working draft');await page.evaluate(()=>window.__fixturePOResume());await expect(job).toHaveValue('Staff working draft');await expect(toggle).toHaveAttribute('aria-expanded','false');
 for(const theme of ['Light','Dark']) {await page.getByRole('button',{name:theme,exact:true}).click();await page.evaluate(()=>window.getSelection()?.removeAllRanges());await page.screenshot({path:`node_modules/.cache/ai-intake-acceptance/${theme.toLowerCase()}.png`});}
 await toggle.click();await expect(source.locator('[id]')).toHaveCSS('max-height','192px');await page.setViewportSize({width:1100,height:900});await page.screenshot({path:'node_modules/.cache/ai-intake-acceptance/narrow.png'});expect(errors).toEqual([]);
 console.log(JSON.stringify({normalZoom:true,themes:['light','dark'],confirmedPO:true,jobLabelSaveReload:true,failedSaveRetainsEdits:true,backgroundRetainsEdits:true,sourceReviewCompact:true,persistence:'mocked HTTP; no real customer changes'}));
} catch(error) {if(page)await page.screenshot({path:'node_modules/.cache/ai-intake-acceptance/failure.png'});throw error;}
finally {await browser.close();await server.close();}
