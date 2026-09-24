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

/** Posição na tela (px da página) do boneco (ou objeto) com este nome, lida do palco do Konva. */
async function tokenOnScreen(page: Page, label: string, kind = ".token"): Promise<{ x: number; y: number }> {
  const handle = await page.waitForFunction(
    ([name, selector]) => {
      type KNode = {
        name(): string;
        getAbsolutePosition(): { x: number; y: number };
        find(selector: string): KNode[];
        text?: () => string;
      };
      const konva = (window as unknown as { Konva?: { stages: (KNode & { container(): HTMLElement })[] } }).Konva;
      const stage = konva?.stages[0];
      if (!stage) return null;
      const group = stage.find(selector).find((g) => g.find("Text").some((t) => t.text?.().startsWith(name)));
      if (!group) return null;
      const rect = stage.container().getBoundingClientRect();
      const pos = group.getAbsolutePosition();
      return { x: rect.left + pos.x, y: rect.top + pos.y };
    },
    [label, kind],
  );
  return (await handle.jsonValue()) as { x: number; y: number };
}

/** Escala atual do palco (px da tela por px do mapa). */
async function stageScale(page: Page): Promise<number> {
  return page.evaluate(() => {
    const konva = (window as unknown as { Konva?: { stages: { scaleX(): number }[] } }).Konva;
    return konva?.stages[0]?.scaleX() ?? 1;
  });
}

async function dragOnCanvas(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
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
  await page.getByRole("button", { name: "Enviar imagem" }).click(); // ajuste de ângulo antes de enviar
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
  await page.keyboard.press("Escape");

  // 10. Várias imagens de cenário de uma vez, com o ângulo ajustado antes de enviar.
  await page.getByTestId("upload-pieces").setInputFiles([
    { name: "arvore.png", mimeType: "image/png", buffer: checkerPng(200, 300) },
    { name: "pedra.png", mimeType: "image/png", buffer: checkerPng(120, 120) },
  ]);
  const rotateDialog = page.getByRole("dialog");
  await expect(rotateDialog.getByText("Ajustar o ângulo de 2 imagens")).toBeVisible();
  await rotateDialog.getByRole("button", { name: "Girar 90° para a direita" }).first().click();
  await rotateDialog.getByRole("button", { name: "Colocar 2 imagens" }).click();
  await expect(page.getByTestId("pieces-panel")).toContainText("2 peças de cenário");
  const firstPiece = await ana.waitFor((m) => m.type === "image.upserted");
  const tree = firstPiece.image as { width: number; height: number };
  expect(tree.width).toBeGreaterThan(tree.height); // 200×300 girado 90° no envio
  // Girar as duas juntas pelo painel: a jogadora recebe o ângulo novo.
  await page.getByTestId("pieces-panel").getByRole("button", { name: "Girar 90° para a direita" }).click();
  await ana.waitFor((m) => m.type === "image.upserted" && (m.image as { rotation: number }).rotation === 90);

  // 11. Objeto que carrega: Lyra entra na carroça e anda junto quando ela é arrastada.
  await page.getByRole("button", { name: "Objeto", exact: true }).click();
  await page.getByLabel("Nome").fill("Carroça");
  await page.getByRole("button", { name: "Criar objeto" }).click();
  await expect(page.getByTestId("object-panel")).toBeVisible();
  const created = await ana.waitFor((m) => m.type === "object.upserted");
  const cartObject = created.object as { id: string; width: number; height: number };
  const scale = await stageScale(page);
  const cart = await tokenOnScreen(page, "Carroça", ".object");
  const lyra = await tokenOnScreen(page, "Lyra");
  await dragOnCanvas(page, lyra, { x: cart.x + 4, y: cart.y + 4 });
  await ana.waitFor(
    (m) => m.type === "token.upserted" && (m.token as { container_id: string | null }).container_id === cartObject.id,
  );
  // Arrasta a carroça pela ponta esquerda (longe do boneco, que ficou no meio).
  const cartNow = await tokenOnScreen(page, "Carroça (1)", ".object");
  const grab = { x: cartNow.x - cartObject.width * 0.4 * scale, y: cartNow.y };
  await dragOnCanvas(page, grab, { x: grab.x + 160, y: grab.y + 20 });
  const carried = await ana.waitFor((m) => m.type === "object.upserted" && (m.tokens as unknown[]).length === 1);
  expect((carried.tokens as { token_id: string }[])[0]?.token_id).toBeTruthy();

  // 12. Névoa de guerra: a jogadora passa a receber a própria exploração.
  await page.getByRole("button", { name: "Editar cena" }).click();
  await page.getByLabel("Névoa de guerra").check();
  await page.getByRole("button", { name: "Salvar" }).click();
  const fogged = await ana.waitFor((m) => m.type === "view.reset" && (m.table as { fog: unknown }).fog !== null);
  expect((fogged.table as { scene: { fog_enabled: boolean } }).scene.fog_enabled).toBe(true);
  await expect(page.getByTestId("fog-view")).toBeVisible();
  await snapshot(page, "cenario-objeto-nevoa");

  // 13. Subir de nível pela mesa.
  await page.getByRole("tab", { name: /Grupo/ }).click();
  await page.getByText("Lyra", { exact: true }).first().click();
  await page.getByTestId("detail-panel").getByRole("button", { name: "Nível" }).click();
  await page.getByRole("button", { name: "Subir para o nível 2" }).click();
  const leveled = await ana.waitFor((m) => m.type === "character.leveled");
  expect(leveled.level).toBe(2);
  await expect(page.getByTestId("session-log")).toContainText("Lyra subiu para o nível 2");

  // 14. Mapa-múndi com nações: a jogadora só vê o que foi revelado.
  await page.getByRole("button", { name: "Mundo" }).click();
  await page.getByRole("button", { name: "Nova nação" }).click();
  await page.getByLabel("Nome").fill("Império de Ferro");
  await page.getByLabel("Governante").fill("Imperatriz Liria");
  await page.getByLabel("Notas secretas (só você)").fill("Planeja invadir o norte");
  await page.getByRole("button", { name: "Criar", exact: true }).click();
  await page.getByRole("button", { name: "Revelar Império de Ferro" }).click();
  const world = await ana.waitFor(
    (m) => m.type === "world.updated" && (m.world as { factions: unknown[] }).factions.length === 1,
  );
  const nation = (world.world as { factions: Record<string, unknown>[] }).factions[0];
  expect(nation).toEqual(expect.objectContaining({ name: "Império de Ferro", leader: "Imperatriz Liria" }));
  expect(nation).not.toHaveProperty("secret_notes");
  await page.getByRole("button", { name: "Enviar mapa" }).first().click();
  await page
    .getByTestId("upload-map")
    .setInputFiles({ name: "mundo.png", mimeType: "image/png", buffer: checkerPng(800, 500) });
  await page.getByRole("button", { name: "Enviar imagem" }).click();
  await expect(page.getByTestId("world-map")).toBeVisible();
  await page.getByLabel("Mapa escondido dos jogadores").click();
  await expect(page.getByLabel("Jogadores veem o mapa")).toBeChecked();
  await ana.waitFor((m) => m.type === "world.updated" && Boolean((m.world as { map_url: string | null }).map_url));
  await snapshot(page, "mapa-mundi");

  ana.close();
});
