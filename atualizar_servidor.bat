@echo off
chcp 65001 > nul
title Atualizar Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo    Atualizando Servidor Sedna via GitHub
echo ========================================================
echo.
cd /d "%~dp0"

echo 1. Fazendo backup de seguranca dos dados locais...
if not exist "data\backups_locais" mkdir "data\backups_locais"
if exist "data\users.json" copy /y "data\users.json" "data\backups_locais\users_backup.json" > nul
if exist "data\db-config.json" copy /y "data\db-config.json" "data\backups_locais\db-config_backup.json" > nul
if exist ".env" copy /y ".env" "data\backups_locais\env_backup.env" > nul

echo 2. Puxando atualizacoes do GitHub...
git pull origin main

echo.
echo 3. Garantindo integridade dos arquivos locais...
if not exist "data\users.json" (
  if exist "data\backups_locais\users_backup.json" (
    copy /y "data\backups_locais\users_backup.json" "data\users.json" > nul
    echo    - data\users.json restaurado com sucesso!
  )
)
if not exist "data\db-config.json" (
  if exist "data\backups_locais\db-config_backup.json" (
    copy /y "data\backups_locais\db-config_backup.json" "data\db-config.json" > nul
  )
)

echo 4. Verificando dependencias...
call npm install --no-audit --no-fund

echo.
echo ========================================================
echo   Servidor atualizado com sucesso!
echo   Reinicie a janela do servidor (iniciar_servidor.bat)
echo   para carregar o novo codigo.
echo ========================================================
pause
