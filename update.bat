@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0.deploy\wrangler.jsonc" goto :missing_deploy
call "%~dp0scripts\ensure-node.bat" || goto :node_error
call npm install || goto :error
call npm run update:cloudflare || goto :error
echo.
echo Update completed. Open your existing management URL to check the new version.
pause
exit /b 0

:missing_deploy
echo.
echo Existing deployment configuration was not found.
echo Copy the new package files into your original deployment folder,
echo keep its .deploy folder, and run update.bat there.
echo Do not run setup.bat to update an existing deployment.
pause
exit /b 1

:error
echo.
echo Update failed. Review the message above and try again.
pause
exit /b 1

:node_error
echo.
echo Update cannot continue without Node.js 20.19 or later.
pause
exit /b 1
