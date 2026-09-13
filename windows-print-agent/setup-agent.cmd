@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-agent.ps1" %*
if errorlevel 1 pause
