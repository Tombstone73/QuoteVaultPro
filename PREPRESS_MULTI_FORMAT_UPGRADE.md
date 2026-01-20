# Prepress Multi-Format Support Upgrade

## Summary

The Prepress Service has been upgraded to support common print file formats beyond PDF, including JPG, PNG, TIF, AI, and PSD files. Non-PDF files are automatically normalized to PDF for analysis while preserving original format information in the report.

## What Changed

### 1. File Format Support

**Supported Formats:**
- **PDF**: Pass-through unchanged (original behavior)
- **JPG/JPEG**: Normalized to PDF via ImageMagick
- **PNG**: Normalized to PDF via ImageMagick
- **TIF/TIFF**: Normalized to PDF via ImageMagick
- **AI** (Adobe Illustrator): PDF-based, passed through with info warning
- **PSD** (Photoshop): Flattened to PDF via ImageMagick (with warning)

### 2. New Features

**Format Detection:**
- Magic byte analysis (most reliable)
- MIME type validation
- File extension fallback
- High/medium/low confidence scoring

**Image Metadata Analysis:**
- DPI detection and validation
- Pixel dimensions (width × height)
- Color space identification (RGB vs CMYK)
- Automatic DPI warnings (< 150 = WARNING, < 300 = INFO)

**Normalization Notes:**
- Original format tracking
- Normalized format tracking
- Conversion notes in report
- Tool availability reporting

### 3. New Components

**`server/prepress/toolchain/normalizer.ts`:**
- `detectFileFormat()` - Magic byte + MIME type detection
- `normalizeFile()` - Main normalization entry point
- `normalizeRasterToPdf()` - JPG/PNG/TIF → PDF via ImageMagick
- `normalizeAiToPdf()` - AI file pass-through with warnings
- `normalizePsdToPdf()` - PSD flattening via ImageMagick
- `getImageMetadata()` - DPI/dimension extraction via ImageMagick identify

**Updated Type Definitions:**
- `NormalizationInfo` interface in types.ts
- `PrepressReport.normalization` field (optional)
- `ToolAvailability.imagemagick` field
- `ToolVersions.imagemagick` field

### 4. Updated Files

**Backend:**
- `server/prepress/toolchain/normalizer.ts` (new)
- `server/prepress/types.ts` (added normalization types)
- `server/prepress/pipeline.ts` (integrated normalization)
- `server/prepress/routes.ts` (accept multiple file types)
- `server/prepress/toolchain/detector.ts` (detect ImageMagick)

**Frontend:**
- `client/src/pages/prepress.tsx` (multi-format upload, normalization info display)

**Documentation:**
- `docs/PREPRESS_SERVICE.md` (updated architecture, file lifecycle)
- `docs/PREPRESS_TOOLCHAIN.md` (added ImageMagick installation)
- `PREPRESS_MULTI_FORMAT_UPGRADE.md` (this document)

## Behavior by Format

### PDF Files
- **Behavior**: Passed through unchanged
- **Report**: No normalization section
- **Preflight**: Full PDF analysis as before
- **Example Issues**: Font embedding, page sizes, QPDF validation

### JPG/PNG/TIF Files
- **Behavior**: Converted to PDF via ImageMagick `convert`
- **Report**: 
  - Original format (jpg/png/tif)
  - Normalized to PDF
  - DPI (if available)
  - Dimensions (width × height px)
  - Color space
- **Preflight**: Full PDF analysis on normalized PDF
- **Example Issues**:
  - `LOW_DPI` (BLOCKER if < 150)
  - `MARGINAL_DPI` (INFO if < 300)
  - `RGB_COLORSPACE` (INFO, CMYK preferred)
  - `NORMALIZATION_FAILED` (BLOCKER if ImageMagick unavailable)

### AI Files (Adobe Illustrator)
- **Behavior**: Passed through (AI files are PDF-based)
- **Report**:
  - Original format: ai
  - Normalized to: pdf
  - Info note about PDF-based format
- **Preflight**: Full PDF analysis
- **Example Issues**:
  - `AI_FILE_DETECTED` (INFO, recommends PDF/X-4 export)
  - Standard PDF preflight issues

### PSD Files (Photoshop)
- **Behavior**: Flattened to single layer via ImageMagick
- **Report**:
  - Original format: psd
  - Normalized to: pdf (if successful)
  - Warning about layer flattening
- **Preflight**: Full PDF analysis on flattened output
- **Example Issues**:
  - `PSD_FLATTENED` (WARNING, layers lost)
  - `PSD_NORMALIZATION_FAILED` (BLOCKER if ImageMagick unavailable)
  - Recommendation to flatten in Photoshop first

## Fail-Soft Behavior

**ImageMagick Not Available:**
- PDF files: ✅ Work normally (no normalization needed)
- JPG/PNG/TIF: ❌ BLOCKER issue, job fails with actionable message
- AI files: ✅ Work normally (PDF-based, pass-through)
- PSD files: ❌ BLOCKER issue, job fails with actionable message

**Other Tools Missing:**
- Same fail-soft behavior as before
- Missing tools produce warnings
- Job still succeeds with reduced analysis

## API Changes

### Upload Endpoint (POST /api/prepress/jobs)

**Before:**
```typescript
Accept: application/pdf, .pdf
```

**After:**
```typescript
Accept: 
  - application/pdf, .pdf
  - image/jpeg, .jpg, .jpeg
  - image/png, .png
  - image/tiff, .tif, .tiff
  - application/postscript, .ai
  - image/vnd.adobe.photoshop, .psd
```

### Report JSON Schema

**New Fields:**
```typescript
{
  normalization?: {
    originalFormat: 'pdf' | 'jpg' | 'png' | 'tif' | 'ai' | 'psd';
    normalizedFormat: 'pdf' | null;
    notes: string[];
    metadata?: {
      dpi?: number;
      width?: number;
      height?: number;
      colorSpace?: string;
    };
  }
}
```

## UI Changes

### Upload Form
- Label changed: "Print File (PDF, JPG, PNG, TIF, AI, PSD)"
- Accept attribute expanded to include all supported formats
- Page title: "Print File Preflight Tool"

### Results Display
- New "File Normalization" section (blue info box)
- Shows original format, normalized format, metadata
- Displays DPI, dimensions, color space (when available)
- Lists normalization notes

## Migration Notes

**No Database Migration Required:**
- Existing `prepress_jobs` schema unchanged
- `contentType` field already supports any MIME type
- Report JSON backward-compatible (normalization field is optional)

**Backward Compatibility:**
- PDF-only workflows work exactly as before
- Existing reports have no normalization section
- No breaking changes to API contracts

## Testing Recommendations

1. **PDF Upload**: Verify pass-through behavior unchanged
2. **JPG Upload (300 DPI)**: Should normalize successfully, no DPI warnings
3. **JPG Upload (72 DPI)**: Should normalize, trigger LOW_DPI warning
4. **PNG Upload**: Should normalize to PDF, analyze correctly
5. **TIF Upload**: Should normalize to PDF, extract DPI
6. **AI Upload**: Should pass through as PDF with info note
7. **PSD Upload**: Should flatten with warning or block if tool missing
8. **Missing ImageMagick**: PDF works, raster images fail with BLOCKER

## Tool Installation

**Required for Multi-Format Support:**
```bash
# Ubuntu/Debian
sudo apt-get install imagemagick

# macOS
brew install imagemagick

# Windows (Chocolatey)
choco install imagemagick
```

**Verify Installation:**
```bash
convert --version
identify --version
```

## Issue Codes Reference

### New Issue Codes

| Code | Severity | Description |
|------|----------|-------------|
| `LOW_DPI` | BLOCKER | DPI < 150 (unacceptable for print) |
| `MARGINAL_DPI` | INFO | DPI < 300 (acceptable but not optimal) |
| `RGB_COLORSPACE` | INFO | Image in RGB, CMYK preferred for print |
| `NORMALIZATION_FAILED` | BLOCKER | Failed to convert to PDF (tool missing) |
| `AI_FILE_DETECTED` | INFO | AI file detected, recommends PDF/X-4 export |
| `PSD_FLATTENED` | WARNING | PSD layers flattened during conversion |
| `PSD_NORMALIZATION_FAILED` | BLOCKER | Failed to flatten PSD (tool missing) |
| `UNSUPPORTED_FORMAT` | BLOCKER | File format not supported |

## Future Enhancements

**Potential Additions (Not in v1):**
- EPS file support (PostScript → PDF)
- SVG support (vector → PDF)
- Multi-page TIFF handling
- RAW image format support (CR2, NEF, etc.)
- Automatic CMYK conversion for raster images
- Layer preservation for PSD (via PDF layers)
- Advanced AI file validation

## Questions & Troubleshooting

**Q: Why does my PSD upload fail?**
A: Install ImageMagick. Without it, PSD normalization is not available.

**Q: Can I upload multi-page PDFs?**
A: Yes, PDF behavior is unchanged. Multi-page support exists.

**Q: Will my JPG be converted losslessly?**
A: ImageMagick uses high-quality settings (quality=95, Zip compression), but any raster→PDF conversion may introduce some quality change. For critical work, export PDF from the source application.

**Q: What happens to transparency in PNG files?**
A: Transparency is flattened to white background during PDF conversion.

**Q: Why is my AI file showing PDF issues?**
A: AI files are PDF-based. The preflight checks the embedded PDF structure. For cleanest results, export as PDF/X-4 from Illustrator.

**Q: Can I upload CMYK TIFF files?**
A: Yes, TIFF files preserve color space during normalization.

---

**Upgrade Complete**: The Prepress Service now supports professional print-shop file formats with intelligent normalization and comprehensive metadata analysis.
