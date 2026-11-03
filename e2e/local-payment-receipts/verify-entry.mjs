import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from './server.mjs';
const server=await startFixture(4196);
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[], confirmations=[];let accept=false;
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',async dialog=>{confirmations.push(dialog.message());if(accept)await dialog.accept();else await dialog.dismiss();});
try{
 await mkdir('node_modules/.cache/payment-entry-browser',{recursive:true});
 await page.goto('http://127.0.0.1:4196/entry',{waitUntil:'domcontentloaded',timeout:60000});
 await expect(page.getByRole('button',{name:'Receive payment',exact:true})).toBeVisible({timeout:60000});
 for(const theme of ['Light','Dark']){
  await page.getByRole('button',{name:theme,exact:true}).click();await page.getByRole('button',{name:'Receive payment',exact:true}).click();
  const amount=page.getByLabel('Payment received',{exact:true}),record=page.getByRole('button',{name:'Record Payment',exact:true});
  const reconciliation=page.getByLabel('Payment reconciliation');
  await amount.fill('500');await expect(reconciliation).toContainText('Unresolved funds: $25.00');await expect(record).toBeDisabled();
  await page.getByRole('checkbox').check();await expect(reconciliation).toContainText('Change due: $25.00');await expect(reconciliation).toContainText('Unresolved funds: $0.00');await expect(record).toBeEnabled();
  await page.getByLabel('Payment reference',{exact:true}).fill('CashApp-500');await page.getByLabel('Notes / payment source (optional)',{exact:true}).fill('Cash App');
  await page.screenshot({path:`node_modules/.cache/payment-entry-browser/change-${theme.toLowerCase()}.png`,fullPage:true});
  await record.click();expect(confirmations.at(-1)).toContain('Customer: Synthetic Buyer');expect(confirmations.at(-1)).toContain('Invoice INV-A: $200.00 applied');expect(confirmations.at(-1)).toContain('Returned change: $25.00');expect(confirmations.at(-1)).toContain('Reference: CashApp-500');
  expect(await page.evaluate(()=>window.paymentEntryFixture.posts.length)).toBe(0);
  await amount.fill('300');await expect(reconciliation).toContainText('Remaining invoice balance: $175.00');await expect(page.getByLabel('Allocation preview')).toContainText('Invoice INV-B: $100.00');
  await page.getByRole('combobox',{name:'Allocation',exact:true}).click();await page.getByRole('option',{name:'Custom allocation',exact:true}).click();
  await page.getByLabel('Allocation for invoice INV-A',{exact:true}).fill('125.01');await page.getByLabel('Allocation for invoice INV-B',{exact:true}).fill('174.99');
  await expect(reconciliation).toContainText('Applied to invoices: $300.00');await expect(record).toBeEnabled();
  if(theme==='Dark'){
   await page.evaluate(()=>{window.paymentEntryFixture.failNext=true;});accept=true;await record.click();
   await expect(page.getByRole('alert').filter({hasText:'Synthetic connection failure'})).toBeVisible();await expect(page.getByLabel('Allocation for invoice INV-A',{exact:true})).toHaveValue('125.01');await expect(page.getByLabel('Payment reference',{exact:true})).toHaveValue('CashApp-500');
   await page.getByRole('button',{name:'Refresh preview',exact:true}).click();await expect(record).toBeEnabled();await record.click();
   await expect(page.getByRole('dialog')).not.toBeVisible();
   const posts=await page.evaluate(()=>window.paymentEntryFixture.posts);expect(posts).toHaveLength(2);expect(posts[0].key).toBe(posts[1].key);expect(posts[1].body.expectedAllocations).toEqual([{invoiceId:'entry-0',amountCents:12501},{invoiceId:'entry-1',amountCents:17499}]);expect(posts[1].body.appliedAt).toBeTruthy();
  }else{
   await page.screenshot({path:'node_modules/.cache/payment-entry-browser/custom-light.png',fullPage:true});await page.getByRole('button',{name:'Cancel',exact:true}).click();
  }
 }
 expect(errors).toEqual([]);console.log('PASS: Actual payment dialog, light/dark normal zoom, live partial/custom/change reconciliation, explicit excess decision, rich confirmation cancellation, failed post retained edits and stable-key retry. Browser persistence mocked; separate PostgreSQL tests prove canonical posting/readback.');
}finally{await browser.close();await server.close();}
