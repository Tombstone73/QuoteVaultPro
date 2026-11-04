import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

// Real application/components, synthetic HTTP persistence. Database/storage readback
// is separately exercised by proofFileLifecycle.postgres.integration.ts.
const snapshot = JSON.parse(await readFile('node_modules/.cache/proof-browser-data.json', 'utf8'));
const { server } = await import('./server.mjs');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(15_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const lineId = snapshot.detail.lineItemId;
snapshot.queue.rows.forEach(row => { if (row.lineItemId === lineId) { row.activeOwnerJobId = 'synthetic-prepress'; row.activeOwnerStationKey = 'prepress'; row.workflowState = 'in_prepress'; } });
let creates = 0, uploads = 0, links = 0, returns = 0;
const createKeys = [];
const source = { id: 'synthetic-source', sourceId: 'source-attachment', sourceType: 'line_item_artwork', canonicalArtworkId: 'source-revision-1', revisionRole: 'customer_source',
  attachmentId: 'source-attachment', fileRecordId: snapshot.file.fileRecordId, fileName: 'synthetic-artwork.pdf', originalFilename: 'synthetic-artwork.pdf', mimeType: 'application/pdf',
  fileUrl: null, thumbnailUrl: null, previewUrl: null, role: 'artwork', side: 'front', previewStatus: 'ready', previewState: 'available', previewMessage: 'Available',
  previewRetryAllowed: false, eligible: true, allocatedQuantity: 1, eligibilityReason: null };
await page.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url());
  const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  if (url.pathname === '/api/proofing/queue') return json({ success: true, data: snapshot.queue });
  if (url.pathname.endsWith('/eligible-artwork')) return json({ success: true, data: { sources: [source], eligibleCount: 1, artworkSummary: { artworkCount: 1, totalQuantity: 1 } } });
  if (req.method() === 'GET' && url.pathname === `/api/proofing/line-item/${lineId}`) return json({ success: true, data: snapshot.detail });
  if (/\/api\/proofing\/versions\/[^/]+\/file$/.test(url.pathname)) {
    const version = snapshot.detail.proofVersionHistory.find(item => item.id === url.pathname.split('/')[4]);
    return json({ success: true, data: { ...snapshot.file, id: version.proofFileId, available: true, authenticatedUrl: `${url.pathname}/content` } });
  }
  if (url.pathname === '/api/uploads/init') { uploads++; return json({ data: { uploadId: 'synthetic-upload', chunkSizeBytes: 1048576, totalChunks: 1 } }); }
  if (url.pathname.includes('/api/uploads/')) return json({ data: { fileId: 'synthetic-finalized' } });
  if (req.method() === 'POST' && url.pathname.endsWith('/files')) {
    links++; const body = req.postDataJSON(); expect(body.orderLineItemId).toBe(lineId);
    return json({ success: true, data: { id: body.role === 'proof' ? 'manual-proof-artifact' : 'new-artwork-attachment' } });
  }
  if (req.method() === 'POST' && url.pathname.endsWith('/versions')) {
    creates++; createKeys.push(req.headers()['idempotency-key']); const body = req.postDataJSON();
    expect(body.mode).toBe('uploaded'); expect(body.proofFileId).toBe('manual-proof-artifact'); expect(body.pdfNotes).toBe('Please check contour placement.');
    if (creates === 1) return json({ error: 'Synthetic storage unavailable. Retry draft creation.' }, 503);
    const version = { ...snapshot.detail.currentActionableProofVersion, id: 'synthetic-new-version', proofFileId: 'manual-proof-artifact', versionNumber: 3, status: 'draft',
      customerMessage: body.customerMessage, internalNotes: body.internalNotes, pdfNotes: body.pdfNotes, manualSourceAttachmentId: body.proofFileId, primaryLineItemId: lineId };
    snapshot.detail.proofVersionHistory.unshift(version); snapshot.detail.currentActionableProofVersion = version; snapshot.detail.currentActionableProofVersionId = version.id;
    snapshot.queue.rows.forEach(row => { if (row.lineItemId === lineId) { row.currentDisplayedProofVersionId = version.id; row.currentDisplayedProofVersionStatus = 'draft'; } });
    return json({ success: true, data: { proofVersion: version, proofing: snapshot.detail } });
  }
  if (req.method() === 'POST' && url.pathname.endsWith('/send')) {
    const body = req.postDataJSON(); expect(body.customerMessage).toBe('Review the contour before approving.');
    expect(url.pathname).toContain('synthetic-new-version');
    const delivery = { status: 'failed', retryable: true, message: 'Proof email delivery failed. Retry notification for this exact version.' };
    snapshot.detail.currentActionableProofVersion.status = 'awaiting_response'; snapshot.detail.currentActionableProofVersion.delivery = delivery;
    return json({ success: true, data: { delivery } });
  }
  if (req.method() === 'POST' && url.pathname.endsWith('/return-upstream')) { returns++; expect(req.postDataJSON().reason).toBe('Correct the source contour.'); return json({ success: true, data: {} }); }
  return route.continue();
});
try {
  await page.goto(`http://127.0.0.1:4198/production/proofing?lineItemId=${lineId}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Create Proof Draft', exact: true }).first()).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Add Artwork', exact: true })).toBeVisible();
  await page.getByLabel('New source artwork', { exact: true }).setInputFiles({ name: 'new-artwork.pdf', mimeType: 'application/pdf', buffer: Buffer.from(snapshot.pdf, 'base64') });
  await page.getByRole('button', { name: 'Add Artwork', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Artwork saved.' })).toBeVisible();
  expect(links).toBe(1);
  await page.getByRole('button', { name: 'Return to Design', exact: true }).click();
  const design = page.getByRole('dialog', { name: 'Return to Design?' });
  await expect(design.getByRole('button', { name: 'Return to Design', exact: true })).toBeDisabled();
  await design.getByLabel('Reason', { exact: true }).fill('Correct the source contour.');
  await design.getByRole('button', { name: 'Return to Design', exact: true }).click();
  await expect(design).not.toBeVisible(); expect(returns).toBe(1);
  await page.getByRole('button', { name: 'Create Proof Draft', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Artwork Proof Draft' });
  await dialog.getByRole('button', { name: 'Manual Proof File', exact: true }).click();
  await dialog.getByLabel('Upload new proof file', { exact: true }).setInputFiles({ name: 'manual-proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from(snapshot.pdf, 'base64') });
  await dialog.getByLabel('Customer approval-page notes', { exact: true }).fill('Review the contour before approving.');
  await dialog.getByLabel('Notes printed on the proof PDF', { exact: true }).fill('Please check contour placement.');
  await dialog.getByLabel('Internal notes', { exact: true }).fill('Internal staff note only');
  await dialog.getByRole('button', { name: 'Create Draft', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Notes printed on the proof PDF', { exact: true })).toHaveValue('Please check contour placement.');
  await expect(dialog.getByRole('button', { name: 'Create Draft', exact: true })).toBeEnabled();
  const uploadsAfterFailure = uploads;
  await dialog.getByRole('button', { name: 'Create Draft', exact: true }).click();
  const send = page.getByRole('dialog', { name: 'Send Proof for Review' });
  await expect(send).toBeVisible(); expect(uploads).toBe(uploadsAfterFailure); expect(createKeys[0]).toBeTruthy(); expect(createKeys[1]).toBe(createKeys[0]);
  await expect(send).toContainText('Version 3');
  await send.getByRole('button', { name: 'Send proof', exact: true }).click();
  await expect(page.getByText('Proof email failed — retry notification', { exact: true })).toBeVisible();
  await expect(send).not.toBeVisible();
  await page.getByRole('button', { name: 'Retry Notification', exact: true }).click();
  const retry = page.getByRole('dialog', { name: 'Resend Proof Notification' });
  await expect(retry).toContainText('Version 3');
  await expect(retry.getByLabel('Customer note for this proof', { exact: true })).toHaveAttribute('readonly', '');
  await retry.getByRole('button', { name: 'Cancel', exact: true }).click();
  await mkdir('node_modules/.cache/proofing-browser', { recursive: true });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: `${theme[0].toUpperCase()}${theme.slice(1)} theme`, exact: true }).click();
    await page.screenshot({ path: `node_modules/.cache/proofing-browser/workstation-${theme}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
  console.log('PASS: artwork upload, explicit Design return/reason, manual PDF selection, failed creation retains notes, duplicate-safe retry, exact-version preview, visible email failure, light/dark normal zoom. Browser HTTP persistence mocked; PostgreSQL/storage validated separately.');
} finally { await browser.close(); await server.close(); }
