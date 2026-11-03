import { chromium,expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { startFixture } from '../local-inbound-workflow/server.mjs';

const out='node_modules/.cache/printer-configuration-browser';await mkdir(out,{recursive:true});
// The reusable fixture server serves '/' and routes to this isolated entry.
const server=await startFixture(4196,'/e2e/local-printer-configuration/fixture.tsx');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4196/',{waitUntil:'domcontentloaded',timeout:90000});
  const section=page.getByRole('region',{name:'Production machine configuration'});
  await expect(section).toContainText('Canon Colorado M5W');await expect(section).toContainText('Saved organization labels');
  await expect(section).not.toContainText('Jetson');await expect(section).toContainText('active status');
  expect(await page.evaluate(()=>window.__printerConfigurationRequests().some(request=>request.path==='/api/materials'))).toBe(false);
  await page.getByText('Material dimensions and configuration gaps',{exact:true}).click();
  await expect(section).toContainText('47 roll/sheet records · 1 need dimension review');
  await expect(section).toContainText('Positive sheet height is missing');await expect(section).toContainText('Inactive material');
  const mediaTable=section.locator('details .max-h-64');
  expect(await mediaTable.evaluate(node=>node.scrollHeight>node.clientHeight&&node.clientHeight<=256)).toBe(true);
  await section.getByRole('textbox',{name:'Filter media configuration'}).fill('QA-SHEET');
  await expect(section.getByRole('link',{name:'Synthetic incomplete rigid board'})).toBeVisible();
  await expect(section.getByRole('link',{name:'Synthetic adhesive vinyl'})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'Printer / Machine',exact:true})).toHaveValue('Historical assignment retained');
  expect(await page.locator('datalist option').evaluateAll(nodes=>nodes.map(node=>node.value))).toEqual(['Digitech ST']);
  for(const theme of ['Light','Dark']) {
    await page.getByRole('button',{name:theme,exact:true}).click();
    const summary=section.locator('summary');await summary.focus();await expect(summary).toBeFocused();
    await page.screenshot({path:`${out}/${theme.toLowerCase()}.png`});
  }
  await page.setViewportSize({width:900,height:900});await expect(section.getByRole('heading')).toBeVisible();
  await page.screenshot({path:`${out}/narrow.png`});
  await page.evaluate(()=>window.__printerConfigurationScenario('empty'));await expect(section).toContainText('No configured choices');await expect(section).not.toContainText('Jetson');
  await page.evaluate(()=>window.__printerConfigurationScenario('legacy'));await expect(section).toContainText('Legacy defaults — equipment unverified');await expect(section).toContainText('Jetson');
  await page.evaluate(()=>window.__printerConfigurationScenario('invalid'));await expect(section).toContainText('Invalid saved configuration');await expect(section).toContainText("canonical 'roll'");
  await page.evaluate(()=>window.__printerConfigurationScenario('error'));await expect(section.getByRole('alert')).toContainText('No equipment inventory has been verified');
  expect(await page.evaluate(()=>window.__printerConfigurationRequests().every(request=>request.method==='GET'))).toBe(true);
  expect(errors).toEqual([]);
  console.log('PASS: real settings and assignment components; configured/empty/legacy/invalid/error states, lazy existing material reads, size/status gaps, filter, bounded scrolling, keyboard focus, light/dark and narrow layout at normal zoom. Synthetic GET-only API; no machine, print, job, or database writes.');
} catch(error){await page.screenshot({path:`${out}/failure.png`});console.error('Browser errors',errors);throw error;}
finally {await browser.close();await server.close();}
