@echo off
setlocal EnableDelayedExpansion
rem ---------------------------------------------------------------------------
rem Highspell+ dev launcher. Double-click, or run from a terminal:
rem
rem   run-dev.bat                 start the dev client (plugins as last built)
rem   run-dev.bat TileMarkers     rebuild that plugin, copy it in, then start
rem   run-dev.bat ChatPlus HighSpellTCG   several plugins, same thing
rem   run-dev.bat all             rebuild every plugin under plugins\, then start
rem
rem Plugin builds call each plugin's build.mjs with node directly, and the client
rem starts through node_modules\electron-vite directly, so neither depends on
rem which yarn/npm happens to be on PATH (yarn 4's install state broke after the
rem RyeLite -> Highspell+ rename and took the old run-*-dev.bat scripts with it).
rem ---------------------------------------------------------------------------
cd /d "%~dp0"

if not exist node_modules\electron-vite\bin\electron-vite.js (
  echo node_modules is missing or incomplete - run "yarn install" once first.
  goto :err
)

if "%~1"=="" goto :start

if /i "%~1"=="all" (
  for /d %%P in (plugins\*) do (
    if exist "%%P\build.mjs" call :build "%%~nxP" || goto :err
  )
  goto :start
)

:nextarg
if "%~1"=="" goto :start
call :build "%~1" || goto :err
shift
goto :nextarg

:build
set "PLUGIN=%~1"
if not exist "plugins\%PLUGIN%\build.mjs" (
  echo *** No plugin folder "plugins\%PLUGIN%" with a build.mjs ***
  exit /b 1
)
echo === Building plugin %PLUGIN% ===
pushd "plugins\%PLUGIN%"
node build.mjs
if errorlevel 1 (
  popd
  exit /b 1
)
set "COPIED="
for %%F in (dist\*.js) do (
  copy /y "%%F" "..\..\src\renderer\client\plugins\%%~nxF" >nul && set "COPIED=1" && echo     copied %%~nxF
)
popd
if not defined COPIED (
  echo *** %PLUGIN% built nothing in plugins\%PLUGIN%\dist ***
  exit /b 1
)
exit /b 0

:start
rem A running client holds the single-instance lock; a second launch would just add an account
rem tab to it and exit, which looks like "nothing happened" when you wanted a fresh start.
tasklist /FI "IMAGENAME eq electron.exe" 2>nul | find /I "electron.exe" >nul
if not errorlevel 1 (
  echo === Closing the running Highspell+ client first ===
  taskkill /F /IM electron.exe >nul 2>&1
  timeout /t 2 /nobreak >nul
)
echo === Starting Highspell+ dev client ===
node node_modules\electron-vite\bin\electron-vite.js dev
if errorlevel 1 goto :err
goto :eof

:err
echo.
echo *** Something failed - see the output above. ***
pause
exit /b 1
