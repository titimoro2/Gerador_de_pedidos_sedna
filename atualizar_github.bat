@echo off
chcp 65001 > nul
title Sincronizar com GitHub - Gerador de Pedidos
echo =======================================================
echo    Sincronizando Gerador de Pedidos com o GitHub
echo =======================================================
echo.
cd /d "%~dp0"

REM Adiciona caminhos comuns do Git e Node ao PATH da sessao
set "PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\Git\bin;C:\Program Files (x86)\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd;C:\Program Files\nodejs"

REM Localiza o executavel do Git
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
        echo [ERRO] O Git nao foi encontrado neste computador!
        echo Baixe e instale o Git: https://git-scm.com/download/win
        pause
        exit /b 1
    )
)

"%GIT_CMD%" config http.sslVerify false >nul 2>&1

echo 1. Protegendo senhas e credenciais locais...
"%GIT_CMD%" rm -r --cached "data/backups_locais" >nul 2>&1
"%GIT_CMD%" rm --cached ".env" >nul 2>&1
"%GIT_CMD%" rm --cached "data/users.json" >nul 2>&1
"%GIT_CMD%" rm --cached "data/db-config.json" >nul 2>&1

echo 2. Verificando alteracoes locais...
"%GIT_CMD%" add -A
"%GIT_CMD%" rm -r --cached "data/backups_locais" >nul 2>&1
"%GIT_CMD%" rm --cached ".env" >nul 2>&1
"%GIT_CMD%" rm --cached "data/users.json" >nul 2>&1
"%GIT_CMD%" rm --cached "data/db-config.json" >nul 2>&1

REM Verifica se ha arquivos modificados no index para commit
"%GIT_CMD%" diff --cached --quiet
set HAS_CHANGES=%errorlevel%

REM Verifica se ha commits locais pendentes de envio
set PENDING_COMMITS=0
for /f %%a in ('"%GIT_CMD%" rev-list --count origin/main..HEAD 2^>nul') do set PENDING_COMMITS=%%a

if %HAS_CHANGES%==0 (
    if "%PENDING_COMMITS%"=="0" (
        echo.
        echo =======================================================
        echo   Nenhuma alteracao detectada no projeto!
        echo   O repositorio local ja esta 100%% atualizado com o GitHub.
        echo =======================================================
        echo.
        pause
        exit /b 0
    ) else (
        echo.
        echo Enviando commits pendentes para o GitHub...
        goto :enviar_github
    )
)

echo.
set /p msg="Digite a descricao da alteracao (ou aperte ENTER para automatico): "
if "%msg%"=="" set msg=Atualizacao do sistema em %date% as %time%

echo.
echo 3. Sincronizando versao de revisao...
node -e "const fs=require('fs'); let v={version:'1.0.0',repository:'titimoro2/Gerador_de_pedidos_sedna',branch:'main'}; try{v=JSON.parse(fs.readFileSync('version.json','utf8'))}catch(e){} v.updatedAt=new Date().toISOString(); fs.writeFileSync('version.json', JSON.stringify(v,null,2));"
"%GIT_CMD%" add version.json

echo 4. Registrando alteracoes (commit)...
"%GIT_CMD%" commit -m "%msg%"

:enviar_github
echo 5. Enviando para o GitHub...
"%GIT_CMD%" push origin main
if %errorlevel% neq 0 (
    echo.
    echo AVISO: Sincronizando com o GitHub antes de reenviar...
    "%GIT_CMD%" pull --rebase origin main
    "%GIT_CMD%" push origin main
)

if %errorlevel%==0 (
    echo.
    echo =======================================================
    echo    Atualizacao enviada com sucesso para o GitHub!
    echo =======================================================
) else (
    echo.
    echo =======================================================
    echo [ERRO] Ocorreu uma falha ao enviar para o GitHub.
    echo        Verifique sua conexao com a internet.
    echo =======================================================
)
echo.
pause