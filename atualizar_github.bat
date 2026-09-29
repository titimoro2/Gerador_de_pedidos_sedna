@echo off
chcp 65001 > nul
echo =======================================================
echo    Sincronizando Gerador de Pedidos com o GitHub
echo =======================================================
echo.

set /p msg="Digite a descricao da alteracao (ou aperte ENTER para automatico): "
if "%msg%"=="" set msg=Atualizacao do sistema em %date% as %time%

echo.
echo 1. Adicionando arquivos modificados...
"C:\Program Files\Git\cmd\git.exe" add .

echo 2. Registrando alteracoes (commit)...
"C:\Program Files\Git\cmd\git.exe" commit -m "%msg%"

echo 3. Enviando para o GitHub...
"C:\Program Files\Git\cmd\git.exe" push origin main

echo.
echo =======================================================
echo    Atualizacao enviada com sucesso para o GitHub!
echo =======================================================
pause
