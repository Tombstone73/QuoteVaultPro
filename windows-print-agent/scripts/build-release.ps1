[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$project = Join-Path $projectRoot 'PrintersHero.PrintAgent.csproj'
$releaseRoot = Join-Path $projectRoot 'release'
$packageRoot = Join-Path $releaseRoot 'PrintersHero-Traveler-Print-Agent'
$zipPath = Join-Path $releaseRoot 'PrintersHero-Traveler-Print-Agent-win-x64.zip'

Remove-Item -LiteralPath $packageRoot -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
dotnet publish $project -p:PublishProfile=Shop-win-x64
if (-not (Test-Path -LiteralPath (Join-Path $packageRoot 'PrintersHero.PrintAgent.exe') -PathType Leaf)) { throw 'Self-contained publish did not produce PrintersHero.PrintAgent.exe.' }
Compress-Archive -Path $packageRoot -DestinationPath $zipPath -Force
Write-Host "Created $zipPath"
