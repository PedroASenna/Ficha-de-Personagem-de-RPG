import { defineConfig } from "@playwright/test";

// Abre o programa de verdade (Electron) contra um servidor RPG Play rodando nesta máquina, com portas próprias
// para não brigar com um servidor instalado. No Linux sem tela: xvfb-run -a npx playwright test
const HTTP_PORT = 8095;
const DISCOVERY_PORT = 47795;
const serverBin = process.env.RPG_SERVER_BIN ?? "../backend/.venv/bin/rpgplay-server";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: {
    command: `rm -rf .e2e-data && ${serverBin} serve`,
    url: `http://127.0.0.1:${HTTP_PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      RPG_DATA_DIR: ".e2e-data",
      RPG_PORT: String(HTTP_PORT),
      RPG_DISCOVERY_PORT: String(DISCOVERY_PORT),
      RPG_SERVER_NAME: "Mesa Desktop E2E",
      ...(process.env.RPG_SERVER_BIN ? {} : { RPG_WEB_DIST_DIR: "../web/dist" }),
    },
  },
  metadata: { HTTP_PORT, DISCOVERY_PORT },
});
