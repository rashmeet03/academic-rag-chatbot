@echo off
echo [Smart Copilot] Starting Project...

echo Validating and freeing port 8000 for the backend...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8000"') do (
    taskkill /F /PID %%a 2>nul
)

echo Starting backend...
start "Backend - Smart Copilot" cmd /k "cd /d %~dp0 && call myenv\Scripts\activate && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo Starting frontend...
start "Frontend - Smart Copilot" cmd /k "cd /d %~dp0\ui && npm run dev -- --host"

echo ===========================================
echo Both servers are starting up!
echo Backend API : http://localhost:8000
echo Frontend UI : http://localhost:5173
echo ===========================================
