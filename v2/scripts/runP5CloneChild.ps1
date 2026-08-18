param([string]$Script = "v2:p5:pricing")
$env:TEST_DATABASE_URL = $env:DATABASE_URL
Get-ChildItem Env: | Where-Object {
  $_.Name -ne "TEST_DATABASE_URL" -and (
    $_.Name -match "(?:DATABASE|POSTGRES|NEON|RAILWAY|CONNECTION_STRING|DB_URL|DB_URI)" -or
    $_.Name -match "^PG(?:_|[A-Z])" -or
    $_.Name -match "^DB(?:_|[A-Z])"
  )
} | ForEach-Object { Remove-Item ("Env:" + $_.Name) }
$env:V2_M0_POSTGRES_INTEGRATION = "1"
npm run $Script
exit $LASTEXITCODE
