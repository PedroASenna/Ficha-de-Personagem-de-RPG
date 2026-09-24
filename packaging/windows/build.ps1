# Gera o instalador do servidor RPG Play para Windows: RPG-Play-Servidor-Setup-<versão>.exe
#
#   powershell -ExecutionPolicy Bypass -File packaging\windows\build.ps1 [-SkipWeb]
#
# Precisa de Python 3.12, Node 22 e NSIS (makensis; se faltar, instala pelo Chocolatey).
# Saída em dist\ na raiz do repositório (ou em $env:OUT).
param([switch]$SkipWeb)

$ErrorActionPreference = "Stop"
$Here = $PSScriptRoot
$Root = (Resolve-Path "$Here\..\..").Path
$Version = (Select-String -Path "$Root\backend\pyproject.toml" -Pattern '^version = "(.*)"').Matches[0].Groups[1].Value
$Build = "$Here\build"
$Out = if ($env:OUT) { $env:OUT } else { "$Root\dist" }

function Invoke-Checked([string]$What, [scriptblock]$Block) {
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$What falhou (código $LASTEXITCODE)" }
}

Write-Host "==> RPG Play servidor $Version para Windows"

if (-not $SkipWeb) {
  Write-Host "==> Painel do Mestre (web\)"
  Push-Location "$Root\web"
  Invoke-Checked "npm ci" { npm ci --no-audit --no-fund }
  Invoke-Checked "build do painel" { npm run build }
  Pop-Location
}
if (-not (Test-Path "$Root\web\dist\index.html")) { throw "web\dist não existe" }

Write-Host "==> Ambiente de build"
if (Test-Path $Build) { Remove-Item -Recurse -Force $Build }
Invoke-Checked "venv" { python -m venv "$Build\venv" }
$Py = "$Build\venv\Scripts\python.exe"
Invoke-Checked "pip" { & $Py -m pip install --quiet --upgrade pip }
Invoke-Checked "dependências" { & $Py -m pip install --quiet "$Root\backend[package]" }

Write-Host "==> PyInstaller"
Invoke-Checked "PyInstaller" {
  & $Py -m PyInstaller --noconfirm --clean --log-level WARN `
    --distpath "$Build\pyi-dist" --workpath "$Build\pyi-work" "$Root\packaging\server\rpgplay-server.spec"
}
$Bin = "$Build\pyi-dist\rpgplay-server"

Write-Host "==> Conferindo o executável"
$Check = Join-Path ([System.IO.Path]::GetTempPath()) ("rpgplay-check-" + [guid]::NewGuid())
$env:RPG_DATA_DIR = $Check
Invoke-Checked "rpgplay-server info" { & "$Bin\rpgplay-server.exe" info }
Invoke-Checked "rpgplay-server purge" { & "$Bin\rpgplay-server.exe" purge }
Remove-Item Env:\RPG_DATA_DIR
Remove-Item -Recurse -Force $Check

Write-Host "==> Instalador (NSIS)"
$MakeNsis = (Get-Command makensis -ErrorAction SilentlyContinue).Source
if (-not $MakeNsis) { $MakeNsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe" }
if (-not (Test-Path $MakeNsis)) {
  Invoke-Checked "instalar o NSIS" { choco install nsis -y --no-progress }
  $MakeNsis = "${env:ProgramFiles(x86)}\NSIS\makensis.exe"
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Setup = "$Out\RPG-Play-Servidor-Setup-$Version.exe"
Push-Location $Here
Invoke-Checked "makensis" { & $MakeNsis /V2 /INPUTCHARSET UTF8 "/DVERSION=$Version" "/DSRC=$Bin" "/DOUTFILE=$Setup" installer.nsi }
Pop-Location
Write-Host ("==> $Setup ({0:N0} MB)" -f ((Get-Item $Setup).Length / 1MB))
