@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
title Lift Game - Install
echo.
echo Installing npm packages... please wait.
echo.
if exist "%ProgramFiles%\nodejs\npm.cmd" (
  call "%ProgramFiles%\nodejs\npm.cmd" install
) else (
  npm install
)
echo.
if %ERRORLEVEL% EQU 0 (
  echo Done. Next: double-click start-game.bat
) else (
  echo Failed. Install Node.js from https://nodejs.org then run this again.
)
echo.
pause
endlocal
