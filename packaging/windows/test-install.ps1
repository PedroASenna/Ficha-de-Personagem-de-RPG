# Teste do instalador num Windows de verdade (runner do GitHub Actions, que roda como administrador):
# instala em silêncio, confere atalhos, firewall e pasta de dados, sobe o servidor instalado, testa HTTP,
# painel e descoberta UDP, o diagnóstico e o liberar-firewall, e desinstala mantendo as campanhas.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8  # o servidor escreve em UTF-8 (acentos, ✔ e ✘)
$env:RPG_NO_PAUSE = "1"
$Root = (Resolve-Path "$PSScriptRoot\..\..").Path
$Setup = Get-ChildItem "$Root\dist\RPG-Play-Servidor-Setup-*.exe" | Select-Object -First 1
if (-not $Setup) { throw "Instalador não encontrado em dist\" }
$Install = "$env:ProgramFiles\RPG Play Servidor"
$Exe = "$Install\rpgplay-server.exe"
$Data = "$env:ProgramData\RPG Play\servidor"
$Menu = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\RPG Play Servidor"
$Rule = "RPG Play Servidor"

function Assert([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "FALHOU: $Message" }
  Write-Host "  ok: $Message"
}

function Test-Rule {
  netsh advfirewall firewall show rule name="$Rule" | Out-Null
  return $LASTEXITCODE -eq 0
}

Write-Host "==> Instalando $($Setup.Name) em silêncio"
Start-Process $Setup.FullName -ArgumentList "/S" -Wait
Assert (Test-Path $Exe) "executável instalado"
Assert (Test-Path "$Data\servidor.env") "servidor.env na pasta das campanhas"
Assert (Test-Path "$Menu\RPG Play Servidor.lnk") "atalho no menu Iniciar"
Assert (Test-Path "$Menu\Liberar no firewall.lnk") "atalho do firewall"
Assert (Test-Path "$Menu\Link fixo pela internet (Tailscale).lnk") "atalho do link fixo"
Assert (Test-Path "$Menu\Jogar pela internet (link e código).lnk") "atalho de jogar pela internet"
Assert (Test-Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp\RPG Play Servidor.lnk") "abre junto com o Windows"
Assert (Test-Rule) "regra no Firewall do Windows"
$RuleText = (netsh advfirewall firewall show rule name="$Rule" verbose) -join "`n"
Assert ($RuleText -match "LocalSubnet") "regra só para a rede local"

Write-Host "==> Servidor instalado (dados em ProgramData)"
Add-Content "$Data\servidor.env" "RPG_SERVER_NAME=Mesa do CI"
$Log = "$env:RUNNER_TEMP\rpgplay-out.txt"
$Err = "$env:RUNNER_TEMP\rpgplay-err.txt"
$Server = Start-Process $Exe -ArgumentList "serve" -PassThru -RedirectStandardOutput $Log -RedirectStandardError $Err
try {
  $up = $false
  for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-RestMethod "http://127.0.0.1:8080/health" | Out-Null; $up = $true; break } catch { Start-Sleep 1 }
  }
  if (-not $up) { Get-Content $Log, $Err | Write-Host; throw "o servidor não subiu" }
  $info = Invoke-RestMethod "http://127.0.0.1:8080/api/v1/discovery"
  Assert ($info.app -eq "rpgplay") "descoberta HTTP"
  Assert ($info.name -eq "Mesa do CI") "configuração lida do servidor.env"
  $panel = Invoke-WebRequest "http://127.0.0.1:8080/mestre/" -UseBasicParsing
  Assert ($panel.Content -match '<div id="root">') "painel do Mestre"
  Assert (Test-Path "$Data\rpgplay.db") "banco na pasta das campanhas"

  $register = @{ username = "mestre_ci"; password = "senha-do-ci"; display_name = "Mestre" } | ConvertTo-Json
  $tokens = Invoke-RestMethod "http://127.0.0.1:8080/api/v1/auth/register" -Method Post -ContentType "application/json" -Body $register
  Assert ([bool]$tokens.access_token) "conta criada"

  $udp = New-Object System.Net.Sockets.UdpClient
  $udp.Client.ReceiveTimeout = 5000
  $bytes = [Text.Encoding]::ASCII.GetBytes("RPGPLAY_DISCOVER")
  [void]$udp.Send($bytes, $bytes.Length, "127.0.0.1", 47777)
  $from = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
  $reply = [Text.Encoding]::UTF8.GetString($udp.Receive([ref]$from)) | ConvertFrom-Json
  $udp.Close()
  Assert ($reply.app -eq "rpgplay") "descoberta UDP"

  # Porta de internet (127.0.0.1:8081): o que chega por ela é "de fora" e o cadastro pede o código de acesso.
  $remote = Invoke-RestMethod "http://127.0.0.1:8081/api/v1/discovery"
  Assert ($remote.access_code_required -eq $true -and $remote.addresses.Count -eq 0) "porta de internet"
  $outside = @{ username = "de_fora"; password = "senha-de-fora"; display_name = "De Fora" } | ConvertTo-Json
  try {
    Invoke-RestMethod "http://127.0.0.1:8081/api/v1/auth/register" -Method Post -ContentType "application/json" -Body $outside | Out-Null
    $outsideStatus = 201
  } catch { $outsideStatus = $_.Exception.Response.StatusCode.value__ }
  Assert ($outsideStatus -eq 403) "cadastro de fora recusado com a internet desligada"
  $internet = (& $Exe internet) -join "`n"
  Write-Host $internet
  Assert ($internet -match "Jogar pela internet: desligado") "comando internet"

  # Link rápido de verdade (baixa o cloudflared.exe e abre o túnel). Serviço externo: se falhar, só avisa.
  $auth = @{ Authorization = "Bearer $($tokens.access_token)" }
  try {
    Invoke-RestMethod "http://127.0.0.1:8080/api/v1/remote" -Method Put -Headers $auth -ContentType "application/json" -Body '{"mode":"quick"}' | Out-Null
    $view = $null
    for ($i = 0; $i -lt 90; $i++) {
      $view = Invoke-RestMethod "http://127.0.0.1:8080/api/v1/remote" -Headers $auth
      if ($view.status -eq "on") { break }
      Start-Sleep 2
    }
    Write-Host "  link rápido: $($view.status) $($view.url) $($view.error)"
    $found = $null
    if ($view.status -eq "on") {
      for ($i = 0; $i -lt 30 -and -not $found; $i++) {
        try { $found = Invoke-RestMethod "$($view.url)/api/v1/discovery" } catch { Start-Sleep 2 }
      }
    }
    if ($found.access_code_required) { Write-Host "  ok: link rápido da Cloudflare no Windows" }
    else { Write-Warning "O link rápido da Cloudflare não respondeu (serviço externo)." }
  } catch { Write-Warning "Link rápido: $_" }
  finally {
    Invoke-RestMethod "http://127.0.0.1:8080/api/v1/remote" -Method Put -Headers $auth -ContentType "application/json" -Body '{"mode":"off"}' | Out-Null
  }

  $diag = (& $Exe diagnostico) -join "`n"
  Write-Host $diag
  Assert ($diag -match "Firewall do Windows: regra") "diagnóstico vê a regra do firewall"
  Assert ($diag -match "Servidor respondendo") "diagnóstico vê o servidor"

  # Segundo clique no atalho: avisa que a porta está em uso em vez de travar.
  $ErrorActionPreference = "Continue"
  $second = (& $Exe serve 2>&1 | ForEach-Object { "$_" }) -join "`n"
  $secondCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  Write-Host $second
  Assert ($secondCode -eq 1 -and $second -match "em uso") "segunda janela avisa que já está aberto"
}
finally {
  Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep 1
  Get-Content $Log -ErrorAction SilentlyContinue | Select-Object -First 20 | Write-Host
}

Write-Host "==> Desinstalando (silencioso: as campanhas ficam)"
Start-Process "$Install\Desinstalar.exe" -ArgumentList "/S", "_?=$Install" -Wait
Assert (-not (Test-Path $Exe)) "executável removido"
Assert (-not (Test-Rule)) "regra do firewall removida"
Assert (-not (Test-Path $Menu)) "atalhos removidos"
Assert (Test-Path "$Data\rpgplay.db") "campanhas mantidas"

Write-Host "==> liberar-firewall pelo executável (sem o instalador)"
$Portable = "$Root\packaging\windows\build\pyi-dist\rpgplay-server\rpgplay-server.exe"
$env:RPG_DATA_DIR = "$env:RUNNER_TEMP\rpgplay-portable"
$diag = (& $Portable diagnostico) -join "`n"
Assert ($diag -match "falta a regra") "diagnóstico acusa a falta da regra"
& $Portable liberar-firewall
Assert ($LASTEXITCODE -eq 0 -and (Test-Rule)) "liberar-firewall cria a regra"
netsh advfirewall firewall delete rule name="$Rule" | Out-Null
Write-Host "Tudo certo."
