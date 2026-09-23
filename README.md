# RPG Play

[![CI](https://github.com/PedroASenna/Ficha-de-Personagem-de-RPG/actions/workflows/ci.yml/badge.svg)](https://github.com/PedroASenna/Ficha-de-Personagem-de-RPG/actions/workflows/ci.yml)

RPG de mesa **na rede de casa**. Um servidor fica ligado num canto (PC Linux ou Raspberry Pi), o Mestre comanda uma **mesa virtual** no PC e os jogadores usam o **app no celular**. Tudo se acha pelo Wi-Fi, sem nuvem e sem loja de aplicativos.

- **Personagem jogável em um toque** (ou num wizard guiado com autosave), **dados animados com física e emoção** (rachadura e tremor na falha crítica, explosão dourada e confete no crítico) e **HUD de combate** com barra de PV que sangra e brilha.
- **Mesa virtual do Mestre:** mapas importados em **cenas** (troca quando o grupo se separa), bonecos com a imagem dos personagens e **inimigos criados na hora**. Clicar num boneco mostra **os atributos em tempo real**, com dano, cura e rolagens secretas.
- **No celular, o jogador vê o mapa da cena onde está**, com os bonecos andando ao vivo. Dos inimigos, vê só nome, imagem e se estão **Ilesos, Feridos, Muito feridos ou Caídos**.
- **Contas locais** (usuário e senha no servidor) e **campanhas salvas**: arquivar e reabrir de onde parou.

| Peça | Instalador | Tecnologia |
|---|---|---|
| Servidor | `.deb` (amd64, arm64) ou Docker | Python · FastAPI · WebSocket · SQLite (Postgres/Redis opcionais) · systemd |
| Programa do Mestre (PC) | `.exe` (Windows) e `.deb` (Linux) | Electron, que carrega o painel web servido pelo servidor |
| Painel do Mestre (web) | vem dentro do servidor, em `/mestre` | React 19 · MUI · react-konva · TanStack Query · zustand |
| App dos jogadores | `.apk` (Android) | Expo SDK 57 · React Native 0.86 · Reanimated 4 · react-native-svg · Paper (Material 3) |

**Baixar os instaladores: [Releases](https://github.com/PedroASenna/Ficha-de-Personagem-de-RPG/releases/latest).** Para instalar e jogar: [docs/INSTALACAO.md](docs/INSTALACAO.md).

## Documentação

| Assunto | Onde |
|---|---|
| Instalação passo a passo (servidor, PC do Mestre, APK), primeira sessão, backup, problemas comuns, gerar instaladores | [docs/INSTALACAO.md](docs/INSTALACAO.md) |
| Descoberta na rede, portas, modelo de segurança, onde ficam os dados | [docs/REDE_LOCAL.md](docs/REDE_LOCAL.md) |
| Arquitetura, pastas, modelo de dados, protocolo WebSocket | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Fluxos de UX (app, painel do Mestre, mapa do jogador) | [docs/UX_FLOWS.md](docs/UX_FLOWS.md) |
| Sistemas de regras (o Mestre escolhe ao criar a mesa) | [docs/RULESETS.md](docs/RULESETS.md) |
| Privacidade (uso doméstico) | [docs/PRIVACY_LGPD.md](docs/PRIVACY_LGPD.md) |
| Referência, não usada hoje: Play Store e deploy na nuvem | [docs/referencia/](docs/referencia) |

## Desenvolvimento

### Servidor

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
rpgplay-server serve                      # migra o SQLite em ./data e sobe em http://0.0.0.0:8080
python scripts/smoke_test.py http://localhost:8080
```

Testes: `pytest` (SQLite). Contra Postgres, como no CI: `RPG_TEST_DATABASE_URL=postgresql+asyncpg://rpg:rpg@localhost:5432/rpg_test pytest`. Qualidade: `ruff check .` e `black --check .`.

### Painel do Mestre

```bash
cd web
npm ci
npm run dev          # http://localhost:5173/mestre/ (repassa /api, /ws e /media para o servidor em :8080)
npm run build        # web/dist, que o servidor entrega em /mestre (RPG_WEB_DIST_DIR=../web/dist)
```

Qualidade: `npx tsc -b` · `npx eslint .` · `npm run format:check` · `npx vitest run` · `npx playwright test` (sobe um servidor real e faz o fluxo do Mestre com uma jogadora conectada).

### Programa do Mestre

```bash
cd desktop
npm ci
npm start                       # abre o launcher: acha o servidor e carrega /mestre
npm run dist:linux              # release/rpgplay-mestre_<versão>_amd64.deb
npm run dist:win                # release/RPG-Play-Mestre-Setup-<versão>.exe (Windows ou Linux com wine)
```

Qualidade: `npm run typecheck` · `npx eslint .` · `npx vitest run` · `xvfb-run -a npx playwright test`.

### App dos jogadores

```bash
cd mobile
npm ci
npx expo run:android            # development build (emulador ou aparelho)
npm run apk                     # APK release (precisa do Android SDK)
```

O app usa módulos nativos (Reanimated, SVG, câmera, haptics, áudio), então **não roda no Expo Go**. Qualidade: `npx tsc --noEmit` · `npx eslint .` · `npx jest` · `npx expo export --platform android`.

### Instaladores

- Servidor: `packaging/server/build-deb.sh`
- Tudo de uma vez: tag `v*`, e o workflow [Release](.github/workflows/release.yml) gera os `.deb` do servidor (amd64/arm64), o `.exe`/`.deb` do Mestre e o APK assinado.

## Verificação feita

- **Servidor:** 114 testes pytest em SQLite **e** PostgreSQL 16, entre eles:
  - contas locais e admin;
  - descoberta HTTP e UDP;
  - campanhas arquivadas e reabertas;
  - permissões da mesa;
  - WebSocket com três conexões (o `token.move` só chega a quem está na cena, a separação do grupo gera `view.reset`, o dano em inimigo manda números só ao Mestre);
  - backup e restauração, inclusive recusando tar malicioso.

  `ruff` e `black` limpos. A migração 0002 passa por `upgrade → check → downgrade → upgrade` nos dois bancos, com dados antigos migrados. O smoke test ponta a ponta passou.
- **Pacote `.deb` do servidor:** gerado aqui com Python portátil (exige glibc ≥ 2.28) e instalado com `dpkg`, rodando como o usuário `rpgplay`. Funcionaram:
  - `/health`, `/mestre`, descoberta por **broadcast UDP** e smoke test;
  - `reset-password`, `backup` e `restore` pelo comando `rpgplay-server`;
  - atualização mantendo o `server.env`, `remove` mantendo as campanhas e `purge` apagando tudo.
- **Painel do Mestre:** 34 testes Vitest. Um teste Playwright ponta a ponta faz o fluxo completo contra o servidor de desenvolvimento **e** contra o executável empacotado:
  - criar conta e mesa;
  - enviar um mapa;
  - receber a jogadora ao vivo;
  - criar inimigos;
  - arrastar o goblin com encaixe na grade;
  - aplicar dano (a jogadora só vê "Muito ferido");
  - rolar dados;
  - separar o grupo em outra cena;
  - mostrar o QR code.
- **Programa do Mestre:** 8 testes Vitest e um Playwright + Electron que roda contra o código **e** contra o `.deb` instalado:
  - acha o servidor sozinho por UDP;
  - isola o painel;
  - bloqueia navegação para fora;
  - troca de servidor;
  - aceita o IP digitado.

  O `.exe` (NSIS) foi gerado aqui com wine, com ícone e metadados conferidos.
- **App:** 94 testes Jest (descoberta e QR, reducer e geometria do mapa, renderização da cena, mais os de antes); `tsc` e `eslint` limpos. `expo export` gera o bundle Android. No `expo prebuild`, o manifest gerado tem `usesCleartextTraffic`, as permissões de rede e câmera e o esquema `rpgplay://`.
- **Não verificado aqui:**
  - o **APK** não foi compilado (este ambiente não tem acesso ao Android SDK); o workflow de Release compila;
  - o `.exe` não rodou num **Windows de verdade**;
  - a descoberta não foi testada num **Wi-Fi real** com celulares;
  - a imagem Docker não foi gerada (Docker Hub bloqueado aqui).

## Próximos passos sugeridos

1. Testar numa sessão real: instalar o servidor, o `.exe` e o APK e jogar uma cena com o grupo.
2. Névoa de guerra e régua de distância no mapa; iniciativa (ordem de turno) no painel.
3. Anunciar o servidor por mDNS (`rpgplay.local`) para quem não quer IP fixo.
4. Pacote **Old Dragon 2** (CC-BY-SA, pt-BR) e dados Fudge/paradas de d6 para Fate, Year Zero e Forged in the Dark.
