@echo off
title Gerador de Pedidos - Servidor Web
echo ========================================================
echo   Iniciando Servidor Web - Gerador de Pedidos e Propostas
echo   Acesse no navegador: http://localhost:3000
echo ========================================================
cd /d "%~dp0"
start http://localhost:3000
node server.js
pause
