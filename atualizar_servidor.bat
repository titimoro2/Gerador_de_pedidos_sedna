@echo off
chcp 65001 > nul
title Atualizar Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo    Atualizando Servidor Sedna via GitHub
echo ========================================================
echo.
cd /d "%~dp0"

REM Adiciona caminhos comuns do Git e Node ao PATH da sessão
set "PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files (x86)\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd;C:\Program Files\nodejs"

REM Localiza o executável do Git
set "GIT_CMD=git"
where git >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\Git\cmd\git.exe" (
        set "GIT_CMD=C:\Program Files\Git\cmd\git.exe"
    ) else if exist "C:\Program Files\Git\bin\git.exe" (
        set "GIT_CMD=C:\Program Files\Git\bin\git.exe"
    ) else if exist "C:\Program Files (x86)\Git\cmd\git.exe" (
        set "GIT_CMD=C:\Program Files (x86)\Git\cmd\git.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" (
        set "GIT_CMD=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
    ) else (
        echo.
        echo ========================================================
        echo [ERRO] O Git não foi encontrado neste computador/servidor!
        echo.
        echo Para que o servidor consiga puxar as atualizações do GitHub,
        echo instale o Git para Windows na máquina:
        echo Download oficial: https://git-scm.com/download/win
        echo (Ao instalar, mantenha marcada a opção 'Git from the command line').
        echo ========================================================
        echo.
        pause
        exit /b 1
    )
)

echo [0/5] Encerrando servidor e liberando portas/arquivos...
taskkill /F /FI "WINDOWTITLE eq Servidor Sedna*" /T >nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,80 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":3000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":80.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
echo       Servidor parado e portas liberadas com sucesso.
echo.

echo [1/5] Fazendo backup de seguranca dos dados locais...
if not exist "data\backups_locais" mkdir "data\backups_locais"
if exist "data\users.json" copy /y "data\users.json" "data\backups_locais\users_backup.json" > nul
if exist "data\db-config.json" copy /y "data\db-config.json" "data\backups_locais\db-config_backup.json" > nul
if exist ".env" copy /y ".env" "data\backups_locais\env_backup.env" > nul
echo       Backup local concluido.
echo.

echo [2/5] Puxando atualizacoes do GitHub (git pull)...
"%GIT_CMD%" pull origin main
if %errorlevel% neq 0 (
    echo.
    echo AVISO: O git pull encontrou alteracoes locais.
    echo Sincronizando com seguranca mantendo dados protegidos...
    "%GIT_CMD%" stash
    "%GIT_CMD%" pull origin main
    "%GIT_CMD%" stash pop >nul 2>&1
)
echo.

echo [3/5] Garantindo integridade dos arquivos locais...
if not exist "data\users.json" (
  if exist "data\backups_locais\users_backup.json" (
    copy /y "data\backups_locais\users_backup.json" "data\users.json" > nul
    echo    - data\users.json restaurado com sucesso!
  )
)
if not exist "data\db-config.json" (
  if exist "data\backups_locais\db-config_backup.json" (
    copy /y "data\backups_locais\db-config_backup.json" "data\db-config.json" > nul
    echo    - data\db-config.json restaurado com sucesso!
  )
)
if not exist ".env" (
  if exist "data\backups_locais\env_backup.env" (
    copy /y "data\backups_locais\env_backup.env" ".env" > nul
    echo    - .env restaurado com sucesso!
  )
)
echo.

echo [4/5] Verificando dependencias...
call npm install --no-audit --no-fund
echo.

echo [5/5] Concluido!
echo ========================================================
echo   Servidor atualizado com sucesso para a ultima versao!
echo ========================================================
echo.
set /p startnow="Deseja iniciar o servidor agora? (S/N) [padrao: S]: "
if /i "%startnow%"=="N" (
    echo.
    echo Para iniciar o servidor depois, execute: iniciar_servidor.bat
    pause
    exit /b
)

echo.
echo Iniciando o servidor...
start "Servidor Sedna - Gerador de Pedidos" cmd /k "iniciar_servidor.bat"
