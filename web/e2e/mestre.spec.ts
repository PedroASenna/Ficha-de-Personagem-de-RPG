import { expect, type Page, test } from "@playwright/test";

import { checkerPng } from "./png";

// Um fluxo completo do Mestre no painel, com uma jogadora "de verdade" conectada pelo WebSocket
// (como o app do celular faz) para conferir o que chega do outro lado.

type Message = { type: string; [key: string]: unknown };

class Player {
  readonly messages: Message[] = [];
  private socket: WebSocket | null = null;

  private constructor(
    readonly baseURL: string,
    readonly token: string,
    readonly characterId: string,
  ) {}

  static async join(baseURL: string, pin: string, name: string): Promise<Player> {
    const post = async <T>(path: string, body: unknown, token?: string): Promise<T> => {
      const response = await fetch(`${baseURL}/api/v1${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return (await response.json()) as T;
    };
    const username = `${name.toLowerCase()}_${Date.now() % 100000}`;
    const { access_token: token } = await post<{ access_token: string }>("/auth/register", {
      username,
      password: "senha-da-ana",
      display_name: name,
    });
    const character = await post<{ id: string }>("/characters/quick", { ruleset_id: "srd-5.1", name }, token);
    await post("/rooms/join", { pin, character_id: character.id }, token);
    return new Player(baseURL, token, character.id);
  }

  async connect(pin: string): Promise<Message> {
    const socket = new WebSocket(`${this.baseURL.replace(/^http/, "ws")}/ws/rooms/${pin}`);
    this.socket = socket;
    socket.addEventListener("open", () => socket.send(JSON.stringify({ type: "auth", token: this.token })));
    socket.addEventListener("message", (event) => this.messages.push(JSON.parse(String(event.data)) as Message));
    return this.waitFor((m) => m.type === "welcome");
  }

  async waitFor(predicate: (message: Message) => boolean, timeout = 10_000): Promise<Message> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = this.messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Mensagem não chegou. Recebidas: ${this.messages.map((m) => m.type).join(", ")}`);
  }

  close() {
    this.socket?.close();
  }
}

/** Capturas para a documentação: E2E_SCREENSHOTS=1 npx playwright test */
async function snapshot(page: Page, name: string) {
  if (!process.env.E2E_SCREENSHOTS) return;
  await page.waitForTimeout(400); // fim das animações de diálogo
  await page.screenshot({ path: `e2e-screenshots/${name}.png` });
}

/** Posição na tela (px da página) do boneco com este nome, lida do palco do Konva. */
async function tokenOnScreen(page: Page, label: string): Promise<{ x: number; y: number }> {
  const handle = await page.waitForFunction((name) => {
    type KNode = {
      name(): string;
      getAbsolutePosition(): { x: number; y: number };
      find(selector: string): KNode[];
      text?: () => string;
    };
    const konva = (window as unknown as { Konva?: { stages: (KNode & { container(): HTMLElement })[] } }).Konva;
    const stage = konva?.stages[0];
    if (!stage) return null;
    const group = stage.find(".token").find((g) => g.find("Text").some((t) => t.text?.().startsWith(name)));
    if (!group) return null;
    const rect = stage.container().getBoundingClientRect();
    const pos = group.getAbsolutePosition();
    return { x: rect.left + pos.x, y: rect.top + pos.y };
  }, label);
  return (await handle.jsonValue()) as { x: number; y: number };
}

test("Mestre monta a mesa, move inimigos e a jogadora vê só o que deve", async ({ page, baseURL }) => {
  // 1. Primeira conta do servidor (vira admin) e nova mesa.
  await page.goto("/mestre/");
  await expect(page.getByText("Painel do Mestre · Mesa E2E")).toBeVisible();
  await page.getByRole("tab", { name: "Criar conta" }).click();
  await page.getByLabel("Usuário").fill("mestre");
  await page.getByLabel("Nome que aparece na mesa").fill("Mestre Pedro");
  await page.getByLabel("Senha").fill("senha-do-mestre");
  await page.getByRole("button", { name: "Criar conta e entrar" }).click();
  await expect(page.getByRole("heading", { name: "Suas mesas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Contas" })).toBeVisible(); // primeiro usuário = admin

  await page.getByRole("button", { name: "Nova mesa" }).click();
  await page.getByLabel("Nome da campanha").fill("A Mina Perdida");
  await page.getByRole("button", { name: "Criar e abrir" }).click();
  await expect(page.getByTestId("ws-status")).toHaveText("Ao vivo");
  const pin = ((await page.getByText(/^PIN [A-Z0-9]{6}$/).textContent()) ?? "").replace("PIN ", "");
  expect(pin).toHaveLength(6);

  // 2. Primeira cena com mapa enviado pelo painel.
  await page.getByRole("button", { name: "Criar cena com mapa" }).click();
  await page.getByLabel("Nome da cena").fill("Floresta");
  await page.getByTestId("upload-map").setInputFiles({
    name: "floresta.png",
    mimeType: "image/png",
    buffer: checkerPng(1000, 700),
  });
  await expect(page.getByText("Mapa 1000 × 700 px")).toBeVisible();
  await page.getByRole("button", { name: "Criar cena" }).click();
  await expect(page.getByRole("tab", { name: "Floresta" })).toBeVisible();

  // 3. A jogadora entra pelo PIN (como no app) e aparece no grupo sem recarregar.
  const ana = await Player.join(baseURL as string, pin, "Lyra");
  await expect(page.getByText("Lyra", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Colocar Lyra na cena" }).click();
  await expect(page.getByRole("button", { name: "Colocar Lyra na cena" })).toBeHidden(); // boneco já está no mapa
  const welcome = await ana.connect(pin);
  expect((welcome.table as { scene: { name: string } }).scene.name).toBe("Floresta");

  // 4. Inimigos criados na hora (2 goblins) e um deles no mapa.
  await page.getByRole("tab", { name: /Inimigos/ }).click();
  await page.getByRole("button", { name: "Novo inimigo" }).click();
  const npcDialog = page.getByRole("dialog");
  await npcDialog.getByLabel("Nome").fill("Goblin");
  await page.getByLabel("PV máximos").fill("7");
  await page.getByLabel("Classe de Armadura").fill("15");
  await page.getByLabel("Quantos?").fill("2");
  await page.getByRole("button", { name: "Criar 2" }).click();
  await expect(page.getByText("Goblin 2")).toBeVisible();
  await page.getByRole("button", { name: "Colocar Goblin 1 na cena" }).click();
  const placed = await ana.waitFor((m) => m.type === "token.upserted" && Boolean((m.npc as { name?: string })?.name));
  expect(placed.npc).toEqual(expect.objectContaining({ name: "Goblin 1", condition: "ileso" }));
  expect(placed.npc).not.toHaveProperty("hp_current");

  // 5. O Mestre arrasta o goblin no mapa: a jogadora vê andar e parar encaixado na grade.
  const start = await tokenOnScreen(page, "Goblin 1");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(start.x + step * 16, start.y + step * 3);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await ana.waitFor((m) => m.type === "token.moved");
  const dropped = await ana.waitFor(
    (m) => m.type === "token.upserted" && (m.token as { x: number }).x !== (placed.token as { x: number }).x,
  );
  const { x, y } = dropped.token as { x: number; y: number };
  expect((x - 35) % 70).toBe(0); // centro de uma casa da grade de 70 px
  expect((y - 35) % 70).toBe(0);

  // 6. Clique no goblin: atributos ao vivo; dano com números só para o Mestre.
  const now = await tokenOnScreen(page, "Goblin 1");
  await page.mouse.click(now.x, now.y);
  const detail = page.getByTestId("detail-panel");
  await expect(detail.getByRole("heading", { name: "Goblin 1" })).toBeVisible();
  await detail.getByLabel("Valor de dano ou cura").fill("4");
  await detail.getByRole("button", { name: "Dano" }).click();
  await expect(detail.getByTestId("hp-current")).toHaveText("3");
  const hurt = await ana.waitFor(
    (m) => m.type === "npc.upserted" && (m.npc as { condition: string }).condition === "muito_ferido",
  );
  expect(hurt.npc).not.toHaveProperty("hp_current");
  await expect(page.getByTestId("session-log")).toContainText("Goblin 1 sofreu 4 de dano");
  await snapshot(page, "mesa-do-mestre");

  // 7. Rolagem rápida pelo painel.
  await page.getByRole("button", { name: "d20", exact: true }).click();
  await expect(page.getByTestId("last-roll-total")).toHaveText(/^\d{1,2}$/);

  // 8. O grupo se separa: nova cena e Lyra vai para a caverna; a jogadora recebe a cena nova inteira.
  await page.getByRole("button", { name: "Nova cena" }).click();
  await page.getByLabel("Nome da cena").fill("Caverna");
  await page.getByRole("button", { name: "Criar cena" }).click();
  await expect(page.getByRole("tab", { name: "Caverna" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Grupo/ }).click();
  await page.getByRole("button", { name: "Trazer o grupo todo para esta cena" }).click();
  const reset = await ana.waitFor(
    (m) => m.type === "view.reset" && (m.table as { scene: { name: string } | null }).scene?.name === "Caverna",
  );
  expect((reset.table as { npcs: unknown[] }).npcs).toEqual([]);

  // 9. QR code para os celulares.
  await page.getByRole("button", { name: "Conectar celulares" }).click();
  await expect(page.getByTestId("join-pin")).toHaveText(pin);
  await expect(page.getByTestId("join-qr").locator("img")).toBeVisible();
  await snapshot(page, "conectar-celulares");

  ana.close();
});
