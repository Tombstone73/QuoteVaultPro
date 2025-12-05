# PowerShell script to run file storage migration
# Applies 0009_file_storage_model.sql to add enhanced file storage fields

Write-Host "Running 0009_file_storage_model.sql migration..." -ForegroundColor Cyan

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "Error: .env file not found" -ForegroundColor Red
    exit 1
}

# Load DATABASE_URL from .env
Get-Content .env | ForEach-Object {
    if ($_ -match '^DATABASE_URL=(.+)$') {
        $env:DATABASE_URL = $matches[1]
    }
}

# Verify DATABASE_URL is set
if (-not $env:DATABASE_URL) {
    Write-Host "Error: DATABASE_URL not found in .env file" -ForegroundColor Red
    exit 1
}

# Check if migration file exists
$migrationFile = "server/db/migrations/0009_file_storage_model.sql"
if (-not (Test-Path $migrationFile)) {
    Write-Host "Error: Migration file not found at $migrationFile" -ForegroundColor Red
    exit 1
}

# Run migration using psql
try {
    psql $env:DATABASE_URL -f $migrationFile
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Migration completed successfully!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "Migration failed with exit code $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} catch {
    Write-Host "Error running migration: $_" -ForegroundColor Red
    exit 1
}
