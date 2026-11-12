@echo off
setlocal
if "%~1"=="" (
  echo Usage: FDAT-DirectML.cmd "C:\path\models" [--full] [--dynamic]
  echo Default: three tensor probes per FDAT model, not complete pages.
  exit /b 2
)
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\Upscayl Enhanced.exe" "%~dp0..\app.asar\export\electron\jobs\fdat-diagnostic.js" %*
exit /b %ERRORLEVEL%
