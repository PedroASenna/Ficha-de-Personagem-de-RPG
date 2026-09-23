// Tela de escolha do servidor (roda isolada; fala com o programa só pela ponte window.rpgplay).
"use strict";

const api = window.rpgplay;
const params = new URLSearchParams(window.location.search);
const list = document.getElementById("servidores");
const statusLine = document.getElementById("status");
const errorBox = document.getElementById("erro");
const searchButton = document.getElementById("procurar");
const form = document.getElementById("manual");
const addressInput = document.getElementById("endereco");

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

async function connect(url, button) {
  showError("");
  if (button) button.disabled = true;
  statusLine.textContent = `Abrindo ${url}…`;
  const result = await api.connect(url);
  if (result && result.error) {
    showError(result.error);
    statusLine.textContent = "";
    if (button) button.disabled = false;
  }
}

function render(servers, lastServerId) {
  list.replaceChildren();
  for (const server of servers) {
    const item = document.createElement("li");
    const info = document.createElement("div");
    info.className = "info";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = server.name;
    if (server.serverId === lastServerId) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "último usado";
      name.append(badge);
    }
    const url = document.createElement("div");
    url.className = "url";
    url.textContent = `${server.url} · v${server.version}`;
    info.append(name, url);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Abrir mesa";
    button.addEventListener("click", () => void connect(server.url, button));
    item.append(info, button);
    list.append(item);
  }
}

async function search() {
  searchButton.disabled = true;
  statusLine.textContent = "Procurando servidores na rede…";
  list.replaceChildren();
  const last = await api.lastServer();
  const servers = await api.discover();
  searchButton.disabled = false;
  render(servers, last && last.serverId);
  statusLine.textContent =
    servers.length === 0
      ? "Nenhum servidor encontrado. Confira se ele está ligado e na mesma rede, ou digite o endereço abaixo."
      : servers.length === 1
        ? "1 servidor encontrado."
        : `${servers.length} servidores encontrados.`;
  return { servers, last };
}

async function start() {
  if (params.get("erro")) showError(params.get("erro"));
  const autoConnect = !params.get("erro") && !params.get("trocar");
  // Abre direto o último servidor usado, se ele estiver respondendo.
  const last = await api.lastServer();
  if (autoConnect && last) {
    statusLine.textContent = `Conectando em ${last.name}…`;
    const alive = await api.probe(last.url);
    if (alive && !alive.error) {
      await connect(last.url);
      return;
    }
  }
  const { servers } = await search();
  if (autoConnect && !last && servers.length === 1) await connect(servers[0].url);
}

searchButton.addEventListener("click", () => void search());
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const result = await api.probe(addressInput.value);
  if (result.error) showError(result.error);
  else await connect(result.url);
});

void start();
