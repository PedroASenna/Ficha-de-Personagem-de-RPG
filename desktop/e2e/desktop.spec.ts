import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

test("acha o servidor sozinho, abre a mesa, isola o painel e troca de servidor", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "rpgplay-mestre-"));
  // RPGPLAY_MESTRE_BIN testa o programa instalado (ex.: /opt/RPG Play Mestre/rpgplay-mestre); sem ele, o código daqui.
  const installed = process.env.RPGPLAY_MESTRE_BIN;
  const app = await electron.launch({
    ...(installed
      ? { executablePath: installed, args: ["--no-sandbox"] }
      : { args: [path.join(__dirname, ".."), "--no-sandbox"] }),
    env: { ...process.env, RPGPLAY_DISCOVERY_PORT: "47795", RPGPLAY_USER_DATA_DIR: userData },
  });
  try {
    const page = await app.firstWindow();

    // Primeira vez: acha o único servidor da rede pelo broadcast e já abre o painel do Mestre.
    await expect(page.getByText("Painel do Mestre · Mesa Desktop E2E")).toBeVisible();
    expect(page.url()).toMatch(/^http:\/\/[\d.]+:8095\/mestre\/$/);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe(
      "RPG Play Mestre · Mesa Desktop E2E",
    );

    // O site do servidor não enxerga a ponte do programa nem consegue sair da origem dele.
    expect(await page.evaluate(() => typeof (window as unknown as { rpgplay?: unknown }).rpgplay)).toBe("undefined");
    await page.evaluate(() => {
      window.location.href = "file:///etc/passwd";
    });
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/:8095\/mestre\/$/);

    const saved = JSON.parse(fs.readFileSync(path.join(userData, "rpgplay-mestre.json"), "utf8"));
    expect(saved.lastServer.name).toBe("Mesa Desktop E2E");

    // Menu Mesa → Trocar servidor: volta para a lista, marcando o último usado, sem reconectar sozinho.
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("trocar-servidor")?.click());
    await expect(page.getByRole("heading", { name: "Servidores encontrados" })).toBeVisible();
    await expect(page.getByText("último usado")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir mesa" })).toBeVisible();
    expect(await page.evaluate(() => typeof (window as unknown as { rpgplay?: unknown }).rpgplay)).toBe("object");

    // Endereço digitado à mão (roteador que bloqueia broadcast).
    await page.getByLabel("Endereço do servidor").fill("não é endereço");
    await page.getByRole("button", { name: "Conectar" }).click();
    await expect(page.getByRole("alert")).toContainText("Endereço inválido");
    await page.getByLabel("Endereço do servidor").fill("127.0.0.1:8095");
    await page.getByRole("button", { name: "Conectar" }).click();
    await expect(page.getByText("Painel do Mestre · Mesa Desktop E2E")).toBeVisible();
    expect(page.url()).toBe("http://127.0.0.1:8095/mestre/");
  } finally {
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
