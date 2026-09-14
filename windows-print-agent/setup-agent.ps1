[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Uninstall,
  [switch]$RemoveConfiguration,
  [switch]$DefinitionOnly,
  [string]$ApiBaseUrl = 'https://api.printershero.com',
  [string]$AgentToken,
  [string]$TravelerPrinter,
  [switch]$NonInteractive,
  [switch]$ElevatedChild
)

$ErrorActionPreference = 'Stop'
$script:WebView2AppId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$script:WebView2DownloadUrl = 'https://developer.microsoft.com/microsoft-edge/webview2/'
$script:PackageRoot = Split-Path -Parent $PSCommandPath
$script:AgentPath = Join-Path $script:PackageRoot 'PrintersHero.PrintAgent.exe'
$script:TaskScript = Join-Path $script:PackageRoot 'scripts\manage-agent-task.ps1'

trap {
  if ($ElevatedChild) {
    Write-Host ''
    Write-Host 'Setup did not complete. Review the error above before closing this Administrator setup window.' -ForegroundColor Red
    [void](Read-Host 'Press Enter to close')
  }
  exit 1
}

function Get-WebView2RuntimeVersion {
  $keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$script:WebView2AppId",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$script:WebView2AppId",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$script:WebView2AppId"
  )
  foreach ($key in $keys) {
    try {
      $version = (Get-ItemProperty -LiteralPath $key -Name 'pv' -ErrorAction Stop).pv
      if ($version -and $version -ne '0.0.0.0') { return [string]$version }
    } catch { }
  }
  return $null
}

function Get-InstalledTravelerPrinters {
  @(Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop |
    ForEach-Object { [string]$_.Name } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Sort-Object -Unique)
}

function Get-PlainSecureString([Security.SecureString]$Value) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-AgentApi([string]$BaseUrl, [string]$Token, [string]$Path, [hashtable]$Body = @{}) {
  $headers = @{ Authorization = "Bearer $Token" }
  Invoke-RestMethod -Method Post -Uri ("{0}{1}" -f $BaseUrl.TrimEnd('/'), $Path) -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress)
}

function Write-Check([string]$Label, [bool]$Ok, [string]$Detail = '') {
  $marker = if ($Ok) { '[OK]' } else { '[FAIL]' }
  $suffix = if ($Detail) { ": $Detail" } else { '' }
  Write-Host "$marker $Label$suffix"
  return $Ok
}

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Restart-ElevatedSetup {
  if (Test-IsAdministrator) { return }
  if ($NonInteractive) { throw 'Setup requires administrator approval to install or remove the Windows startup task.' }

  $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $PSCommandPath), '-ApiBaseUrl', ('"{0}"' -f $ApiBaseUrl), '-ElevatedChild')
  if ($Uninstall) { $arguments += '-Uninstall' }
  if ($RemoveConfiguration) { $arguments += '-RemoveConfiguration' }
  if ($TravelerPrinter) { $arguments += @('-TravelerPrinter', ('"{0}"' -f $TravelerPrinter)) }

  try {
    $process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
  } catch {
    throw 'Administrator approval is required to install or remove the Windows startup task.'
  }
  exit $process.ExitCode
}

function Test-TaskInstalled {
  $null = & schtasks.exe /Query /TN 'PrintersHero Traveler Print Agent' /FO LIST 2>&1
  return $LASTEXITCODE -eq 0
}

function Test-AgentRunning {
  return $null -ne (Get-Process -Name 'PrintersHero.PrintAgent' -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Invoke-AgentCheck {
  $ok = $true
  $webViewVersion = Get-WebView2RuntimeVersion
  $ok = (Write-Check 'WebView2 Runtime' ($null -ne $webViewVersion) $webViewVersion) -and $ok
  $ok = (Write-Check 'Agent executable' (Test-Path -LiteralPath $script:AgentPath -PathType Leaf) $script:AgentPath) -and $ok
  $configuredPrinter = [Environment]::GetEnvironmentVariable('PRINTERSHERO_TRAVELER_PRINTER', 'User')
  $printers = Get-InstalledTravelerPrinters
  $printerFound = $configuredPrinter -and ($printers -contains $configuredPrinter)
  $ok = (Write-Check 'Traveler printer' $printerFound $(if ($configuredPrinter) { $configuredPrinter } else { 'not configured' })) -and $ok
  $baseUrl = [Environment]::GetEnvironmentVariable('PRINTERSHERO_API_BASE_URL', 'User')
  $token = [Environment]::GetEnvironmentVariable('PRINTERSHERO_AGENT_TOKEN', 'User')
  $configurationPresent = -not [string]::IsNullOrWhiteSpace($baseUrl) -and -not [string]::IsNullOrWhiteSpace($token)
  $ok = (Write-Check 'PrintersHero configuration' $configurationPresent $(if ($baseUrl) { $baseUrl } else { 'not configured' })) -and $ok
  $taskInstalled = Test-TaskInstalled
  $ok = (Write-Check 'Startup task installed' $taskInstalled) -and $ok
  $running = Test-AgentRunning
  $ok = (Write-Check 'Agent running' $running) -and $ok
  if ($configurationPresent) {
    try {
      Invoke-AgentApi $baseUrl $token '/api/local-bridge/heartbeat' @{ name = $env:COMPUTERNAME; agentVersion = 'installer-check' } | Out-Null
      $ok = (Write-Check 'PrintersHero heartbeat successful' $true) -and $ok
    } catch {
      $ok = (Write-Check 'PrintersHero heartbeat successful' $false 'Could not authenticate or reach PrintersHero') -and $ok
    }
  } else {
    $ok = (Write-Check 'PrintersHero heartbeat successful' $false 'configuration missing') -and $ok
  }
  return $ok
}

function Select-TravelerPrinter([string]$RequestedPrinter) {
  $printers = Get-InstalledTravelerPrinters
  if ($printers.Count -eq 0) { throw 'No Windows printers were found. Install the Epson Windows driver, then run setup again.' }
  if ($RequestedPrinter) {
    if ($printers -notcontains $RequestedPrinter) { throw "The selected Traveler printer was not found: $RequestedPrinter" }
    return $RequestedPrinter
  }
  for ($index = 0; $index -lt $printers.Count; $index++) { Write-Host ("{0}. {1}" -f ($index + 1), $printers[$index]) }
  do {
    $selection = Read-Host 'Select Traveler printer'
    $number = 0
  } until ([int]::TryParse($selection, [ref]$number) -and $number -ge 1 -and $number -le $printers.Count)
  return $printers[$number - 1]
}

function Remove-AgentConfiguration {
  foreach ($name in @('PRINTERSHERO_API_BASE_URL', 'PRINTERSHERO_AGENT_TOKEN', 'PRINTERSHERO_TRAVELER_PRINTER')) {
    [Environment]::SetEnvironmentVariable($name, $null, 'User')
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

if ($DefinitionOnly) { return }

if (-not $Check) { Restart-ElevatedSetup }

if ($Uninstall) {
  & $script:TaskScript -Action stop
  & $script:TaskScript -Action uninstall
  $shouldRemove = $RemoveConfiguration
  if (-not $shouldRemove -and -not $NonInteractive) { $shouldRemove = (Read-Host 'Remove saved local PrintersHero configuration too? [Y/N]') -match '^[Yy]$' }
  if ($shouldRemove) { Remove-AgentConfiguration; Write-Host 'Local PrintersHero configuration removed.' }
  Write-Host 'PrintersHero Traveler Print Agent uninstalled. Server pairing credentials were not revoked.'
  exit 0
}

if ($Check) { if (-not (Invoke-AgentCheck)) { exit 1 }; exit 0 }

if (-not (Test-Path -LiteralPath $script:AgentPath -PathType Leaf)) { throw "Agent executable not found at $script:AgentPath. Extract the complete package before running setup." }
if (-not (Test-Path -LiteralPath $script:TaskScript -PathType Leaf)) { throw 'The task-management script is missing from this package.' }

$webViewVersion = Get-WebView2RuntimeVersion
if ($webViewVersion) {
  Write-Host "Microsoft WebView2 Runtime: Installed ($webViewVersion)"
} else {
  Write-Host 'Microsoft Edge WebView2 Runtime is required to print Travelers.'
  if ($NonInteractive) { throw 'WebView2 Runtime is required before unattended setup can continue.' }
  if ((Read-Host "Open Microsoft's WebView2 installer page now? [Y/N]") -match '^[Yy]$') {
    Start-Process $script:WebView2DownloadUrl
  }
  throw 'Install Microsoft Edge WebView2 Runtime, then run setup-agent.ps1 again.'
}

$selectedPrinter = Select-TravelerPrinter $TravelerPrinter
if (-not $AgentToken) {
  if ($NonInteractive) { throw 'AgentToken is required for unattended setup.' }
  $AgentToken = Get-PlainSecureString (Read-Host 'Paste the PrintersHero pairing token' -AsSecureString)
}
if ([string]::IsNullOrWhiteSpace($AgentToken)) { throw 'A PrintersHero pairing token is required.' }
if (-not ([Uri]$ApiBaseUrl).IsAbsoluteUri -or ([Uri]$ApiBaseUrl).Scheme -ne 'https') { throw 'PrintersHero API URL must be an HTTPS absolute URL.' }
$ApiBaseUrl = $ApiBaseUrl.TrimEnd('/')

try {
  Invoke-AgentApi $ApiBaseUrl $AgentToken '/api/local-bridge/direct-print/configuration' @{ travelerPrinterName = $selectedPrinter } | Out-Null
  Invoke-AgentApi $ApiBaseUrl $AgentToken '/api/local-bridge/heartbeat' @{ name = $env:COMPUTERNAME; agentVersion = 'installer-1.0.0' } | Out-Null
} catch {
  throw 'PrintersHero pairing could not be confirmed. Check the URL and pairing token, then run setup again.'
}

foreach ($pair in @{ PRINTERSHERO_API_BASE_URL = $ApiBaseUrl; PRINTERSHERO_AGENT_TOKEN = $AgentToken; PRINTERSHERO_TRAVELER_PRINTER = $selectedPrinter }.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'User')
  Set-Item "Env:$($pair.Key)" $pair.Value
}
$AgentToken = $null

& $script:TaskScript -Action install -AgentPath $script:AgentPath
& $script:TaskScript -Action start
Start-Sleep -Seconds 2
Write-Host ''
Write-Host 'PrintersHero Traveler Print Agent'
if (-not (Invoke-AgentCheck)) { throw 'Installation checks did not all pass. Review the failed items above.' }
Write-Host 'Setup complete. In PrintersHero, use Print Traveler to send one test ticket.'
