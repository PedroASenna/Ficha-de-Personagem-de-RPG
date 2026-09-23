import fs from "node:fs";
import path from "node:path";

import type { ServerInfo } from "./discovery";

export interface DesktopConfig {
  lastServer?: ServerInfo;
}

/** Preferências do programa (último servidor usado), num JSON na pasta de dados do usuário. */
export class ConfigStore {
  private readonly file: string;

  constructor(directory: string) {
    this.file = path.join(directory, "rpgplay-mestre.json");
  }

  load(): DesktopConfig {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as DesktopConfig;
    } catch {
      return {};
    }
  }

  save(config: DesktopConfig): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(config, null, 2));
  }
}
