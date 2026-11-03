import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {startFixture} from './server.mjs';
// Real editor and request deadline. HTTP/provider/storage responses are synthetic.
const server=await startFixture(4199);const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
  const output='node_modules/.cache/inbound-workflow';await mkdir(output,{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(45000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.goto('http://127.0.0.1:4199/inbound-orders?po-parse',{waitUntil:'domcontentloaded',timeout:90000});
  const quantity=page.getByTestId('clean-inline-quantity-input');await expect(quantity).toHaveValue('20');await quantity.fill('28');await quantity.blur();
  await page.getByRole('checkbox',{name:'Select PO-123.pdf'}).check();
  await page.getByRole('button',{name:'Classify as PO',exact:true}).click();await expect(page.getByText('Classification changed. Reparse to update draft.')).toBeVisible();
  await expect(quantity).toHaveValue('28');
  await page.getByRole('button',{name:'Reparse',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel Parse'})).toBeVisible();
  expect(await page.evaluate(()=>window.__fixturePOState().calls)).toBe(1);
  await page.clock.fastForward(120_001);
  await expect(page.getByRole('button',{name:'Retry Parse',exact:true})).toBeEnabled();await expect(page.getByText(/Parsing timed out\./).first()).toBeVisible();
  await expect(quantity).toHaveValue('28');await expect(page.getByRole('button',{name:'Cancel Parse'})).toHaveCount(0);
  await page.evaluate(()=>window.__fixturePOLate());await expect(quantity).toHaveValue('28');
  for(const theme of ['Light','Dark']){
    await page.getByRole('button',{name:theme,exact:true}).click();await page.evaluate(()=>window.getSelection()?.removeAllRanges());
    await page.screenshot({path:`${output}/po-timeout-${theme.toLowerCase()}.png`});
  }
  for(const [mode,message] of [['no_text','PDF contains no extractable text'],['retrieval_error','Unable to retrieve PO attachment'],['provider_error','AI parsing service unavailable'],['conflict','Source evidence changed during parsing']]){
    await page.evaluate(mode=>window.__fixturePO(mode),mode);await page.getByRole('button',{name:'Retry Parse',exact:true}).click();
    await expect(page.getByText(message,{exact:false}).first()).toBeVisible();await expect(quantity).toHaveValue('28');await expect(page.getByRole('button',{name:'Cancel Parse'})).toHaveCount(0);
  }
  await page.evaluate(()=>window.__fixturePO('hang'));await page.getByRole('button',{name:'Retry Parse',exact:true}).click();
  await page.getByRole('button',{name:'Cancel Parse'}).click();await expect(page.getByText(/Parsing cancelled\./).first()).toBeVisible();await expect(quantity).toHaveValue('28');
  await page.evaluate(()=>window.__fixturePO('success_hold_refresh'));await page.getByRole('button',{name:'Retry Parse',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reparse',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Cancel Parse'})).toHaveCount(0);
  await expect(quantity).toHaveValue('28');await expect(page.getByRole('button',{name:'Refresh from Latest Parse',exact:true})).toBeVisible();
  await page.evaluate(()=>window.__fixturePOResume());
  const workstation=page.getByTestId('clean-order-workstation');
  await page.getByRole('button',{name:'Save Draft',exact:true}).click();await expect(workstation.getByRole('alert')).toContainText('Synthetic first draft save failure');await expect(quantity).toHaveValue('28');
  await page.getByRole('button',{name:'Save Draft',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__fixtureState().savedReviewDraft?.reviewedLineItemsJson[0].quantity)).toBe(28);
  await page.reload({waitUntil:'domcontentloaded'});await expect(quantity).toHaveValue('28');
  await page.evaluate(()=>window.__fixturePO('success'));await page.getByRole('button',{name:'Reparse',exact:true}).click();
  await expect(page.getByRole('button',{name:'Refresh from Latest Parse',exact:true})).toBeEnabled();
  page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Refresh from Latest Parse',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__fixtureState().reconciliationAttempts)).toBe(1);await expect(quantity).toHaveValue('28');
  expect(await page.evaluate(()=>window.__fixtureCreatedOrders??0)).toBe(0);expect(errors).toEqual([]);
  console.log('PASS: classified PO, real 120-second client deadline with controlled clock, timeout/error/retry/cancel, late response ignored, staff quantity retained, successful parse settles despite stalled background refresh, failed save retention, Save Draft/reload and explicit reconciliation preserve edits; both themes at normal zoom. HTTP/Gmail/storage mocked; no Order created.');
}finally{await browser.close();await server.close();}
