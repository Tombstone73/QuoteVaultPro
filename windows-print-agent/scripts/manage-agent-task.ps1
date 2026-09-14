param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'uninstall')]
  [string]$Action,
  [string]$AgentPath
)

$taskName = 'PrintersHero Traveler Print Agent'
$processName = 'PrintersHero.PrintAgent'

function Invoke-TaskScheduler([string[]]$Arguments) {
  $output = & schtasks.exe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    $detail = ($output | Out-String).Trim()
    throw "Windows Task Scheduler command failed: $detail"
  }
  $output
}

function Require-AgentPath {
  if ([string]::IsNullOrWhiteSpace($AgentPath) -or -not (Test-Path -LiteralPath $AgentPath -PathType Leaf)) {
    throw 'Install requires -AgentPath pointing to PrintersHero.PrintAgent.exe.'
  }
}

switch ($Action) {
  'install' {
    Require-AgentPath
    Invoke-TaskScheduler @('/Create', '/TN', $taskName, '/TR', ('"{0}"' -f (Resolve-Path -LiteralPath $AgentPath)), '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F') | Out-Null
  }
  'start' { Invoke-TaskScheduler @('/Run', '/TN', $taskName) | Out-Null }
  'stop' { Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process }
  'restart' {
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process
    Invoke-TaskScheduler @('/Run', '/TN', $taskName) | Out-Null
  }
  'status' {
    $task = & schtasks.exe /Query /TN $taskName /FO LIST /V 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Output 'Not installed'; exit 1 }
    $task
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, StartTime
  }
  'uninstall' {
    Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process
    $output = & schtasks.exe /Delete /TN $taskName /F 2>&1
    if ($LASTEXITCODE -ne 0 -and ($output | Out-String) -notmatch 'cannot find|does not exist') {
      throw "Windows Task Scheduler command failed: $(($output | Out-String).Trim())"
    }
  }
}
