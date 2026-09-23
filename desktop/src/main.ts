// RPG Play Mestre: janela que encontra o servidor da casa e abre o painel do Mestre (http://servidor:8080/mestre).
// O painel vem do próprio servidor, então o programa sempre bate com a versão instalada nele.

import path from "node:path";

import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  session,
  shell,
} from "electron";

import { ConfigStore } from "./config";
import { DEFAULT_DISCOVERY_PORT, discover, normalizeServerUrl, probe, type ServerInfo } from "./discovery";

const LAUNCHER = path.join(__dirname, "..", "launcher", "index.html");
const ICON = path.join(__dirname, "..", "launcher", "icon.png");
const DISCOVERY_PORT = Number(process.env.RPGPLAY_DISCOVERY_PORT ?? DEFAULT_DISCOVERY_PORT);

let mainWindow: BrowserWindow | null = null;
let currentOrigin: string | null = null;
let config: ConfigStore;

function isLauncher(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "file:" && path.normalize(decodeURIComponent(parsed.pathname)) === path.normalize(LAUNCHER)
    );
  } catch {
    return false;
  }
}

function isAllowed(url: string): boolean {
  if (isLauncher(url)) return true;
  try {
    return currentOrigin !== null && new URL(url).origin === currentOrigin;
  } catch {
    return false;
  }
}

/** Só a tela local de escolha do servidor pode chamar o processo principal. */
function assertLauncher(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isLauncher(event.senderFrame.url)) throw new Error("Acesso negado.");
}

async function showLauncher(query: Record<string, string> = {}): Promise<void> {
  currentOrigin = null;
  mainWindow?.setTitle("RPG Play Mestre");
  await mainWindow?.loadFile(LAUNCHER, { query });
}

async function openServer(info: ServerInfo): Promise<void> {
  currentOrigin = new URL(info.url).origin;
  config.save({ ...config.load(), lastServer: info });
  mainWindow?.setTitle(`RPG Play Mestre · ${info.name}`);
  await mainWindow?.loadURL(`${currentOrigin}/mestre/`);
}

function registerIpc(): void {
  ipcMain.handle("rpgplay:discover", async (event) => {
    assertLauncher(event);
    return discover({ discoveryPort: DISCOVERY_PORT });
  });
  ipcMain.handle("rpgplay:probe", async (event, address: unknown) => {
    assertLauncher(event);
    const origin = typeof address === "string" ? normalizeServerUrl(address) : null;
    if (!origin) return { error: "Endereço inválido. Exemplo: 192.168.0.20 ou 192.168.0.20:8080" };
    return (await probe(origin, 2500)) ?? { error: `Nenhum servidor RPG Play respondeu em ${origin}.` };
  });
  ipcMain.handle("rpgplay:connect", async (event, url: unknown) => {
    assertLauncher(event);
    const origin = typeof url === "string" ? normalizeServerUrl(url) : null;
    const info = origin ? await probe(origin, 2500) : null;
    if (!info) return { error: "O servidor não respondeu. Ele está ligado e na mesma rede?" };
    // Carrega depois de responder ao launcher (a página dele vai ser trocada).
    setImmediate(() => void openServer(info));
    return { ok: true };
  });
  ipcMain.handle("rpgplay:last-server", (event) => {
    assertLauncher(event);
    return config.load().lastServer ?? null;
  });
}

function buildMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Mesa",
      submenu: [
        {
          id: "trocar-servidor",
          label: "Trocar servidor…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => void showLauncher({ trocar: "1" }),
        },
        { role: "reload", label: "Recarregar" },
        { type: "separator" },
        { role: "quit", label: "Sair" },
      ],
    },
    {
      label: "Exibir",
      submenu: [
        { role: "zoomIn", label: "Aumentar" },
        { role: "zoomOut", label: "Diminuir" },
        { role: "resetZoom", label: "Tamanho normal" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Tela cheia" },
        { role: "toggleDevTools", label: "Ferramentas de desenvolvedor" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function hardenSecurity(): void {
  // O painel não precisa de câmera, microfone, localização, notificações...
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      if (isAllowed(url)) return;
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && !isAllowed(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#14100d",
    title: "RPG Play Mestre",
    icon: ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // Mantém "RPG Play Mestre · <nome do servidor>" em vez do título da página.
  mainWindow.on("page-title-updated", (event) => {
    if (currentOrigin) event.preventDefault();
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || isLauncher(url) || code === -3 /* ABORTED */) return;
    void showLauncher({ erro: `Não consegui abrir ${url} (${description}).` });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void showLauncher();
}

// Pasta de dados separada (testes automatizados ou um segundo perfil do Mestre).
if (process.env.RPGPLAY_USER_DATA_DIR) app.setPath("userData", process.env.RPGPLAY_USER_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  void app.whenReady().then(() => {
    config = new ConfigStore(app.getPath("userData"));
    hardenSecurity();
    registerIpc();
    buildMenu();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
