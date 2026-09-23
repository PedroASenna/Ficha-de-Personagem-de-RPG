import { defineConfig, devices } from "@playwright/test";

// Teste ponta a ponta contra o servidor de verdade (o mesmo binário do .deb ou o backend/.venv), que entrega
// o painel já compilado (npm run build) em /mestre. RPG_SERVER_BIN troca o executável do servidor.
const PORT = Number(process.env.E2E_PORT ?? 8097);
const serverBin = process.env.RPG_SERVER_BIN ?? "../backend/.venv/bin/rpgplay-server";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `rm -rf .e2e-data && ${serverBin} serve`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      RPG_DATA_DIR: ".e2e-data",
      RPG_PORT: String(PORT),
      RPG_DISCOVERY_ENABLED: "false",
      // Com o executável empacotado, vale o painel que vai dentro dele; senão, o web/dist recém-compilado.
      ...(process.env.RPG_SERVER_BIN ? {} : { RPG_WEB_DIST_DIR: "dist" }),
      RPG_SERVER_NAME: "Mesa E2E",
    },
  },
});
