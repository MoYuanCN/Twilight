@echo off
setlocal

cd /d %~dp0

if /i "%~1"=="prod" (
    shift
    call "%~dp0start_backend_prod.bat" %*
    exit /b %ERRORLEVEL%
)

if /i "%~1"=="dev" (
    shift
    call "%~dp0start_backend_dev.bat" %*
    exit /b %ERRORLEVEL%
)

call "%~dp0start_backend_dev.bat" %*
exit /b %ERRORLEVEL%
