param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('install', 'start', 'stop', 'restart', 'status', 'uninstall')]
  [string]$Action,
  [string]$AgentPath
)

$taskName = 'PrintersHero Traveler Print Agent'
$processName = 'PrintersHero.PrintAgent'
$taskLauncherDirectory = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData)) 'PrintersHero\PrintAgent'
$taskLauncherPath = Join-Path $taskLauncherDirectory 'start-agent.ps1'

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

function Get-AgentTaskCommand {
  Require-AgentPath
  $launcherSourcePath = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $AgentPath)) 'scripts\start-agent.ps1'
  if (-not (Test-Path -LiteralPath $launcherSourcePath -PathType Leaf)) {
    throw 'Install requires scripts\start-agent.ps1 from the complete PrintersHero package.'
  }

  # Task Scheduler does not refresh a signed-in user's environment after setup
  # changes it. The launcher reads the saved user configuration each time so a
  # new pairing token is used immediately, without embedding it in the task.
  # schtasks.exe also limits /TR to 261 characters. Install the non-secret
  # launcher at a stable short path so package paths with spaces remain safe.
  New-Item -ItemType Directory -Path $taskLauncherDirectory -Force | Out-Null
  Copy-Item -LiteralPath $launcherSourcePath -Destination $taskLauncherPath -Force
  return "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $taskLauncherPath"
}

switch ($Action) {
  'install' {
    Invoke-TaskScheduler @('/Create', '/TN', $taskName, '/TR', (Get-AgentTaskCommand), '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F') | Out-Null
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
    Remove-Item -LiteralPath $taskLauncherPath -Force -ErrorAction SilentlyContinue
  }
}
