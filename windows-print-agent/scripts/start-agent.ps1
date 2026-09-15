[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$agentPath = [Environment]::GetEnvironmentVariable('PRINTERSHERO_AGENT_PATH', 'User')
$logPath = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'PrintersHero\print-agent-launcher.log'

function Write-LauncherLog([string]$Message) {
  $directory = Split-Path -Parent $logPath
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  Add-Content -LiteralPath $logPath -Value ("{0:O} {1}" -f [DateTimeOffset]::UtcNow, $Message)
}

try {
  if ([string]::IsNullOrWhiteSpace($agentPath) -or -not (Test-Path -LiteralPath $agentPath -PathType Leaf)) {
    throw 'Saved PrintersHero agent path is missing or unavailable. Run setup-agent.cmd again from the extracted package.'
  }

  foreach ($name in @('PRINTERSHERO_API_BASE_URL', 'PRINTERSHERO_AGENT_TOKEN', 'PRINTERSHERO_TRAVELER_PRINTER', 'PRINTERSHERO_SUPABASE_URL', 'PRINTERSHERO_SUPABASE_PUBLISHABLE_KEY')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'User')
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Saved $name configuration is missing. Run setup-agent.cmd again."
    }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }

  Write-LauncherLog 'Starting Print Agent with current saved user configuration.'
  & $agentPath
  if ($LASTEXITCODE -ne 0) { throw "Print Agent exited with code $LASTEXITCODE." }
} catch {
  # Never include configuration values or the token in the launcher log.
  Write-LauncherLog ("Unable to start Print Agent: {0}" -f $_.Exception.Message)
  exit 1
}
