@echo off

call :check_node
if not errorlevel 1 (
  echo [OK] Node.js %WB_NODE_VERSION% detected.
  exit /b 0
)

echo [INFO] Node.js 20.19 or later was not found.
where winget >nul 2>nul || (
  echo [ERROR] Windows Package Manager ^(winget^) is unavailable.
  echo Install "App Installer" from Microsoft Store, or install Node.js LTS from https://nodejs.org/
  exit /b 1
)

echo [INFO] Installing the current Node.js LTS with winget...
echo [INFO] Windows may ask for administrator approval.
winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo [ERROR] Node.js installation failed. Review the winget message above and retry.
  exit /b 1
)

set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
call :check_node
if errorlevel 1 (
  echo [ERROR] Node.js was installed, but this window cannot find it yet.
  echo Close this window and run setup.bat again.
  exit /b 1
)

echo [OK] Node.js %WB_NODE_VERSION% installed successfully.
exit /b 0

:check_node
set "WB_NODE_VERSION="
set "WB_NODE_MAJOR="
set "WB_NODE_MINOR="
where node >nul 2>nul || exit /b 1
where npm >nul 2>nul || exit /b 1
for /f "tokens=1,2,* delims=." %%A in ('node -p "process.versions.node" 2^>nul') do (
  set "WB_NODE_VERSION=%%A.%%B.%%C"
  set "WB_NODE_MAJOR=%%A"
  set "WB_NODE_MINOR=%%B"
)
if not defined WB_NODE_MAJOR exit /b 1
if %WB_NODE_MAJOR% GTR 20 exit /b 0
if %WB_NODE_MAJOR% EQU 20 if %WB_NODE_MINOR% GEQ 19 exit /b 0
exit /b 1
