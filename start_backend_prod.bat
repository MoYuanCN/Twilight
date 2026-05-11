@echo off
setlocal

cd /d %~dp0

echo ==========================================
echo    Twilight Backend (Production)
echo ==========================================

if exist ".venv\Scripts\python.exe" (
    set "PYTHON=.venv\Scripts\python.exe"
) else if exist "venv\Scripts\python.exe" (
    set "PYTHON=venv\Scripts\python.exe"
) else (
    set "PYTHON=python"
)

echo Using Python: %PYTHON%
echo Mode: production (uvicorn)

"%PYTHON%" -m uvicorn asgi:app --host 0.0.0.0 --port 5000 --workers 4 %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Backend exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
