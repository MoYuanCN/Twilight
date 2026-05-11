@echo off
setlocal

cd /d %~dp0

echo ==========================================
echo    Twilight Backend (Development)
echo ==========================================

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else if exist "venv\Scripts\python.exe" (
    set "PYTHON=venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

echo Using Python: %PYTHON%
echo Mode: development (main.py api --debug)

"%PYTHON%" main.py api --debug %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Backend exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
