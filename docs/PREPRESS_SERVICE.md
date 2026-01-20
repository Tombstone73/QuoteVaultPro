# Prepress Service Documentation

## Overview

The Prepress Service is a standalone print file preflight processor integrated within the QuoteVaultPro/TitanOS repository. It supports PDF, JPG, PNG, TIF, AI, and PSD files with automatic normalization to PDF for analysis. It provides automated validation, analysis, and optional auto-fix capabilities while maintaining complete isolation from core business flows.

**Key Principles:**
- **Stateless**: Prepress owns no files permanently
- **Ephemeral Storage**: All inputs and outputs are temporary
- **Fail-Soft**: Missing tools produce warnings, not crashes
- **Multi-Tenant Safe**: Optional organizationId support
- **TitanOS Isolated**: No modifications to quote/order/production flows

## Architecture

### Components

```
┌─────────────┐
│   React UI  │ Upload PDF/JPG/PNG/TIF/AI/PSD, view results
└──────┬──────┘
       │
┌──────▼──────┐
│  API Routes │ /api/prepress/* (validates file types)
└──────┬──────┘
       │
┌──────▼──────┐
│  Database   │ prepress_jobs table
└──────┬──────┘
       │
┌──────▼──────┐
│   Worker    │ Separate process or in-process
└──────┬──────┘
       │
┌──────▼──────┐
│ Normalizer  │ Converts JPG/PNG/TIF → PDF (ImageMagick)
└──────┬──────┘
       │
┌──────▼──────┐
│  Pipeline   │ Runs PDF toolchain wrappers
└──────┬──────┘
       │
┌──────▼──────┐
│ Temp Files  │ Deleted after TTL
└─────────────┘
```

### State Machine

```
queued → running → succeeded
                → failed
                → cancelled (future)
```

## File Lifecycle

### Input Files
- API writes uploaded file to `{tempRoot}/{jobId}/input.{ext}`
- Worker reads via InputAdapter
- Normalizer converts non-PDF formats to PDF (if needed)
- Deleted immediately after processing

### Output Files
- Worker writes to `{tempRoot}/{jobId}/output/`
- Retained until `expiresAt` timestamp
- Available for download via API
- Deleted by TTL cleanup sweep

### Cleanup Behavior
1. **Immediate**: Scratch/intermediate files deleted on job completion
2. **TTL**: Output files deleted when `expiresAt` passes
3. **Recovery**: Cleanup sweep handles crashed jobs

## Toolchain

### Required Tools (Optional, Fail-Soft)

- **qpdf**: PDF validation and sanity checks
- **pdfinfo**: Metadata extraction
- **pdffonts**: Font embedding analysis
- **ghostscript** (gs): PDF normalization (auto-fix)
- **pdftocairo**: Proof rendering

### Installation

```bash
# Ubuntu/Debian
sudo apt-get install qpdf poppler-utils ghostscript

# macOS
brew install qpdf poppler ghostscript

# Windows
choco install qpdf poppler ghostscript
```

### Fail-Soft Behavior

If a tool is missing:
- Issue added with severity=WARNING, code=TOOL_MISSING
- Pipeline continues with available tools
- Job still completes as "succeeded"
- Report indicates which tools were unavailable

## API Endpoints

### POST /api/prepress/jobs

Create new preflight job.

**Request:**
```
Content-Type: multipart/form-data

file: <PDF file>
mode: "check" | "check_and_fix"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "uuid"
  },
  "message": "Prepress job created successfully"
}
```

### GET /api/prepress/jobs/:jobId

Get job status and summary.

**Response:**
```json
{
  "id": "uuid",
  "status": "succeeded",
  "mode": "check",
  "originalFilename": "document.pdf",
  "sizeBytes": 1048576,
  "createdAt": "2026-01-20T...",
  "reportSummary": {
    "score": 85,
    "counts": {
      "BLOCKER": 0,
      "WARNING": 3,
      "INFO": 5
    },
    "pageCount": 10
  },
  "outputManifest": {
    "report_json": true,
    "proof_png": true,
    "fixed_pdf": false
  }
}
```

### GET /api/prepress/jobs/:jobId/report

Get full report JSON (only when succeeded).

Returns the complete PrepressReport object with all analysis details.

### GET /api/prepress/jobs/:jobId/download/:kind

Download output files.

**Kinds:**
- `report_json`: Full analysis report
- `proof_png`: First page preview
- `fixed_pdf`: Normalized PDF (only for check_and_fix mode)

## Configuration

### Environment Variables

```bash
# Storage
PREPRESS_TEMP_DIR=/tmp/prepress

# Worker
PREPRESS_WORKER_ENABLED=true
PREPRESS_WORKER_IN_PROCESS=false  # Dev convenience only
PREPRESS_WORKER_POLL_INTERVAL_MS=10000
PREPRESS_WORKER_CONCURRENCY=1

# Job Settings
PREPRESS_JOB_TTL_HOURS=12
PREPRESS_MAX_FILE_SIZE_MB=250
PREPRESS_TOOL_TIMEOUT_MS=180000

# Cleanup
PREPRESS_CLEANUP_INTERVAL_MS=1800000  # 30 minutes
```

## Worker Modes

### Primary: Separate Process (Production)

```bash
npm run prepress:worker
npm run prepress:worker:dev  # with --watch
```

Recommended for production. Worker runs independently from API server.

### Optional: In-Process (Dev Convenience)

Set in `.env`:
```
PREPRESS_WORKER_IN_PROCESS=true
```

Worker polls within the API server process. Not recommended for production.

## Database Schema

### prepress_jobs Table

```sql
CREATE TABLE prepress_jobs (
  id varchar PRIMARY KEY,
  organization_id varchar,  -- nullable for standalone
  status prepress_job_status NOT NULL,
  mode prepress_job_mode NOT NULL,
  original_filename varchar(512) NOT NULL,
  content_type varchar(255) NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamp NOT NULL,
  started_at timestamp,
  finished_at timestamp,
  expires_at timestamp NOT NULL,
  report_summary jsonb,
  output_manifest jsonb,
  error jsonb,
  progress_message text
);
```

**IMPORTANT**: Never store absolute file paths in database. All paths derived from jobId at runtime.

## Future TitanOS Integration

### Signed URL Adapters (Not Yet Implemented)

The service is designed for future integration via signed URLs:

#### InputAdapter: SignedUrlInputAdapter
```typescript
// Future: Fetch PDF from TitanOS-provided signed GET URL
class SignedUrlInputAdapter implements InputAdapter {
  async fetchInput(jobId: string): Promise<Buffer> {
    // 1. Look up signed URL from job metadata
    // 2. HTTP GET to fetch PDF
    // 3. Return buffer
  }
}
```

#### OutputAdapter: SignedUrlOutputAdapter
```typescript
// Future: Upload results to TitanOS-provided signed PUT URL
class SignedUrlOutputAdapter implements OutputAdapter {
  async storeOutput(jobId: string, kind: string, buffer: Buffer) {
    // 1. Look up signed PUT URL for output kind
    // 2. HTTP PUT to upload
    // 3. Verify success
  }
}
```

### Integration Flow (Future)

1. TitanOS order/quote creates prepress job via API
2. TitanOS provides signed GET URL for input PDF
3. Worker fetches via SignedUrlInputAdapter
4. Worker processes PDF
5. Worker uploads results via SignedUrlOutputAdapter
6. TitanOS receives webhook/callback when complete
7. Results promoted to permanent TitanOS storage

**No changes needed to pipeline logic**—only swap adapters.

## Security & Safety

1. **File Size Limits**: Configurable max (default 250MB)
2. **Tool Timeouts**: 180s default, configurable
3. **Sandboxing**: Tools run with safe flags (no script execution)
4. **Filename Sanitization**: Never trust user filenames
5. **Directory Isolation**: Each job in separate temp directory
6. **No Long-Term Storage**: All files ephemeral with TTL

## Monitoring

### Logs

- `[Prepress API]`: API route operations
- `[Prepress Worker]`: Worker process operations
- `[Prepress Pipeline]`: Pipeline execution
- `[Prepress Poller]`: Job polling
- `[Prepress Cleanup]`: TTL cleanup operations

### Health Checks

Monitor:
- Worker process running
- Jobs not stuck in "running" status
- Temp directory disk usage
- Database job count growth

## Troubleshooting

### Jobs stuck in "queued"
- Check if worker is running
- Check worker logs for errors
- Verify database connection

### Jobs stuck in "running"
- Check for crashed worker
- Increase tool timeouts if PDFs are large
- Check temp directory permissions

### "Tool missing" warnings
- Install missing PDF tools (see Installation)
- Verify tools are in PATH
- Check tool permissions

### High disk usage
- Check TTL cleanup is running
- Reduce PREPRESS_JOB_TTL_HOURS
- Manually clean temp directory if needed

## Development

### Running Locally

1. Install PDF tools (optional but recommended)
2. Set up `.env`:
   ```
   PREPRESS_TEMP_DIR=./tmp/prepress
   PREPRESS_WORKER_IN_PROCESS=true
   ```
3. Run migrations: `npm run db:push`
4. Start dev server: `npm run dev`
5. Navigate to `/prepress` in browser
6. Upload a test PDF

### Testing

See `scripts/prepress-smoke.ts` for automated smoke testing.

## Limitations

- Currently supports PDF only
- Auto-fix limited to Ghostscript normalization
- No multi-page proof rendering (first page only)
- No real-time progress updates (polling only)
- No job cancellation (planned for future)

## Roadmap

- [ ] Job cancellation support
- [ ] Real-time progress via WebSocket
- [ ] Multi-page proof rendering
- [ ] Advanced auto-fix rules
- [ ] Signed URL adapter implementation
- [ ] TitanOS integration hooks
- [ ] Batch processing support
- [ ] Custom validation rules
