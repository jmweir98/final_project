@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "VENV=%BACKEND%\.venv"

echo ========================================
echo Accessible Route Planner
echo ========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python, then run this script again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Install Node.js, then run this script again.
  pause
  exit /b 1
)

call :stop_port 8000 backend
call :stop_port 5173 frontend
call :stop_old_dev_processes

if not exist "%VENV%\Scripts\python.exe" (
  echo Creating backend virtual environment...
  python -m venv "%VENV%"
  if errorlevel 1 (
    echo Failed to create backend virtual environment.
    pause
    exit /b 1
  )
)

echo Installing backend dependencies...
"%VENV%\Scripts\python.exe" -m pip install -r "%BACKEND%\requirements.txt"
if errorlevel 1 (
  echo Failed to install backend dependencies.
  pause
  exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
  echo Installing frontend dependencies...
  pushd "%FRONTEND%"
  call npm install
  if errorlevel 1 (
    popd
    echo Failed to install frontend dependencies.
    pause
    exit /b 1
  )
  popd
)

echo Starting backend at http://127.0.0.1:8000
start "Accessible Route Planner - Backend" /D "%BACKEND%" cmd /k ".venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"

echo Starting frontend at http://localhost:5173
start "Accessible Route Planner - Frontend" /D "%FRONTEND%" cmd /k "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"

echo.
echo Both servers are starting.
echo Opening http://localhost:5173 in your browser.
echo.
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
pause
exit /b 0

:stop_port
set "PORT=%~1"
set "NAME=%~2"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  echo Port %PORT% is already in use. Stopping existing %NAME% process %%a...
  taskkill /PID %%a /T /F >nul 2>nul
)
exit /b 0

:stop_old_dev_processes
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*uvicorn main:app*' -or $_.CommandLine -like '*npm run dev*' -or $_.CommandLine -like '*multiprocessing.spawn*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul
exit /b 0
