@echo off
title PrintersHero Traveler Print Agent Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-agent.ps1" %*
set "setupExitCode=%ERRORLEVEL%"
if not "%setupExitCode%"=="0" (
  echo.
  echo Setup did not complete. Review the error above before closing this window.
  pause
)
exit /b %setupExitCode%
