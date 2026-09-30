@echo off
chcp 65001 > nul
title Sincronizar com GitHub - Gerador de Pedidos
echo =======================================================
echo    Sincronizando Gerador de Pedidos com o GitHub
echo =======================================================
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
        echo [ERRO] O Git não foi encontrado neste computador!
        echo Baixe e instale o Git: https://git-scm.com/download/win
        pause
        exit /b 1
    )
)

set /p msg="Digite a descricao da alteracao (ou aperte ENTER para automatico): "
if "%msg%"=="" set msg=Atualizacao do sistema em %date% as %time%

echo.
echo 1. Protegendo senhas e credenciais locais...
"%GIT_CMD%" rm -r --cached "data/backups_locais" >nul 2>&1
"%GIT_CMD%" rm --cached ".env" >nul 2>&1
"%GIT_CMD%" rm --cached "data/users.json" >nul 2>&1
"%GIT_CMD%" rm --cached "data/db-config.json" >nul 2>&1

echo 2. Adicionando arquivos modificados...
"%GIT_CMD%" add .
"%GIT_CMD%" rm -r --cached "data/backups_locais" >nul 2>&1
"%GIT_CMD%" rm --cached ".env" >nul 2>&1
"%GIT_CMD%" rm --cached "data/users.json" >nul 2>&1
"%GIT_CMD%" rm --cached "data/db-config.json" >nul 2>&1

echo 3. Registrando alteracoes (commit)...
"%GIT_CMD%" commit -m "%msg%"

echo 4. Sincronizando versao de revisao...
for /f %%i in ('"%GIT_CMD%" rev-parse --short HEAD') do set HASH=%%i
node -e "const fs=require('fs'); fs.writeFileSync('version.json', JSON.stringify({ version: '1.0.0', revision: '%HASH%', branch: 'main', repository: 'titimoro2/Gerador_de_pedidos_sedna', updatedAt: new Date().toISOString() }, null, 2));"
"%GIT_CMD%" commit --amend --no-edit -a

echo 5. Enviando para o GitHub...
"%GIT_CMD%" push origin main

echo.
echo =======================================================
echo    Atualizacao enviada com sucesso para o GitHub!
echo =======================================================
pause
