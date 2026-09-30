"""Página /entrar: o convite que o Mestre manda no grupo (WhatsApp, Discord...) para quem joga de longe.

Link https é clicável em qualquer mensageiro, ao contrário do rpgplay://. A página monta o link do app com o
endereço pelo qual foi aberta (o do túnel) e com o PIN e o código da URL, tudo no navegador (textContent,
sem HTML vindo da URL).
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

RELEASES = "https://github.com/PedroASenna/Ficha-de-Personagem-de-RPG/releases/latest"

router = APIRouter()

PAGE = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Entrar na mesa · RPG Play</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #14100d; color: #f3e3bf; font: 16px/1.5 system-ui, -apple-system, "Segoe UI",
         Roboto, sans-serif; }
  main { max-width: 480px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; font-size: 28px; margin: 0 0 8px; }
  .open { display: block; text-align: center; background: #d4a64a; color: #1b140c; font-weight: 700;
          padding: 16px; border-radius: 10px; text-decoration: none; font-size: 18px; margin: 24px 0; }
  .card { background: #1f1915; border: 1px solid rgba(212, 166, 74, .16); border-radius: 10px; padding: 16px; }
  .value { font-family: ui-monospace, monospace; font-size: 20px; letter-spacing: 2px; color: #d4a64a;
           overflow-wrap: anywhere; }
  ol { padding-left: 20px; } li { margin: 8px 0; } a { color: #d4a64a; }
  .muted { color: #b9a988; font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>Mesa de RPG pela internet</h1>
  <p class="muted">Você foi convidado para uma mesa no RPG Play.</p>
  <a class="open" id="open" href="#">Abrir no app RPG Play</a>
  <div class="card">
    <p><b>Se o app não abrir:</b></p>
    <ol>
      <li>Instale o app RPG Play (arquivo <b>.apk</b> em <a href="__RELEASES__">Releases</a>).</li>
      <li>No app, em <b>“Ou digite o endereço”</b>, use:<br><span class="value" id="server"></span></li>
      <li>Crie sua conta e, se quiser, o personagem.</li>
      <li id="code-step">Ao criar a conta, informe o código de acesso:<br><span class="value" id="code"></span></li>
      <li id="pin-step">Em <b>Mesas</b>, entre com o PIN:<br><span class="value" id="pin"></span></li>
    </ol>
    <p class="muted">Na mesa, o Mestre aceita sua entrada.</p>
  </div>
</main>
<script>
  const params = new URLSearchParams(location.search);
  const clean = (value, size) => (value || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, size);
  const pin = clean(params.get("pin"), 6);
  const code = clean(params.get("code"), 9);
  const server = location.origin;
  let link = "rpgplay://join?server=" + encodeURIComponent(server);
  if (pin) link += "&pin=" + encodeURIComponent(pin);
  if (code) link += "&code=" + encodeURIComponent(code);
  document.getElementById("open").href = link;
  document.getElementById("server").textContent = server;
  document.getElementById("code").textContent = code;
  document.getElementById("pin").textContent = pin;
  if (!code) document.getElementById("code-step").hidden = true;
  if (!pin) document.getElementById("pin-step").hidden = true;
</script>
</body>
</html>
""".replace("__RELEASES__", RELEASES)


@router.get("/entrar", include_in_schema=False)
async def invite() -> HTMLResponse:
    return HTMLResponse(PAGE, headers={"Cache-Control": "no-cache"})
