import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from './server.mjs';
const server=await startFixture();
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await mkdir('node_modules/.cache/payment-receipt-browser',{recursive:true});
 await page.goto('http://127.0.0.1:4195/transactions',{waitUntil:'domcontentloaded',timeout:60000});
 await expect(page.getByText('CashApp-500-REF',{exact:true})).toBeVisible();
 for(const theme of ['Light','Dark']){
  await page.getByRole('button',{name:theme,exact:true}).click();
  const summary=page.locator('summary');await summary.focus();await summary.press('Enter');
  await expect(page.getByRole('link',{name:'Invoice INV-A',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Invoice INV-B',exact:true})).toHaveAttribute('href','/invoices/synthetic-invoice-1');
  await expect(page.getByText('$200.00 · succeeded',{exact:true})).toBeVisible();await expect(page.getByText('$175.00 · succeeded',{exact:true})).toBeVisible();await expect(page.getByText('$125.00 · succeeded',{exact:true})).toBeVisible();
  await page.screenshot({path:`node_modules/.cache/payment-receipt-browser/customer-${theme.toLowerCase()}.png`,fullPage:true});
  await summary.press('Enter');await expect(page.getByRole('link',{name:'Invoice INV-A',exact:true})).not.toBeVisible();
 }
 await page.getByPlaceholder(/Search transactions/).fill('INV-B');await expect(page.locator('summary')).toHaveCount(1);await page.locator('summary').click();await expect(page.locator('details a')).toHaveCount(3);
 await page.getByRole('link',{name:'Global Payments',exact:true}).click();
 await expect(page.getByText('Net Receipts',{exact:true})).toBeVisible();await expect(page.locator('summary')).toHaveCount(1);await page.locator('summary').click();await expect(page.locator('details a')).toHaveCount(3);
 for(const theme of ['Light','Dark']){await page.getByRole('button',{name:theme,exact:true}).click();await page.screenshot({path:`node_modules/.cache/payment-receipt-browser/global-${theme.toLowerCase()}.png`,fullPage:true});}
 await page.getByPlaceholder('Amount, date, customer, method, reference or invoice').fill('INV-C');await expect(page.locator('summary')).toHaveCount(1);await page.locator('summary').click();await expect(page.locator('details a')).toHaveCount(3);await expect(page.locator('td').filter({hasText:'CashApp-500-REF'})).toBeVisible();
 expect(errors).toEqual([]);console.log('PASS: Actual customer/global history screens, compact allocation disclosures, canonical invoice URLs, complete groups after search, original $500 and $200/$175/$125 details, light/dark, keyboard toggle, normal zoom. Browser API/persistence mocked.');
}finally{await browser.close();await server.close();}
