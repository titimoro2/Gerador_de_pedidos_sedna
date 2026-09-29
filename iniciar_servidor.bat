@echo off
chcp 65001 > nul
title Servidor Sedna - Gerador de Pedidos (Porta 80)
echo ========================================================
echo   Iniciando Servidor Sedna - Gerador de Pedidos
echo   Porta: 80 (Redirecionamento Externo: 8025)
echo ========================================================
echo.
cd /d "%~dp0"

echo Verificando dependencias...
if not exist node_modules (
  echo Instalando dependencias necessarias...
  call npm install
)

echo Iniciando o servidor Node.js...
node server.js
pause
