@echo off
chcp 65001 > nul
title Atualizar Servidor Sedna - Gerador de Pedidos
echo ========================================================
echo    Atualizando Servidor Sedna via GitHub
echo ========================================================
echo.
cd /d "%~dp0"

REM Adiciona caminhos comuns do Git e Node ao PATH da sessao
set "PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files (x86)\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd;C:\Program Files\nodejs"

REM Localiza o executavel do Git sem aninhamentos complexos
set "GIT_CMD=git"
where git >nul 2>&1
if %errorlevel%==0 goto :git_pronto

if exist "C:\Program Files\Git\cmd\git.exe" (
    set "GIT_CMD=C:\Program Files\Git\cmd\git.exe"
    goto :git_pronto
)
if exist "C:\Program Files\Git\bin\git.exe" (
    set "GIT_CMD=C:\Program Files\Git\bin\git.exe"
    goto :git_pronto
)
if exist "C:\Program Files (x86)\Git\cmd\git.exe" (
    set "GIT_CMD=C:\Program Files (x86)\Git\cmd\git.exe"
    goto :git_pronto
)
if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" (
    set "GIT_CMD=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
    goto :git_pronto
)

echo.
echo ========================================================
echo [AVISO] O comando git nao foi detectado automaticamente!
echo.
echo Se voce acabou de instalar o Git, feche esta janela
echo e abra novamente para atualizar as variaveis de sistema.
echo.
echo Caso ainda nao tenha instalado, baixe gratuitamente:
echo https://git-scm.com/download/win
echo ========================================================
echo.
pause
exit /b 1

:git_pronto
REM Configura o Git para nao falhar por certificados desatualizados no Windows (schannel: SEC_E_UNTRUSTED_ROOT)
"%GIT_CMD%" config --global http.sslVerify false >nul 2>&1
"%GIT_CMD%" config --global http.sslBackend openssl >nul 2>&1

echo [0/5] Encerrando servidor e liberando portas/arquivos...
taskkill /F /FI "WINDOWTITLE eq Servidor Sedna*" /T >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 443,80,3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":443.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r ":80.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
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
echo       Backup local concluido com sucesso.
echo.

echo [2/5] Puxando atualizacoes do GitHub...
if not exist ".git" (
    echo       Pasta sem vinculo Git. Inicializando conexao com o repositorio...
    "%GIT_CMD%" init >nul 2>&1
    "%GIT_CMD%" remote add origin https://github.com/titimoro2/Gerador_de_pedidos_sedna.git >nul 2>&1
)

"%GIT_CMD%" config http.sslVerify false >nul 2>&1
"%GIT_CMD%" remote get-url origin >nul 2>&1
if %errorlevel% neq 0 (
    "%GIT_CMD%" remote add origin https://github.com/titimoro2/Gerador_de_pedidos_sedna.git >nul 2>&1
) else (
    "%GIT_CMD%" remote set-url origin https://github.com/titimoro2/Gerador_de_pedidos_sedna.git >nul 2>&1
)

echo       Buscando ultimos arquivos do branch main...
"%GIT_CMD%" -c http.sslVerify=false fetch origin main
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao conectar ao GitHub. Verifique a conexao com a internet.
    pause
    exit /b 1
)

"%GIT_CMD%" branch -M main >nul 2>&1
REM Aplica com precisao todos os arquivos modificados na pasta do servidor
"%GIT_CMD%" reset --hard origin/main
"%GIT_CMD%" branch --set-upstream-to=origin/main main >nul 2>&1
echo       Arquivos do servidor atualizados com o GitHub com sucesso!
echo.

echo [3/5] Garantindo integridade dos dados e credenciais locais...
if not exist "data\users.json" (
  if exist "data\backups_locais\users_backup.json" (
    copy /y "data\backups_locais\users_backup.json" "data\users.json" > nul
    echo       - data\users.json restaurado do backup local.
  )
)
if not exist "data\db-config.json" (
  if exist "data\backups_locais\db-config_backup.json" (
    copy /y "data\backups_locais\db-config_backup.json" "data\db-config.json" > nul
    echo       - data\db-config.json restaurado do backup local.
  )
)
if not exist ".env" (
  if exist "data\backups_locais\env_backup.env" (
    copy /y "data\backups_locais\env_backup.env" ".env" > nul
    echo       - .env restaurado do backup local.
  )
)
echo       Dados locais preservados com sucesso.
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
