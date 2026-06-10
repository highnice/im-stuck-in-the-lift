@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
title Lift Game - Server (do not close)
echo.
echo Stopping old server on port 3000 if any...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
echo.
echo Starting server...
echo Wait for: Lift game: http://localhost:3000
echo.
echo Host PIN: !yeswecan  (exclamation + yeswecan)
echo Players: join with 4-letter room code
echo.
echo DO NOT CLOSE THIS WINDOW while playing.
echo.
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
if exist "%ProgramFiles%\nodejs\npm.cmd" (
  call "%ProgramFiles%\nodejs\npm.cmd" start
) else (
  npm start
)
pause
endlocal
