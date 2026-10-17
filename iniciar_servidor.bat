@echo off
chcp 65001 > nul
title Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo   Iniciando Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo.
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm"

echo 1. Verificando e liberando portas do sistema (443, 80, 3000)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 443,80,3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1

echo 2. Verificando dependencias...
if not exist "node_modules\express" (
  echo    Instalando dependencias necessarias...
  call npm install --no-audit --no-fund
)

echo 3. Iniciando o servidor Node.js...
echo.
node server.js
echo.
pause