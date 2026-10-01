@echo off
chcp 65001 > nul
title Instalar Certificado SSL Seguro no Windows
echo ========================================================
echo    Instalando Certificado SSL Seguro no Windows
echo ========================================================
echo.
cd /d "%~dp0"

REM Verifica se esta executando com permissoes de Administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] Solicitando permissao de Administrador do Windows...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process cmd -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

if not exist "ssl\server.crt" (
    echo [ERRO] O arquivo ssl\server.crt ainda nao foi encontrado.
    echo Inicie o servidor uma vez com 'iniciar_servidor.bat' para
    echo gerar os certificados antes de executar este instalador.
    echo.
    pause
    exit /b 1
)

echo Adicionando certificado ao repositorio de Autoridades Confiaveis do Windows...
certutil -addstore -f "ROOT" "ssl\server.crt" >nul 2>&1

if %errorlevel%==0 (
    echo.
    echo ========================================================
    echo [SUCESSO] Certificado instalado com sucesso no Windows!
    echo.
    echo           1. Feche e reabra o Microsoft Edge ou Chrome.
    echo           2. Acesse https://localhost ou https://IP_DO_SERVIDOR
    echo           3. O aviso de 'nao seguro' desaparecera!
    echo ========================================================
) else (
    echo.
    echo [ERRO] Nao foi possivel registrar o certificado no Windows.
)
echo.
pause