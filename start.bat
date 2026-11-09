@echo off
title Bilingual Board - keep this window open
cd /d "%~dp0"
where node >nul 2>nul || (echo Please install Node.js first: https://nodejs.org & pause & exit /b 1)
node server.mjs --open
pause
