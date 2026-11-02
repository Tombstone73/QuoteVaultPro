param(
  [ValidateSet('Run', 'Cleanup')][string]$Action = 'Run',
  [string]$PgBin,
  [ValidateRange(1024, 65535)][int]$Port = 55481,
  [switch]$DownloadRuntime,
  [string[]]$TestPaths = @('server/tests/quoteRoutingAndConversion.contract.test.ts', 'server/tests/inboundEmail.postgres.integration.ts', 'server/tests/inboundEmailImport.postgres.integration.ts', 'server/tests/inboundGmailAcknowledgement.postgres.integration.ts'),
  [string]$TestNamePattern
)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repo
$cache = Join-Path $repo 'node_modules/.cache/inbound-pg-validation'
$data = [IO.Path]::GetFullPath((Join-Path $cache 'data'))
if (-not $data.StartsWith($repo + [IO.Path]::DirectorySeparatorChar) -or
    $data -ne [IO.Path]::GetFullPath((Join-Path $repo 'node_modules/.cache/inbound-pg-validation/data'))) {
  throw 'Unsafe cluster directory'
}
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if (-not $PgBin) { $PgBin = Join-Path $cache 'runtime/pgsql/bin' }
if ($DownloadRuntime) {
  if ($Action -ne 'Run') { throw 'DownloadRuntime is only supported with Run' }
  # Official portable archive: no installer, service, registry or PATH changes.
  $archive = Join-Path $cache 'postgresql-16.4-1-windows-x64-binaries.zip'
  $expectedHash = '3508D8F085BC3980F38211A82E3F31E5FCAE9952105D3DC2F8BE67B64A822BAA'
  if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip' -OutFile $archive -TimeoutSec 180
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Portable PostgreSQL archive hash mismatch' }
  $runtime = Join-Path $cache 'runtime'
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName -notmatch '^pgsql/(bin|lib|share)/' -or $entry.FullName.EndsWith('/')) { continue }
      $destination = [IO.Path]::GetFullPath((Join-Path $runtime $entry.FullName))
      if (-not $destination.StartsWith([IO.Path]::GetFullPath($runtime) + [IO.Path]::DirectorySeparatorChar)) { throw 'Unsafe archive path' }
      if (Test-Path -LiteralPath $destination) { continue }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination)
    }
  } finally { $zip.Dispose() }
}
foreach ($tool in @('initdb.exe', 'pg_ctl.exe', 'postgres.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PgBin $tool))) { throw "Complete PostgreSQL binaries required; missing $tool. Supply -PgBin or use -DownloadRuntime." }
}
if (-not (Test-Path -LiteralPath (Join-Path $PgBin '../share/postgres.bki'))) { throw 'Incomplete PostgreSQL installation: share/postgres.bki is missing' }
$markerPath = Join-Path $cache 'owner.json'
function Stop-OwnedCluster {
  if (-not (Test-Path -LiteralPath $data)) { return }
  if (-not (Test-Path -LiteralPath $markerPath)) { throw 'Refusing cleanup without ownership marker' }
  $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
  if ($marker.directory -ne $data.Replace('\', '/') -or $marker.database -ne 'printershero_inbound_test') { throw 'Cluster ownership mismatch' }
  & (Join-Path $PgBin 'pg_ctl.exe') -D $data status *> $null
  if ($LASTEXITCODE -eq 0) {
    & (Join-Path $PgBin 'pg_ctl.exe') -D $data -m immediate -w stop
    if ($LASTEXITCODE -ne 0) { throw 'Cluster stop failed; data retained' }
  } elseif ($LASTEXITCODE -ne 3 -and (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid'))) {
    throw 'Cannot establish stopped cluster state; data retained'
  }
  # Absolute directory checked above; remove only this marked disposable cluster.
  Remove-Item -LiteralPath $data -Recurse -Force
  Remove-Item -LiteralPath $markerPath -Force
}
if ($Action -eq 'Cleanup') { Stop-OwnedCluster; return }
if (Test-Path -LiteralPath $data) { throw 'Disposable cluster already exists. Inspect it, then use -Action Cleanup before Run.' }
$marker = @{ directory = $data.Replace('\', '/'); port = $Port; database = 'printershero_inbound_test' }
$marker | ConvertTo-Json | Set-Content -LiteralPath $markerPath
$savedEnv = @{}
foreach ($key in @('DATABASE_URL','TEST_DATABASE_URL','MIGRATION_DATABASE_URL','DIRECT_DATABASE_URL','NODE_OPTIONS')) {
  $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
  [Environment]::SetEnvironmentVariable($key, $null, 'Process')
}
try {
  node scripts/check-journal-monotonic.mjs > (Join-Path $cache 'journal.log') 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Migration journal check failed; see journal.log' }
  node scripts/check-migration-history-integrity.mjs > (Join-Path $cache 'integrity.log') 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Protected migration integrity check failed; see integrity.log' }
  & (Join-Path $PgBin 'initdb.exe') -D $data -U inbound_test_admin -A trust --encoding=UTF8 --locale=C > (Join-Path $cache 'init.log') 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed; see init.log' }
  # Trust is restricted to this synthetic, short-lived loopback cluster.
  & (Join-Path $PgBin 'pg_ctl.exe') -D $data -l (Join-Path $cache 'server.log') -o "-h 127.0.0.1 -p $Port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL failed to start; no database setup attempted' }
  node --import tsx scripts/qa/generate-inbound-test-foundation.mts
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic foundation generation failed' }
  node --import tsx scripts/qa/prepare-inbound-test-database.mts $Port
  if ($LASTEXITCODE -ne 0) { throw 'Isolated database verification/bootstrap failed' }
  $env:TEST_DATABASE_URL = "postgresql://inbound_test_admin@127.0.0.1:$Port/printershero_inbound_test"
  $env:NODE_OPTIONS = '--max-old-space-size=8192 --experimental-vm-modules'
  # setupInboundPostgres verifies server identity again before canonical runner.
  $jestArgs = @('node_modules/jest/bin/jest.js', '--config', 'jest.inbound-postgres.config.js', '--runInBand', '--cacheDirectory', 'node_modules/.cache/jest-inbound-pg', '--runTestsByPath') + $TestPaths
  if ($TestNamePattern) { $jestArgs += @('-t', $TestNamePattern) }
  node @jestArgs > (Join-Path $cache 'results.log') 2>&1
  $testExit = $LASTEXITCODE
  Get-Content -LiteralPath (Join-Path $cache 'results.log') -Tail 50
  if ($testExit -ne 0) { throw 'Real PostgreSQL tests failed; see results.log and server.log' }
} finally {
  Stop-OwnedCluster
  foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
}
