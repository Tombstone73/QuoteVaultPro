#!/usr/bin/env tsx

/**
 * Prepress Smoke Test
 * 
 * Automated smoke test for the prepress service.
 * Tests job creation, processing, and output download.
 * 
 * Usage:
 *   npm run prepress:smoke
 *   tsx scripts/prepress-smoke.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const API_BASE = process.env.PREPRESS_API_BASE || 'http://localhost:5000';

async function createSamplePDF(): Promise<Buffer> {
  // Create a minimal valid PDF for testing
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT
/F1 24 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000317 00000 n
trailer
<< /Size 5 /Root 1 0 R >>
startxref
409
%%EOF`;
  
  return Buffer.from(pdfContent, 'utf-8');
}

async function createJob(pdfBuffer: Buffer, mode: 'check' | 'check_and_fix'): Promise<string> {
  console.log(`Creating ${mode} job...`);
  
  const formData = new FormData();
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('file', blob, 'test.pdf');
  formData.append('mode', mode);
  
  const response = await fetch(`${API_BASE}/api/prepress/jobs`, {
    method: 'POST',
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create job: ${error.message}`);
  }
  
  const result = await response.json();
  console.log(`✓ Job created: ${result.data.jobId}`);
  return result.data.jobId;
}

async function pollJob(jobId: string, maxAttempts: number = 60): Promise<any> {
  console.log('Polling job status...');
  
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${API_BASE}/api/prepress/jobs/${jobId}`);
    
    if (!response.ok) {
      throw new Error('Failed to fetch job status');
    }
    
    const job = await response.json();
    
    if (job.status === 'succeeded') {
      console.log(`✓ Job completed successfully (${i + 1} attempts)`);
      return job;
    }
    
    if (job.status === 'failed') {
      console.error('✗ Job failed:', job.error);
      throw new Error(`Job failed: ${job.error?.message}`);
    }
    
    process.stdout.write(`  Status: ${job.status}... \r`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  throw new Error('Job timed out');
}

async function downloadOutput(jobId: string, kind: string): Promise<boolean> {
  console.log(`Downloading ${kind}...`);
  
  const response = await fetch(`${API_BASE}/api/prepress/jobs/${jobId}/download/${kind}`);
  
  if (!response.ok) {
    if (response.status === 404) {
      console.log(`  ${kind} not available (expected for some modes)`);
      return false;
    }
    throw new Error(`Failed to download ${kind}`);
  }
  
  const buffer = await response.arrayBuffer();
  console.log(`✓ Downloaded ${kind} (${buffer.byteLength} bytes)`);
  return true;
}

async function runSmokeTest() {
  console.log('=== Prepress Smoke Test ===\n');
  
  try {
    // 1. Create sample PDF
    console.log('Creating sample PDF...');
    const pdfBuffer = await createSamplePDF();
    console.log(`✓ Sample PDF created (${pdfBuffer.length} bytes)\n`);
    
    // 2. Test "check" mode
    console.log('--- Test 1: Check Mode ---');
    const checkJobId = await createJob(pdfBuffer, 'check');
    const checkJob = await pollJob(checkJobId);
    
    console.log(`Summary:
  Score: ${checkJob.reportSummary?.score || 'N/A'}
  Blockers: ${checkJob.reportSummary?.counts.BLOCKER || 0}
  Warnings: ${checkJob.reportSummary?.counts.WARNING || 0}
  Info: ${checkJob.reportSummary?.counts.INFO || 0}
`);
    
    await downloadOutput(checkJobId, 'report_json');
    await downloadOutput(checkJobId, 'proof_png');
    
    console.log('');
    
    // 3. Test "check_and_fix" mode
    console.log('--- Test 2: Check + Fix Mode ---');
    const fixJobId = await createJob(pdfBuffer, 'check_and_fix');
    const fixJob = await pollJob(fixJobId);
    
    console.log(`Summary:
  Score: ${fixJob.reportSummary?.score || 'N/A'}
  Blockers: ${fixJob.reportSummary?.counts.BLOCKER || 0}
  Warnings: ${fixJob.reportSummary?.counts.WARNING || 0}
  Info: ${fixJob.reportSummary?.counts.INFO || 0}
`);
    
    await downloadOutput(fixJobId, 'report_json');
    await downloadOutput(fixJobId, 'proof_png');
    await downloadOutput(fixJobId, 'fixed_pdf');
    
    console.log('\n=== All Tests Passed ✓ ===');
    process.exit(0);
    
  } catch (error: any) {
    console.error('\n=== Test Failed ✗ ===');
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run smoke test
runSmokeTest();
