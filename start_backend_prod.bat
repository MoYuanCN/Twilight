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

if "%TWILIGHT_WITH_BOT%"=="" set "TWILIGHT_WITH_BOT=1"

echo Using Python: %PYTHON%
echo Mode: production (uvicorn)
if "%TWILIGHT_WITH_BOT%"=="1" (
    echo Bot: enabled ^(separate window^)
    start "Twilight Bot" cmd /k "cd /d %~dp0 && %PYTHON% main.py bot"
) else (
    echo Bot: disabled ^(set TWILIGHT_WITH_BOT=1 to enable^)
)

"%PYTHON%" -m uvicorn asgi:app --host 0.0.0.0 --port 5000 --workers 4 %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Backend exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
