param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'uninstall')]
  [string]$Action,
  [string]$AgentPath
)

$taskName = 'PrintersHero Traveler Print Agent'
$processName = 'PrintersHero.PrintAgent'

function Require-AgentPath {
  if ([string]::IsNullOrWhiteSpace($AgentPath) -or -not (Test-Path -LiteralPath $AgentPath -PathType Leaf)) {
    throw 'Install requires -AgentPath pointing to PrintersHero.PrintAgent.exe.'
  }
}

switch ($Action) {
  'install' {
    Require-AgentPath
    schtasks.exe /Create /TN $taskName /TR ('"{0}"' -f (Resolve-Path -LiteralPath $AgentPath)) /SC ONLOGON /RL LIMITED /F
  }
  'start' { schtasks.exe /Run /TN $taskName }
  'stop' { Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process }
  'restart' {
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process
    schtasks.exe /Run /TN $taskName
  }
  'status' {
    $task = schtasks.exe /Query /TN $taskName /FO LIST /V 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Output 'Not installed'; exit 1 }
    $task
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
  }
  'uninstall' {
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process
    schtasks.exe /Delete /TN $taskName /F
  }
}
