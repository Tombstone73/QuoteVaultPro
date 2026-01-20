import type { Express, Request, Response } from "express";
import busboy from "busboy";
import { db } from "../db";
import { prepressJobs } from "./schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { initializeJobDirectory, writeFile, getJobPaths, fileExists, readFile } from "./storage";
import { getJobFindings, getJobFixLogs } from "./findings-service";
import { z } from "zod";
import path from "path";

/**
 * Prepress API Routes
 * 
 * Endpoints for PDF preflight job lifecycle:
 * - POST /api/prepress/jobs - Create job with file upload
 * - GET /api/prepress/jobs/:jobId - Get job status
 * - GET /api/prepress/jobs/:jobId/report - Get full report JSON
 * - GET /api/prepress/jobs/:jobId/download/:kind - Download output files
 */

const MAX_FILE_SIZE_MB = parseInt(process.env.PREPRESS_MAX_FILE_SIZE_MB || '250');
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const JOB_TTL_HOURS = parseInt(process.env.PREPRESS_JOB_TTL_HOURS || '12');

/**
 * Parse multipart/form-data upload
 */
async function parseMultipartUpload(req: Request): Promise<{
  file: { buffer: Buffer; filename: string; mimeType: string };
  fields: Record<string, string>;
}> {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let fileMimeType = '';
    const fields: Record<string, string> = {};
    let fileSize = 0;
    
    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      fileName = filename;
      fileMimeType = mimeType;
      
      const chunks: Buffer[] = [];
      
      file.on('data', (chunk: Buffer) => {
        fileSize += chunk.length;
        if (fileSize > MAX_FILE_SIZE_BYTES) {
          file.resume(); // Drain the stream
          reject(new Error(`File size exceeds maximum allowed size of ${MAX_FILE_SIZE_MB}MB`));
          return;
        }
        chunks.push(chunk);
      });
      
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });
    
    bb.on('field', (name, value) => {
      fields[name] = value;
    });
    
    bb.on('finish', () => {
      if (!fileBuffer) {
        reject(new Error('No file uploaded'));
        return;
      }
      resolve({
        file: {
          buffer: fileBuffer,
          filename: fileName,
          mimeType: fileMimeType,
        },
        fields,
      });
    });
    
    bb.on('error', (error) => {
      reject(error);
    });
    
    req.pipe(bb);
  });
}

/**
 * Register prepress routes on Express app
 */
export function registerPrepressRoutes(app: Express): void {
  // GET /api/prepress/jobs - List all jobs for current org
  app.get('/api/prepress/jobs', async (req: Request, res: Response) => {
    try {
      const organizationId = (req as any).organizationId || 'standalone';
      
      // Query jobs for this organization, newest first
      const jobs = await db.query.prepressJobs.findMany({
        where: organizationId !== 'standalone' 
          ? eq(prepressJobs.organizationId, organizationId)
          : sql`1=1`, // Standalone mode: show all
        orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
        limit: 100, // Reasonable limit
      });
      
      return res.json({
        success: true,
        data: jobs.map(job => ({
          id: job.id,
          status: job.status,
          mode: job.mode,
          originalFilename: job.originalFilename,
          sizeBytes: job.sizeBytes,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
          reportSummary: job.reportSummary,
          error: job.error,
        })),
      });
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to fetch job list:', error);
      return res.status(500).json({
        success: false,
        message: `Failed to fetch jobs: ${error.message}`,
      });
    }
  });
  
  // POST /api/prepress/jobs - Create new preflight job
  app.post('/api/prepress/jobs', async (req: Request, res: Response) => {
    try {
      // Parse multipart upload
      const { file, fields } = await parseMultipartUpload(req);
      
      // Validate mode
      const mode = fields.mode === 'check_and_fix' ? 'check_and_fix' : 'check';
      
      // Validate file type (accept PDF, JPG, PNG, TIF, AI, PSD)
      const ext = file.filename.toLowerCase();
      const acceptedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.ai', '.psd'];
      const acceptedMimes = [
        'application/pdf',
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/tiff',
        'image/tif',
        'application/postscript', // AI files
        'image/vnd.adobe.photoshop', // PSD files
        'application/x-photoshop', // PSD alternate
      ];
      
      const hasValidExtension = acceptedExtensions.some(validExt => ext.endsWith(validExt));
      const hasValidMime = acceptedMimes.some(validMime => file.mimeType.includes(validMime));
      
      if (!hasValidExtension && !hasValidMime) {
        return res.status(400).json({
          message: 'Unsupported file type. Please upload PDF, JPG, PNG, TIF, AI, or PSD files.',
        });
      }
      
      // Create job record
      const expiresAt = new Date(Date.now() + JOB_TTL_HOURS * 60 * 60 * 1000);
      const organizationId = (req as any).organizationId || null; // Optional for standalone
      
      const [job] = await db.insert(prepressJobs).values({
        organizationId,
        status: 'queued',
        mode,
        originalFilename: file.filename,
        contentType: file.mimeType,
        sizeBytes: file.buffer.length,
        expiresAt,
      }).returning();
      
      // Initialize job directory and write input file
      await initializeJobDirectory(job.id);
      const paths = getJobPaths(job.id);
      await writeFile(paths.inputFile, file.buffer);
      
      console.log(`[Prepress API] Created job ${job.id} (${mode}, ${file.filename}, ${file.buffer.length} bytes)`);
      
      return res.status(201).json({
        success: true,
        data: {
          jobId: job.id,
        },
        message: 'Prepress job created successfully',
      });
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to create job:', error);
      return res.status(500).json({
        message: `Failed to create prepress job: ${error.message}`,
      });
    }
  });
  
  // GET /api/prepress/jobs/:jobId - Get job status
  app.get('/api/prepress/jobs/:jobId', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const organizationId = (req as any).organizationId || 'standalone';
      
      // Multi-tenant scoped query: MUST filter by both jobId AND organizationId
      const job = await db.query.prepressJobs.findFirst({
        where: organizationId !== 'standalone'
          ? and(
              eq(prepressJobs.id, jobId),
              eq(prepressJobs.organizationId, organizationId)
            )
          : eq(prepressJobs.id, jobId),
      });
      
      if (!job) {
        return res.status(404).json({
          message: 'Job not found',
        });
      }
      
      return res.json({
        id: job.id,
        status: job.status,
        mode: job.mode,
        originalFilename: job.originalFilename,
        sizeBytes: job.sizeBytes,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        expiresAt: job.expiresAt,
        reportSummary: job.reportSummary,
        outputManifest: job.outputManifest,
        error: job.error,
        progressMessage: job.progressMessage,
      });
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to fetch job:', error);
      return res.status(500).json({
        message: `Failed to fetch job: ${error.message}`,
      });
    }
  });
  
  // GET /api/prepress/jobs/:jobId/report - Get full report JSON
  app.get('/api/prepress/jobs/:jobId/report', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const organizationId = (req as any).organizationId || 'standalone';
      
      // Multi-tenant scoped query
      const job = await db.query.prepressJobs.findFirst({
        where: organizationId !== 'standalone'
          ? and(
              eq(prepressJobs.id, jobId),
              eq(prepressJobs.organizationId, organizationId)
            )
          : eq(prepressJobs.id, jobId),
      });
      
      if (!job) {
        return res.status(404).json({
          message: 'Job not found',
        });
      }
      
      // Check if job is completed
      if (job.status !== 'succeeded') {
        return res.status(409).json({
          message: `Report not available. Job status: ${job.status}`,
        });
      }
      
      // Read report JSON from output
      const paths = getJobPaths(job.id);
      const reportExists = await fileExists(paths.reportJson);
      
      if (!reportExists) {
        return res.status(404).json({
          message: 'Report file not found',
        });
      }
      
      const reportBuffer = await readFile(paths.reportJson);
      const report = JSON.parse(reportBuffer.toString('utf-8'));
      
      return res.json(report);
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to fetch report:', error);
      return res.status(500).json({
        message: `Failed to fetch report: ${error.message}`,
      });
    }
  });
  
  // GET /api/prepress/jobs/:jobId/download/:kind - Download output files
  app.get('/api/prepress/jobs/:jobId/download/:kind', async (req: Request, res: Response) => {
    try {
      const { jobId, kind } = req.params;
      const organizationId = (req as any).organizationId || 'standalone';
      
      // Validate kind
      const validKinds = ['report_json', 'proof_png', 'fixed_pdf'];
      if (!validKinds.includes(kind)) {
        return res.status(400).json({
          message: `Invalid download kind. Must be one of: ${validKinds.join(', ')}`,
        });
      }
      
      // Multi-tenant scoped query
      const job = await db.query.prepressJobs.findFirst({
        where: organizationId !== 'standalone'
          ? and(
              eq(prepressJobs.id, jobId),
              eq(prepressJobs.organizationId, organizationId)
            )
          : eq(prepressJobs.id, jobId),
      });
      
      if (!job) {
        return res.status(404).json({
          message: 'Job not found',
        });
      }
      
      // Check if job is completed
      if (job.status !== 'succeeded') {
        return res.status(409).json({
          message: `Download not available. Job status: ${job.status}`,
        });
      }
      
      // Get file path based on kind
      const paths = getJobPaths(job.id);
      let filePath: string;
      let filename: string;
      let contentType: string;
      
      switch (kind) {
        case 'report_json':
          filePath = paths.reportJson;
          filename = `${job.id}-report.json`;
          contentType = 'application/json';
          break;
        case 'proof_png':
          filePath = paths.proofPng;
          filename = `${job.id}-proof.png`;
          contentType = 'image/png';
          break;
        case 'fixed_pdf':
          filePath = paths.fixedPdf;
          filename = `${job.id}-fixed.pdf`;
          contentType = 'application/pdf';
          break;
        default:
          return res.status(400).json({ message: 'Invalid kind' });
      }
      
      // Check if file exists
      const exists = await fileExists(filePath);
      if (!exists) {
        return res.status(404).json({
          message: `Output file '${kind}' not found for this job`,
        });
      }
      
      // Stream file to response
      const fileBuffer = await readFile(filePath);
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', fileBuffer.length);
      
      return res.send(fileBuffer);
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to download file:', error);
      return res.status(500).json({
        message: `Failed to download file: ${error.message}`,
      });
    }
  });
  
  // GET /api/prepress/jobs/:jobId/findings - Get all findings for a job
  app.get('/api/prepress/jobs/:jobId/findings', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const organizationId = (req as any).organizationId || 'standalone';
      
      // Verify job exists with org-scoped query
      const job = await db.query.prepressJobs.findFirst({
        where: organizationId !== 'standalone'
          ? and(
              eq(prepressJobs.id, jobId),
              eq(prepressJobs.organizationId, organizationId)
            )
          : eq(prepressJobs.id, jobId),
      });
      
      if (!job) {
        return res.status(404).json({
          message: 'Job not found',
        });
      }
      
      // Fetch findings (org-scoped)
      const findings = await getJobFindings(jobId, organizationId);
      
      return res.json({
        success: true,
        data: findings,
      });
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to fetch findings:', error);
      return res.status(500).json({
        message: `Failed to fetch findings: ${error.message}`,
      });
    }
  });
  
  // GET /api/prepress/jobs/:jobId/fixes - Get all fix logs for a job
  app.get('/api/prepress/jobs/:jobId/fixes', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const organizationId = (req as any).organizationId || 'standalone';
      
      // Verify job exists with org-scoped query
      const job = await db.query.prepressJobs.findFirst({
        where: organizationId !== 'standalone'
          ? and(
              eq(prepressJobs.id, jobId),
              eq(prepressJobs.organizationId, organizationId)
            )
          : eq(prepressJobs.id, jobId),
      });
      
      if (!job) {
        return res.status(404).json({
          message: 'Job not found',
        });
      }
      
      // Fetch fix logs (org-scoped)
      const fixes = await getJobFixLogs(jobId, organizationId);
      
      return res.json({
        success: true,
        data: fixes,
      });
      
    } catch (error: any) {
      console.error('[Prepress API] Failed to fetch fix logs:', error);
      return res.status(500).json({
        message: `Failed to fetch fix logs: ${error.message}`,
      });
    }
  });
}
