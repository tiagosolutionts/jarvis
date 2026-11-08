@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js em https://nodejs.org & pause & exit /b)
start "" http://localhost:3333
node server.js
pause
