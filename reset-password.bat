@echo off
setlocal
cd /d "%~dp0"
call "%~dp0scripts\ensure-node.bat" || goto :node_error
call npm install || goto :error
call npm run reset-password || goto :error
pause
exit /b 0

:error
echo.
echo Password reset failed. Review the message above and try again.
pause
exit /b 1

:node_error
echo.
echo Password reset cannot continue without Node.js 20.19 or later.
pause
exit /b 1
