@echo off
setlocal

echo Stopping Accessible Route Planner servers...

call :stop_port 8000 backend
call :stop_port 5173 frontend
call :stop_old_dev_processes

echo Done.
pause
exit /b 0

:stop_port
set "PORT=%~1"
set "NAME=%~2"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo Stopping %NAME% process %%a on port %PORT%
  taskkill /PID %%a /T /F >nul 2>nul
)
exit /b 0

:stop_old_dev_processes
echo Stopping any remaining uvicorn or Vite dev processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn main:app*' -or $_.CommandLine -like '*npm run dev*' -or $_.CommandLine -like '*multiprocessing.spawn*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b 0
