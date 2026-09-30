import { describe, expect, it } from "vitest";

import { fileUrlPath, isLauncherUrl } from "./launcher-path";

const WINDOWS = "C:\\Program Files\\RPG Play Mestre\\resources\\app.asar\\launcher\\index.html";
const LINUX = "/opt/RPG Play Mestre/resources/app.asar/launcher/index.html";

describe("tela local de escolha do servidor", () => {
  it("reconhece o launcher no Windows (espaços, parâmetros e letra do disco)", () => {
    const url = "file:///C:/Program%20Files/RPG%20Play%20Mestre/resources/app.asar/launcher/index.html";
    expect(fileUrlPath(new URL(url), "win32")).toBe(WINDOWS);
    expect(isLauncherUrl(url, WINDOWS, "win32")).toBe(true);
    expect(isLauncherUrl(`${url}?trocar=1`, WINDOWS, "win32")).toBe(true);
    expect(isLauncherUrl(url.replace("C:", "c:"), WINDOWS, "win32")).toBe(true);
    expect(isLauncherUrl("file:///C:/Windows/System32/drivers/etc/hosts", WINDOWS, "win32")).toBe(false);
  });

  it("reconhece o launcher no Linux", () => {
    const url = "file:///opt/RPG%20Play%20Mestre/resources/app.asar/launcher/index.html?erro=x";
    expect(isLauncherUrl(url, LINUX, "linux")).toBe(true);
    expect(isLauncherUrl("file:///etc/passwd", LINUX, "linux")).toBe(false);
  });

  it("nunca aceita páginas de fora", () => {
    expect(isLauncherUrl("http://192.168.0.20:8080/mestre/", WINDOWS, "win32")).toBe(false);
    expect(isLauncherUrl("http://192.168.0.20:8080/mestre/", LINUX, "linux")).toBe(false);
    expect(isLauncherUrl("isso não é url", LINUX, "linux")).toBe(false);
  });
});
