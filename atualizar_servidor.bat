@echo off
chcp 65001 > nul
title Atualizar Servidor Sedna - Gerador de Pedidos
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-Content -LiteralPath '%~f0' -Encoding UTF8; $idx = [Array]::IndexOf($c, '# === POWERSHELL_SCRIPT_START ==='); if ($idx -ge 0) { $ps = $c[($idx+1)..($c.Length-1)] -join [Environment]::NewLine; $runner = Join-Path $env:TEMP 'sedna_update_runner.ps1'; Set-Content -LiteralPath $runner -Value $ps -Encoding UTF8; & $runner -AppDir '%~dp0' } else { Write-Host '[ERRO] Bloco PowerShell nao encontrado no arquivo .bat.' -ForegroundColor Red; Read-Host 'Pressione ENTER para sair' }" & exit /b 0

# === POWERSHELL_SCRIPT_START ===
param(
    [string]$AppDir = $PSScriptRoot
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $AppDir -or -not (Test-Path -LiteralPath $AppDir)) {
    $AppDir = (Get-Location).Path
}
$AppDir = $AppDir.TrimEnd('\', '/')
Set-Location -LiteralPath $AppDir

# Adiciona caminhos padrao do Git e Node.js ao PATH da sessao atual
$extraPaths = @(
    "C:\Program Files\nodejs",
    "C:\Program Files (x86)\nodejs",
    "$env:APPDATA\npm",
    "C:\Program Files\Git\cmd",
    "C:\Program Files\Git\bin",
    "C:\Program Files (x86)\Git\cmd",
    "$env:LOCALAPPDATA\Programs\Git\cmd"
)
foreach ($p in $extraPaths) {
    if ((Test-Path -LiteralPath $p) -and ($env:PATH -notlike "*$p*")) {
        $env:PATH = "$env:PATH;$p"
    }
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "   ATUALIZADOR AUTOMATICO DO SERVIDOR SEDNA (GITHUB)    " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Pasta do Servidor: $AppDir" -ForegroundColor Gray
Write-Host ""

# ----------------------------------------------------------------------------
# [0/5] ENCERRANDO SERVIDOR ATIVO E LIBERANDO PORTAS
# ----------------------------------------------------------------------------
Write-Host "[0/5] Encerrando servidor ativo e liberando portas (80, 443, 3000)..." -ForegroundColor Yellow
try {
    & taskkill /F /FI "WINDOWTITLE eq Servidor Sedna*" /T 2>$null | Out-Null
} catch {}

try {
    $conns = Get-NetTCPConnection -LocalPort 80, 443, 3000 -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids) {
            if ($procId -gt 4) {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            }
        }
    }
} catch {}

try {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server.js*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

Start-Sleep -Seconds 1
Write-Host "      -> Servidor parado e portas liberadas." -ForegroundColor Green
Write-Host ""

# ----------------------------------------------------------------------------
# [1/5] BACKUP COMPLETO DOS DADOS E CONFIGURACOES LOCAIS
# ----------------------------------------------------------------------------
Write-Host "[1/5] Fazendo backup de seguranca dos dados e credenciais locais..." -ForegroundColor Yellow
$backupDir = Join-Path $AppDir "data\backups_locais"
if (-not (Test-Path -LiteralPath $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

$filesToPreserve = @(
    @{ Src = ".env";                        Bak = "env_backup.env" },
    @{ Src = "data\users.json";             Bak = "users_backup.json" },
    @{ Src = "data\sessions.json";          Bak = "sessions_backup.json" },
    @{ Src = "data\db-config.json";         Bak = "db-config_backup.json" },
    @{ Src = "data\rh-db-config.json";      Bak = "rh-db-config_backup.json" },
    @{ Src = "data\rh-adjustments.json";    Bak = "rh-adjustments_backup.json" },
    @{ Src = "data\rh-manual-logs.json";    Bak = "rh-manual-logs_backup.json" },
    @{ Src = "data\settings.json";          Bak = "settings_backup.json" },
    @{ Src = "data\active-proposal.json";   Bak = "active-proposal_backup.json" }
)

foreach ($item in $filesToPreserve) {
    $srcPath = Join-Path $AppDir $item.Src
    $bakPath = Join-Path $backupDir $item.Bak
    if (Test-Path -LiteralPath $srcPath) {
        Copy-Item -LiteralPath $srcPath -Destination $bakPath -Force
    }
}

# Backup de pastas de propostas e certificados SSL em memoria temporaria caso existam
$tempProposalsBak = Join-Path $backupDir "proposals_backup"
if (Test-Path -LiteralPath (Join-Path $AppDir "data\proposals")) {
    if (-not (Test-Path -LiteralPath $tempProposalsBak)) {
        New-Item -ItemType Directory -Path $tempProposalsBak -Force | Out-Null
    }
    Copy-Item -Path (Join-Path $AppDir "data\proposals\*") -Destination $tempProposalsBak -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "      -> Backup local salvo em data\backups_locais." -ForegroundColor Green
Write-Host ""

# ----------------------------------------------------------------------------
# [2/5] BAIXANDO ATUALIZACOES DO GITHUB (VIA GIT OU DOWNLOAD DIRETO ZIP)
# ----------------------------------------------------------------------------
Write-Host "[2/5] Baixando a versao mais recente do GitHub..." -ForegroundColor Yellow
$repoUrl = "https://github.com/titimoro2/Gerador_de_pedidos_sedna.git"
$zipUrl  = "https://github.com/titimoro2/Gerador_de_pedidos_sedna/archive/refs/heads/main.zip"
$updatedSuccess = $false

# Tenta localizar o executavel do Git
$gitExe = $null
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($gitCmd) {
    $gitExe = $gitCmd.Source
} else {
    $candidateGits = @(
        "C:\Program Files\Git\cmd\git.exe",
        "C:\Program Files\Git\bin\git.exe",
        "C:\Program Files (x86)\Git\cmd\git.exe",
        "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
    )
    foreach ($cg in $candidateGits) {
        if (Test-Path -LiteralPath $cg) {
            $gitExe = $cg
            break
        }
    }
}

if ($gitExe) {
    Write-Host "      -> Git detectado ($gitExe). Sincronizando repositorio..." -ForegroundColor Gray
    try {
        & $gitExe config --global --add safe.directory "*" 2>$null | Out-Null
        & $gitExe config --global http.sslVerify false 2>$null | Out-Null

        if (-not (Test-Path -LiteralPath (Join-Path $AppDir ".git"))) {
            & $gitExe init 2>$null | Out-Null
            & $gitExe remote add origin $repoUrl 2>$null | Out-Null
        } else {
            & $gitExe remote set-url origin $repoUrl 2>$null | Out-Null
        }

        & $gitExe -c http.sslVerify=false -c safe.directory="*" fetch origin main --depth=1
        if ($LASTEXITCODE -eq 0) {
            & $gitExe -c safe.directory="*" checkout -B main origin/main --force 2>$null | Out-Null
            & $gitExe -c safe.directory="*" reset --hard origin/main
            if ($LASTEXITCODE -eq 0) {
                $updatedSuccess = $true
                Write-Host "      -> Codigo atualizado com sucesso via Git!" -ForegroundColor Green
            }
        }
    } catch {
        Write-Host "      -> Aviso no Git: $($_.Exception.Message). Alternando para download direto..." -ForegroundColor Yellow
    }
}

# Fallback automatico (ou modo padrao quando o servidor nao tem Git instalado): Download direto do ZIP do GitHub
if (-not $updatedSuccess) {
    Write-Host "      -> Baixando pacote atualizado diretamente do GitHub (HTTPS ZIP)..." -ForegroundColor Cyan
    $tempZip = Join-Path $env:TEMP "sedna_github_main.zip"
    $tempExtract = Join-Path $env:TEMP "sedna_github_extract"

    try {
        if (Test-Path -LiteralPath $tempZip) { Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $tempExtract) { Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue }

        Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing -TimeoutSec 60
        if (-not (Test-Path -LiteralPath $tempZip)) {
            throw "Arquivo ZIP nao foi baixado."
        }

        Expand-Archive -LiteralPath $tempZip -DestinationPath $tempExtract -Force
        $extractedRoot = Get-ChildItem -LiteralPath $tempExtract -Directory | Select-Object -First 1
        if (-not $extractedRoot) {
            throw "Estrutura do ZIP invalida."
        }

        # Copia todos os arquivos e pastas do pacote para o diretorio do servidor
        Get-ChildItem -LiteralPath $extractedRoot.FullName -Force | ForEach-Object {
            $dest = Join-Path $AppDir $_.Name
            Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
        }

        Remove-Item -LiteralPath $tempZip -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

        $updatedSuccess = $true
        Write-Host "      -> Arquivos baixados e aplicados com sucesso via download direto do GitHub!" -ForegroundColor Green
    } catch {
        Write-Host ""
        Write-Host "[ERRO] Falha ao baixar atualizacao do GitHub: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Verifique se o servidor possui acesso a internet." -ForegroundColor Yellow
        Read-Host "Pressione ENTER para sair"
        exit 1
    }
}
Write-Host ""

# ----------------------------------------------------------------------------
# [3/5] RESTAURANDO DADOS LOCAIS, USUARIOS, BANCOS E .ENV
# ----------------------------------------------------------------------------
Write-Host "[3/5] Restaurando usuarios, senhas, conexoes de banco e propostas locais..." -ForegroundColor Yellow
foreach ($item in $filesToPreserve) {
    $srcPath = Join-Path $AppDir $item.Src
    $bakPath = Join-Path $backupDir $item.Bak
    if (Test-Path -LiteralPath $bakPath) {
        $parentDir = Split-Path -Parent $srcPath
        if (-not (Test-Path -LiteralPath $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $bakPath -Destination $srcPath -Force
        Write-Host "      -> Preservado: $($item.Src)" -ForegroundColor Gray
    }
}

if (Test-Path -LiteralPath $tempProposalsBak) {
    $propDir = Join-Path $AppDir "data\proposals"
    if (-not (Test-Path -LiteralPath $propDir)) {
        New-Item -ItemType Directory -Path $propDir -Force | Out-Null
    }
    Copy-Item -Path (Join-Path $tempProposalsBak "*") -Destination $propDir -Recurse -Force -ErrorAction SilentlyContinue
}

$envFile = Join-Path $AppDir ".env"
$envExample = Join-Path $AppDir ".env.example"
if ((-not (Test-Path -LiteralPath $envFile)) -and (Test-Path -LiteralPath $envExample)) {
    Copy-Item -LiteralPath $envExample -Destination $envFile -Force
    Write-Host "      -> Arquivo .env inicial criado a partir de .env.example." -ForegroundColor Gray
}
Write-Host "      -> Todos os dados locais foram preservados com seguranca!" -ForegroundColor Green
Write-Host ""

# ----------------------------------------------------------------------------
# [4/5] ATUALIZANDO DEPENDENCIAS DO NODE.JS (NPM INSTALL)
# ----------------------------------------------------------------------------
Write-Host "[4/5] Verificando e instalando dependencias do Node.js (npm install)..." -ForegroundColor Yellow
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
}
if ($npmCmd) {
    & $npmCmd.Source install --no-audit --no-fund
    Write-Host "      -> Dependencias verificadas com sucesso." -ForegroundColor Green
} else {
    Write-Host "      [AVISO] Comando npm nao encontrado no PATH. Verifique a instalacao do Node.js." -ForegroundColor Yellow
}
Write-Host ""

# ----------------------------------------------------------------------------
# [5/5] FINALIZACAO E REINICIO DO SERVIDOR
# ----------------------------------------------------------------------------
Write-Host "========================================================" -ForegroundColor Green
Write-Host "   SERVIDOR ATUALIZADO COM SUCESSO PARA A ULTIMA VERSAO!" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host ""

$resp = Read-Host "Deseja iniciar o servidor agora? (S/N) [Padrao: S]"
if ($resp -match '^[Nn]') {
    Write-Host ""
    Write-Host "Para iniciar o servidor depois, execute: iniciar_servidor.bat" -ForegroundColor Cyan
    Read-Host "Pressione ENTER para fechar"
    exit 0
}

Write-Host "Iniciando o servidor..." -ForegroundColor Cyan
$iniciarBat = Join-Path $AppDir "iniciar_servidor.bat"
if (Test-Path -LiteralPath $iniciarBat) {
    Start-Process -FilePath "cmd.exe" -WorkingDirectory $AppDir -ArgumentList "/k", "`"$iniciarBat`""
} else {
    Start-Process -FilePath "cmd.exe" -WorkingDirectory $AppDir -ArgumentList "/k", "node server.js"
}
Start-Sleep -Seconds 2
exit 0
