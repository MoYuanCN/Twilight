@echo off
setlocal EnableDelayedExpansion

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
if "%TWILIGHT_FORCE_RESTART_BOT%"=="" set "TWILIGHT_FORCE_RESTART_BOT=0"
if "%TWILIGHT_BOT_LOCK_FILE%"=="" set "TWILIGHT_BOT_LOCK_FILE=%~dp0db\telegram_bot.lock"

echo Using Python: %PYTHON%
echo Mode: production (uvicorn)
if "%TWILIGHT_WITH_BOT%"=="1" (
    echo Bot: enabled ^(separate window^)
    set "EXISTING_BOT_PID="
    if exist "%TWILIGHT_BOT_LOCK_FILE%" (
        for /f "usebackq delims=" %%p in ("%TWILIGHT_BOT_LOCK_FILE%") do set "EXISTING_BOT_PID=%%p"
        if not "!EXISTING_BOT_PID!"=="" (
            powershell -NoProfile -Command "if (Get-Process -Id !EXISTING_BOT_PID! -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
            if errorlevel 1 (
                echo Found stale Bot lock, cleaning: %TWILIGHT_BOT_LOCK_FILE%
                del /f /q "%TWILIGHT_BOT_LOCK_FILE%" >nul 2>nul
            ) else (
                if "%TWILIGHT_FORCE_RESTART_BOT%"=="1" (
                    echo Found running Bot PID: !EXISTING_BOT_PID!, force restarting...
                    taskkill /PID !EXISTING_BOT_PID! /F >nul 2>nul
                ) else (
                    echo Found running Bot PID: !EXISTING_BOT_PID!, skip starting duplicate instance
                    goto RUN_API
                )
            )
        )
    )
    start "Twilight Bot" cmd /k "cd /d %~dp0 && %PYTHON% main.py bot"
) else (
    echo Bot: disabled ^(set TWILIGHT_WITH_BOT=1 to enable^)
)

:RUN_API
"%PYTHON%" -m uvicorn asgi:app --host 0.0.0.0 --port 5000 --workers 4 %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Backend exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
