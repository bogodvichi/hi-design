@echo off
REM install.bat - Windows installer entry (double-click to run)
REM Set UTF-8 codepage, prefer pwsh, auto-close on success
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where pwsh >nul 2>nul && (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
  goto :checkResult
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

:checkResult
if errorlevel 1 goto :failed

:done
echo.
echo ==================================================
echo  Install finished. This window will close.
echo ==================================================
exit 0

:failed
echo.
echo ==================================================
echo  Install failed. Please keep this window open and report the error above.
echo ==================================================
exit 1
