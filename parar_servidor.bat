@echo off
chcp 65001 > nul
title Parar Servidor Sedna
echo ========================================================
echo    Parando Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo.

echo 1. Fechando janelas ativas do Servidor Sedna...
taskkill /F /FI "WINDOWTITLE eq Servidor Sedna*" /T >nul 2>&1

echo 2. Liberando porta 3000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":3000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo 3. Liberando porta 80...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 80 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":80.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo 4. Finalizando processos Node.js do servidor...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

echo.
echo ========================================================
echo    Servidor encerrado e portas liberadas com sucesso!
echo ========================================================
echo.
pause
