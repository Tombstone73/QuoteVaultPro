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
$script:SetupVersion = '1.0.13'

if (-not $PSBoundParameters.ContainsKey('ApiBaseUrl')) {
  $savedApiBaseUrl = [Environment]::GetEnvironmentVariable('PRINTERSHERO_API_BASE_URL', 'User')
  if (-not [string]::IsNullOrWhiteSpace($savedApiBaseUrl)) { $ApiBaseUrl = $savedApiBaseUrl }
}

trap {
  if ($ElevatedChild) {
    Write-Host ''
    Write-Host ("Error: {0}" -f $_.Exception.Message) -ForegroundColor Red
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

function Invoke-AgentApi([string]$BaseUrl, [string]$Token, [string]$Path, [hashtable]$Body = @{}) {
  $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create(("{0}{1}" -f $BaseUrl.TrimEnd('/'), $Path))
  $request.Method = 'POST'
  $request.ContentType = 'application/json; charset=utf-8'
  $request.Accept = 'application/json'
  $request.Headers['Authorization'] = "Bearer $Token"
  $payload = $Body | ConvertTo-Json -Compress
  $payloadBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $request.ContentLength = $payloadBytes.Length
  $requestStream = $null
  $response = $null
  try {
    $requestStream = $request.GetRequestStream()
    $requestStream.Write($payloadBytes, 0, $payloadBytes.Length)
    $requestStream.Flush()
    try {
      $response = [System.Net.HttpWebResponse]$request.GetResponse()
    } catch [System.Net.WebException] {
      if ($_.Exception.Response) {
        $response = [System.Net.HttpWebResponse]$_.Exception.Response
      } else {
        throw
      }
    }
    [pscustomobject]@{ StatusCode = [int]$response.StatusCode; ReasonPhrase = [string]$response.ReasonPhrase }
  } finally {
    if ($response) { $response.Dispose() }
    if ($requestStream) { $requestStream.Dispose() }
  }
}

function Test-SuccessStatus([object]$Response) {
  return $null -ne $Response -and $Response.StatusCode -ge 200 -and $Response.StatusCode -lt 300
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
      $heartbeat = Invoke-AgentApi $baseUrl $token '/api/local-bridge/heartbeat' @{ name = $env:COMPUTERNAME; agentVersion = 'installer-check' }
      if (-not (Test-SuccessStatus $heartbeat)) { throw 'PrintersHero returned an unsuccessful heartbeat status.' }
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
  foreach ($name in @('PRINTERSHERO_API_BASE_URL', 'PRINTERSHERO_AGENT_TOKEN', 'PRINTERSHERO_TRAVELER_PRINTER', 'PRINTERSHERO_AGENT_PATH')) {
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
Write-Host "PrintersHero Traveler Print Agent Setup $script:SetupVersion"
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
  $savedAgentToken = [Environment]::GetEnvironmentVariable('PRINTERSHERO_AGENT_TOKEN', 'User')
  if (-not [string]::IsNullOrWhiteSpace($savedAgentToken) -and -not $NonInteractive) {
    $useSavedToken = Read-Host 'Use the saved PrintersHero pairing token for this retry? [Y/n]'
    if ([string]::IsNullOrWhiteSpace($useSavedToken) -or $useSavedToken -match '^[Yy]') { $AgentToken = $savedAgentToken }
  } elseif (-not [string]::IsNullOrWhiteSpace($savedAgentToken) -and $NonInteractive) {
    $AgentToken = $savedAgentToken
  }
}
if (-not $AgentToken) {
  if ($NonInteractive) { throw 'AgentToken is required for unattended setup.' }
  Write-Host 'Copy the PrintersHero pairing token, then return to this setup window.'
  [void](Read-Host 'Press Enter to read the pairing token from the clipboard')
  try {
    $AgentToken = Get-Clipboard -Raw -ErrorAction Stop
  } catch {
    throw 'The Windows clipboard could not be read. Use Copy token in PrintersHero, then run setup again.'
  }
}
$AgentToken = [regex]::Replace($AgentToken, '[^A-Za-z0-9_-]', '')
if ([string]::IsNullOrWhiteSpace($AgentToken)) { throw 'A PrintersHero pairing token is required.' }
if ($AgentToken -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'The pairing token format is invalid. Create a new token in PrintersHero, use Copy token, then rerun setup.' }
if (-not ([Uri]$ApiBaseUrl).IsAbsoluteUri -or ([Uri]$ApiBaseUrl).Scheme -ne 'https') { throw 'PrintersHero API URL must be an HTTPS absolute URL.' }
$ApiBaseUrl = $ApiBaseUrl.TrimEnd('/')

foreach ($pair in @{ PRINTERSHERO_API_BASE_URL = $ApiBaseUrl; PRINTERSHERO_AGENT_TOKEN = $AgentToken; PRINTERSHERO_TRAVELER_PRINTER = $selectedPrinter; PRINTERSHERO_AGENT_PATH = $script:AgentPath }.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($pair.Key, $pair.Value, 'User')
  Set-Item "Env:$($pair.Key)" $pair.Value
}

try {
  $configuration = Invoke-AgentApi $ApiBaseUrl $AgentToken '/api/local-bridge/direct-print/configuration' @{ travelerPrinterName = $selectedPrinter }
  if ($configuration.StatusCode -eq 401) { throw 'The pairing token is invalid or revoked. Create a new Local Bridge token in PrintersHero, copy it, then run setup again.' }
  if (-not (Test-SuccessStatus $configuration)) { throw ("PrintersHero returned HTTP {0} ({1}) while configuring the selected printer through {2}." -f $configuration.StatusCode, $configuration.ReasonPhrase, $ApiBaseUrl) }
} catch {
  throw $_
}

try {
  $heartbeat = Invoke-AgentApi $ApiBaseUrl $AgentToken '/api/local-bridge/heartbeat' @{ name = $env:COMPUTERNAME; agentVersion = 'installer-1.0.13' }
  if (-not (Test-SuccessStatus $heartbeat)) { throw 'PrintersHero returned an unsuccessful heartbeat status.' }
} catch {
  throw 'The printer was configured, but PrintersHero could not receive the agent heartbeat. Check the production API connection and run setup again.'
}

$AgentToken = $null

& $script:TaskScript -Action stop
& $script:TaskScript -Action install -AgentPath $script:AgentPath
& $script:TaskScript -Action start
Start-Sleep -Seconds 2
Write-Host ''
Write-Host 'PrintersHero Traveler Print Agent'
if (-not (Invoke-AgentCheck)) { throw 'Installation checks did not all pass. Review the failed items above.' }
Write-Host 'Setup complete. In PrintersHero, use Print Traveler to send one test ticket.'
