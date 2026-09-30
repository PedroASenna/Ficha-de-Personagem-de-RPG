import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

// Jogar pela internet: o admin liga o link rápido (cloudflared falso), quem vem de fora cria conta com o
// código de acesso e espera o Mestre aceitar a entrada na mesa. "De fora" = pela porta de internet (porta + 1).

const serverBin = process.env.RPG_SERVER_BIN ?? "../backend/.venv/bin/rpgplay-server";

async function call(base: string, path: string, body?: unknown, token?: string, method = "POST") {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function internetBase(base: string): string {
  const url = new URL(base);
  url.port = String(Number(url.port) + 1);
  return url.origin;
}

let adminToken = "";

test.afterAll(async ({ baseURL }) => {
  // Desliga de novo: com a internet ligada as mesas novas dos outros testes pediriam aprovação.
  if (adminToken) await call(baseURL as string, "/remote", { mode: "off", require_code: false }, adminToken, "PUT");
});

test("pela internet: código de acesso e o Mestre aceita quem entra", async ({ page, baseURL }) => {
  const base = baseURL as string;
  const remote = internetBase(base);
  const password = "senha-do-mestre";
  const username = `dona_${Date.now() % 1000000}`;
  const created = await call(base, "/auth/register", { username, password, display_name: "Dona" });
  expect(created.status).toBe(201);
  // O primeiro cadastro do servidor vira admin; os outros testes podem ter rodado antes.
  execFileSync(serverBin, ["make-admin", username], { env: { ...process.env, RPG_DATA_DIR: ".e2e-data" } });

  await page.goto("/mestre/");
  await page.getByLabel("Usuário").fill(username);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  adminToken = (await call(base, "/auth/login", { username, password })).body.access_token as string;

  // Liga o link rápido. Por padrão criar conta é livre: o código de acesso fica escondido.
  await page.getByRole("button", { name: "Internet" }).click();
  await page.getByRole("radio", { name: /Link rápido/ }).click();
  await expect(page.getByTestId("remote-status")).toHaveText("No ar");
  await expect(page.getByTestId("remote-url")).toHaveText("https://e2e-mesa.trycloudflare.com");
  await expect(page.getByRole("switch", { name: /Pedir código de acesso/ })).not.toBeChecked();
  await expect(page.getByTestId("access-code")).toBeHidden();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "e2e-screenshots/internet-ligada.png" });
  await page.getByRole("button", { name: "Fechar" }).click();

  // Mesa nova já pede aprovação.
  await page.getByRole("button", { name: "Nova mesa" }).click();
  await page.getByLabel("Nome da campanha").fill("Mesa de Longe");
  await page.getByRole("button", { name: "Criar e abrir" }).click();
  await expect(page.getByTestId("ws-status")).toHaveText("Ao vivo");
  const pin = ((await page.getByText(/^PIN [A-Z0-9]{6}$/).textContent()) ?? "").replace("PIN ", "");

  await page.getByRole("button", { name: "Conectar celulares" }).click();
  await page.getByRole("tab", { name: "Pela internet" }).click();
  await expect(page.getByTestId("internet-url")).toHaveText("https://e2e-mesa.trycloudflare.com");
  await expect(page.getByTestId("internet-pin")).toHaveText(pin);
  await expect(page.getByTestId("internet-code")).toBeHidden();
  await expect(page.getByRole("switch", { name: /Aprovar entrada/ })).toBeChecked();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "e2e-screenshots/internet-convite.png" });
  await page.getByRole("button", { name: "Fechar" }).click();

  // De fora: cria a conta e o personagem sem código e sem mesa.
  const player = { username: `leo_${Date.now() % 1000000}`, password: "senha-do-leo", display_name: "Leo" };
  const info = await call(remote, "/discovery", undefined, undefined, "GET");
  expect(info.body).toEqual(expect.objectContaining({ access_code_required: false, addresses: [] }));
  const signed = await call(remote, "/auth/register", player);
  expect(signed.status).toBe(201);
  const token = signed.body.access_token as string;
  const hero = await call(remote, "/characters/quick", { ruleset_id: "srd-5.1", name: "Viajante" }, token);
  expect(hero.status).toBe(201);

  // Depois procura a mesa: pede para entrar e espera o Mestre.
  const join = await call(remote, "/rooms/join", { pin, character_id: hero.body.id }, token);
  expect(join.status).toBe(409);
  expect(join.body.code).toBe("join_pending");
  const requests = page.getByTestId("join-requests");
  await expect(requests).toContainText("Leo");
  await expect(requests).toContainText("com Viajante");
  await expect(requests).toContainText("pela internet");
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "e2e-screenshots/internet-pedido.png" });

  await requests.getByRole("button", { name: "Aceitar" }).click();
  await expect(requests).toBeHidden();
  const status = await call(remote, `/rooms/join-status?pin=${pin}`, undefined, token, "GET");
  expect(status.body.status).toBe("approved");

  // O admin passa a exigir o código de acesso (pelo botão da própria mesa).
  await page.getByRole("button", { name: "Conectar celulares" }).click();
  await page.getByRole("tab", { name: "Pela internet" }).click();
  await page.getByRole("button", { name: "Configurar acesso pela internet" }).click();
  await page.getByRole("switch", { name: /Pedir código de acesso/ }).click();
  const code = ((await page.getByTestId("access-code").textContent()) ?? "").trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await page.getByRole("dialog", { name: "Jogar pela internet" }).getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByTestId("internet-code")).toHaveText(code);
  await page.getByRole("dialog", { name: "Conectar celulares" }).getByRole("button", { name: "Fechar" }).click();

  const ivo = { username: `ivo_${Date.now() % 1000000}`, password: "senha-do-ivo", display_name: "Ivo" };
  const refused = await call(remote, "/auth/register", ivo);
  expect(refused.status).toBe(403);
  expect(refused.body.code).toBe("access_code");
  const other = await call(remote, "/auth/register", { ...ivo, access_code: code.toLowerCase() });
  expect(other.status).toBe(201);
  const otherToken = other.body.access_token as string;

  // Outro pede e é recusado.
  expect((await call(remote, "/rooms/join", { pin }, otherToken)).status).toBe(409);
  await page.getByTestId("join-requests").getByRole("button", { name: "Recusar" }).click();
  await expect(page.getByTestId("join-requests")).toBeHidden();
  const denied = await call(remote, "/rooms/join", { pin }, otherToken);
  expect(denied.body.code).toBe("join_denied");
});
