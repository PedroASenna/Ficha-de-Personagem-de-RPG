import { expect, type Page, test } from "@playwright/test";

// GURPS e Savage Worlds pelo painel: a ficha do jogador chega calculada pelo servidor, o Mestre rola um teste
// com um clique (NH do GURPS; dado + Dado Selvagem do Savage) e dá pontos/XP.

type Message = { type: string; [key: string]: unknown };

async function call<T>(baseURL: string, path: string, body: unknown, token?: string, method = "POST"): Promise<T> {
  const response = await fetch(`${baseURL}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function account(baseURL: string, name: string, password: string): Promise<{ username: string; token: string }> {
  const username = `${name.toLowerCase()}_${Date.now() % 1000000}`;
  const tokens = await call<{ access_token: string }>(baseURL, "/auth/register", {
    username,
    password,
    display_name: name,
  });
  return { username, token: tokens.access_token };
}

/** Jogador conectado pelo WebSocket (como o app), guardando tudo que chega. */
async function listen(baseURL: string, pin: string, token: string) {
  const messages: Message[] = [];
  const socket = new WebSocket(`${baseURL.replace(/^http/, "ws")}/ws/rooms/${pin}`);
  socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token })));
  socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data)) as Message));
  const waitFor = async (predicate: (m: Message) => boolean) => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Não chegou. Recebidas: ${messages.map((m) => m.type).join(", ")}`);
  };
  await waitFor((m) => m.type === "welcome");
  return { waitFor, close: () => socket.close() };
}

async function masterOpensRoom(page: Page, baseURL: string, system: string, roomName: string): Promise<string> {
  const password = "senha-do-mestre";
  const master = await account(baseURL, "Mestra", password);
  await page.goto("/mestre/");
  await page.getByLabel("Usuário").fill(master.username);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.getByRole("button", { name: "Nova mesa" }).click();
  await page.getByLabel("Nome da campanha").fill(roomName);
  await page.getByLabel("Sistema de regras").click();
  await page.getByRole("option", { name: system }).click();
  await page.getByRole("button", { name: "Criar e abrir" }).click();
  await expect(page.getByTestId("ws-status")).toHaveText("Ao vivo");
  return ((await page.getByText(/^PIN [A-Z0-9]{6}$/).textContent()) ?? "").replace("PIN ", "");
}

test("GURPS: o Mestre rola a perícia contra o NH e dá pontos de personagem", async ({ page, baseURL }) => {
  const base = baseURL as string;
  const pin = await masterOpensRoom(page, base, "GURPS 4ª Edição", "Mundos Infinitos");

  const player = await account(base, "Dai", "senha-do-dai");
  const draft = await call<{ id: string }>(base, "/characters", { ruleset_id: "gurps-4e", name: "Dai" }, player.token);
  const build = {
    attributes: { st: 8, dx: 15, iq: 12, ht: 12 },
    skills: [{ key: "espadas-curtas", points: 8 }],
  };
  await call(base, `/characters/${draft.id}`, { build }, player.token, "PATCH");
  await call(base, `/characters/${draft.id}/finalize`, {}, player.token);
  await call(base, "/rooms/join", { pin, character_id: draft.id }, player.token);
  const app = await listen(base, pin, player.token);

  await page.getByRole("tab", { name: /Grupo/ }).click();
  await page.getByText("Dai", { exact: true }).first().click();
  const detail = page.getByTestId("detail-panel");
  await expect(detail).toContainText("Espadas Curtas");
  // Velocidade Básica (12 + 15) / 4 = 6,75 → Esquiva 6 + 3 = 9.
  await expect(detail).toContainText("Esquiva 9");

  // DX 15 + Média (-1) + 8 pontos (+3) = NH 17.
  await detail.getByRole("button", { name: /Espadas Curtas 17/ }).click();
  const roll = await app.waitFor((m) => m.type === "roll.result");
  expect(roll.check).toEqual(expect.objectContaining({ kind: "gurps", target: 17 }));
  await expect(page.getByTestId("session-log")).toContainText("Dai rolou 3d6 (Espadas Curtas)");
  await expect(page.getByTestId("session-log")).toContainText("contra 17");
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "e2e-screenshots/gurps-painel.png" });

  await detail.getByRole("button", { name: "Pontos" }).click();
  await page.getByRole("button", { name: "Dar 5 pontos" }).click();
  const leveled = await app.waitFor((m) => m.type === "character.leveled");
  expect(leveled.level_label).toBe("155 pontos");
  await expect(detail).toContainText("155 pontos");
  app.close();
});

test("Savage Worlds: teste com Dado Selvagem e XP do Mestre", async ({ page, baseURL }) => {
  const base = baseURL as string;
  const pin = await masterOpensRoom(page, base, "Savage Worlds (Edição Brasileira)", "Terras Selvagens");

  const player = await account(base, "Kara", "senha-da-kara");
  const quick = await call<{ id: string }>(
    base,
    "/characters/quick",
    { ruleset_id: "savage-worlds", name: "Kara" },
    player.token,
  );
  await call(base, "/rooms/join", { pin, character_id: quick.id }, player.token);
  const app = await listen(base, pin, player.token);

  await page.getByRole("tab", { name: /Grupo/ }).click();
  await page.getByText("Kara", { exact: true }).first().click();
  const detail = page.getByTestId("detail-panel");
  await expect(detail).toContainText("Aparar");
  await expect(detail).toContainText("Novato");
  await detail.getByRole("button", { name: /Lutar d6/ }).click();
  const roll = await app.waitFor((m) => m.type === "roll.result");
  expect(roll.check).toEqual(expect.objectContaining({ kind: "savage", target: 4, wild: true }));
  const terms = (roll.roll as { terms: { wild?: boolean }[] }).terms;
  expect(terms.map((t) => Boolean(t.wild))).toEqual([false, true]);
  await expect(page.getByTestId("session-log")).toContainText("Kara rolou 1d6! + selvagem 1d6! (Lutar)");
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "e2e-screenshots/savage-painel.png" });

  await detail.getByRole("button", { name: "XP" }).click();
  await page.getByRole("button", { name: "+3" }).click();
  await page.getByRole("button", { name: "Dar 3 XP" }).click();
  const leveled = await app.waitFor((m) => m.type === "character.leveled");
  expect(leveled.summary).toBe("Kara ganhou 3 XP (Novato)");
  app.close();
});
