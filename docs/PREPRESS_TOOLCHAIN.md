# Prepress Toolchain Installation Guide

## Overview

The Prepress service uses external processing tools for file normalization, PDF analysis, and manipulation. All tools are **optional** and the service will fail gracefully if they are not installed, producing warnings instead of errors.

## Tool Summary

| Tool | Purpose | Required | Auto-Fix |
|------|---------|----------|----------|
| **ImageMagick** (convert) | Raster image → PDF normalization | Optional | No |
| **qpdf** | PDF validation and sanity checks | Optional | No |
| **pdfinfo** | Metadata extraction (page count, size) | Optional | No |
| **pdffonts** | Font embedding analysis | Optional | No |
| **ghostscript** (gs) | PDF normalization and fixes | Optional | Yes |
| **pdftocairo** | Proof rendering (PNG output) | Optional | No |

## Installation by Platform

### Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install -y imagemagick qpdf poppler-utils ghostscript
```

**Package contents:**
- `imagemagick`: convert, identify tools (raster image normalization)
- `qpdf`: qpdf tool
- `poppler-utils`: pdfinfo, pdffonts, pdftocairo
- `ghostscript`: gs tool

### macOS

```bash
brew install imagemagick qpdf poppler ghostscript
```

### Windows

#### Option 1: Chocolatey (Recommended)

```powershell
choco install imagemagick qpdf poppler ghostscript
```

#### Option 2: Manual Installation

1. **ImageMagick**: Download from https://imagemagick.org/script/download.php#windows
2. **QPDF**: Download from https://github.com/qpdf/qpdf/releases
3. **Poppler**: Download from https://blog.alivate.com.au/poppler-windows/
4. **Ghostscript**: Download from https://ghostscript.com/releases/gsdnld.html

Add installation directories to PATH.

### Docker

```dockerfile
FROM node:20

# Install PDF and image processing tools
RUN apt-get update && apt-get install -y \
    imagemagick \
    qpdf \
    poppler-utils \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# ... rest of your Dockerfile
```

## Verification

After installation, verify tools are available:

```bash
convert --version  # ImageMagick
qpdf --version
pdfinfo -v
pdffonts -v
gs --version
pdftocairo -v
```

All commands should output version information without errors.

## Tool Details

### QPDF

**Purpose**: Validates PDF structure and reports issues.

**Usage in Prepress**:
- Runs `qpdf --check <file>` to validate structure
- Detects corrupt PDFs, broken references, invalid syntax
- Reports errors and warnings

**Issues Detected**:
- Structural errors in PDF
- Broken cross-references
- Invalid stream encodings

### PDFInfo

**Purpose**: Extracts PDF metadata.

**Usage in Prepress**:
- Runs `pdfinfo <file>` to extract metadata
- Gets page count, page sizes, PDF version
- Provides basic document information

**Data Extracted**:
- Page count
- Page dimensions (width x height in points)
- PDF version
- Creator/Producer metadata

### PDFFonts

**Purpose**: Analyzes font embedding.

**Usage in Prepress**:
- Runs `pdffonts <file>` to list all fonts
- Checks if fonts are embedded
- Reports non-embedded fonts

**Issues Detected**:
- Fonts not fully embedded
- Missing font subsets
- Font encoding issues

### Ghostscript

**Purpose**: PDF normalization and safe auto-fix.

**Usage in Prepress**:
- Rewrites PDF with safe settings
- Normalizes color spaces
- Attempts to fix structural issues
- Embeds fonts when possible

**Fix Operations**:
- `/prepress` quality settings
- PDF 1.4 compatibility
- Color space preservation
- Font embedding

**Command**:
```bash
gs -dSAFER -dBATCH -dNOPAUSE -dQUIET \
   -sDEVICE=pdfwrite \
   -dPDFSETTINGS=/prepress \
   -dCompatibilityLevel=1.4 \
   -dEmbedAllFonts=true \
   -sOutputFile=output.pdf \
   input.pdf
```

### PDFtoCairo

**Purpose**: Renders PDF pages to images.

**Usage in Prepress**:
- Renders first page to PNG at 150 DPI
- Creates proof/preview image
- Used for visual verification

**Output**:
- PNG image of first page
- 150 DPI resolution (configurable)
- RGB color space

**Command**:
```bash
pdftocairo -png -f 1 -l 1 -r 150 -singlefile input.pdf output
```

## Troubleshooting

### Tool Not Found

**Symptom**: Prepress reports "Tool 'xxx' is not available"

**Solutions**:
1. Verify tool is installed: `which <tool>` (Unix) or `where <tool>` (Windows)
2. Check PATH includes tool directory
3. Restart worker process after installation
4. Check tool permissions: `chmod +x <path>`

### Permission Denied

**Symptom**: Tool execution fails with permission error

**Solutions**:
1. Check file permissions on temp directory
2. Ensure worker process has execute permissions
3. On Linux: verify SELinux/AppArmor rules
4. On macOS: check Gatekeeper settings

### Tool Timeout

**Symptom**: Large PDFs cause timeout errors

**Solutions**:
1. Increase timeout: `PREPRESS_TOOL_TIMEOUT_MS=300000` (5 minutes)
2. Test tool manually with same file
3. Check if PDF is corrupt (try with smaller test file)
4. Increase temp directory space

### Ghostscript Fails

**Symptom**: Auto-fix mode produces errors

**Solutions**:
1. Verify Ghostscript version: `gs --version` (9.0+ recommended)
2. Check if input PDF is damaged
3. Try running Ghostscript manually
4. Reduce PDF complexity before processing

## Performance Considerations

### Tool Execution Times

Typical execution times per tool (for a 10MB, 50-page PDF):

- **qpdf**: 1-3 seconds
- **pdfinfo**: < 1 second
- **pdffonts**: 1-2 seconds
- **ghostscript**: 10-30 seconds (rewrite)
- **pdftocairo**: 2-5 seconds (first page only)

**Total**: ~15-40 seconds for full check, 25-65 seconds for check+fix

### Optimization Tips

1. **Parallel Tools**: Future enhancement to run tools in parallel
2. **Caching**: Tools are detected once at startup
3. **Streaming**: Large PDFs are written to disk, not buffered in memory
4. **Timeouts**: Prevent hung processes (default 180s)

## Security Notes

### Safe Flags

All tools are run with security-focused flags:

- **Ghostscript**: `-dSAFER` prevents file system access
- **QPDF**: No script execution capabilities
- **Poppler tools**: Read-only PDF operations

### Sandboxing

Consider running worker in a sandboxed environment:

- Docker container with limited filesystem access
- Dedicated system user with restricted permissions
- Temp directory on separate partition

### Resource Limits

Set system resource limits to prevent DoS:

```bash
# Linux: Set ulimits for worker process
ulimit -t 300  # CPU time limit (seconds)
ulimit -v 2000000  # Virtual memory limit (KB)
ulimit -f 500000  # File size limit (blocks)
```

## Version Compatibility

### Tested Versions

- **QPDF**: 10.0+
- **Poppler**: 20.0+
- **Ghostscript**: 9.50+

### Known Issues

- Ghostscript < 9.0: Missing some PDF 1.7 features
- Poppler < 0.82: Limited font embedding detection
- QPDF < 8.0: May report false positives on modern PDFs

## Alternative Tools

If default tools are unavailable, consider:

- **PDFtk**: Alternative to QPDF (licensing restrictions)
- **MuPDF**: Alternative renderer (fewer features)
- **ImageMagick**: Can render PDFs (Ghostscript dependency)

*Note: Prepress currently only supports the documented tools. Adding alternatives requires code changes.*

## Getting Help

If tools are not working:

1. Check tool versions: `<tool> --version`
2. Test manually with sample PDF
3. Review worker logs: `[Prepress Pipeline]` and `[Prepress Toolchain]`
4. Verify temp directory permissions
5. Check PATH environment variable

For tool-specific issues, consult:
- QPDF: https://qpdf.readthedocs.io/
- Poppler: https://poppler.freedesktop.org/
- Ghostscript: https://www.ghostscript.com/doc/
