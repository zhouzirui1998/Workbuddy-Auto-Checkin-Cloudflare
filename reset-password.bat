@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo [ERROR] Please install Node.js 20.19 or later first.
  pause
  exit /b 1
)
call npm install || goto :error
call npm run reset-password || goto :error
pause
exit /b 0

:error
echo.
echo Password reset failed. Review the message above and try again.
pause
exit /b 1
