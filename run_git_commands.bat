@echo off
cd /d C:\titan-automation\QuoteVaultPro
echo === Git Status --porcelain ===
git --no-pager status --porcelain
echo.
echo === Git Diff --name-only ===
git --no-pager diff --name-only
