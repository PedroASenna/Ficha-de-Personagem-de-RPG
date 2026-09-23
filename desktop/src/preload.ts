// Ponte mínima entre a tela de escolha do servidor (arquivo local) e o processo principal.
// A página do servidor (/mestre) não recebe nada disto: ela roda como um site comum.
import { contextBridge, ipcRenderer } from "electron";

if (window.location.protocol === "file:") {
  contextBridge.exposeInMainWorld("rpgplay", {
    discover: () => ipcRenderer.invoke("rpgplay:discover"),
    probe: (address: string) => ipcRenderer.invoke("rpgplay:probe", address),
    connect: (url: string) => ipcRenderer.invoke("rpgplay:connect", url),
    lastServer: () => ipcRenderer.invoke("rpgplay:last-server"),
  });
}
