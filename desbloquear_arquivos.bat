@echo off
chcp 65001 > nul
title Desbloquear Arquivos - Gerador de Pedidos Sedna
echo ========================================================
echo    Desbloqueando Scripts e Arquivos no Windows
echo ========================================================
echo.
cd /d "%~dp0"

echo Removendo bloqueio do Windows SmartScreen de todos os arquivos...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"

echo.
echo ========================================================
echo [SUCESSO] Todos os arquivos e scripts .bat foram desbloqueados!
echo           Agora voce pode executa-los normalmente sem avisos.
echo ========================================================
echo.
pause
