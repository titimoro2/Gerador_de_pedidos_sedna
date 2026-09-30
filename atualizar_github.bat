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

echo 3. Sincronizando versao de revisao...
for /f %%i in ('"C:\Program Files\Git\cmd\git.exe" rev-parse --short HEAD') do set HASH=%%i
node -e "const fs=require('fs'); fs.writeFileSync('version.json', JSON.stringify({ version: '1.0.0', revision: '%HASH%', branch: 'main', repository: 'titimoro2/Gerador_de_pedidos_sedna', updatedAt: new Date().toISOString() }, null, 2));"
"C:\Program Files\Git\cmd\git.exe" commit --amend --no-edit -a

echo 4. Enviando para o GitHub...
"C:\Program Files\Git\cmd\git.exe" push origin main

echo.
echo =======================================================
echo    Atualizacao enviada com sucesso para o GitHub!
echo =======================================================
pause
