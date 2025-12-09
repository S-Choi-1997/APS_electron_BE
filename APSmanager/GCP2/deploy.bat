@echo off
SETLOCAL

rem Wrapper to call PowerShell deploy script
powershell -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*

ENDLOCAL
