@echo off
chcp 65001 > nul
title Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo   Iniciando Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo.
cd /d "%~dp0"

echo 1. Verificando e liberando portas do sistema (443, 80, 3000)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 443,80,3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":443.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":80.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":3000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo 2. Verificando dependencias...
if not exist node_modules (
  echo    Instalando dependencias necessarias...
  call npm install
)

echo 3. Iniciando o servidor Node.js...
echo.
node server.js
pause