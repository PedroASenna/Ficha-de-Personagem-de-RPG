# Arquitetura

## Visão geral

```mermaid
flowchart LR
  subgraph Casa["Rede de casa"]
    subgraph Srv["Servidor (Linux · .deb ou Docker)"]
      API["FastAPI + WebSocket<br/>uvicorn · 1 processo"]
      DB[("SQLite (WAL)<br/>/var/lib/rpgplay")]
      Media[("Mapas e retratos<br/>/var/lib/rpgplay/media")]
      UDP["Responder UDP 47777"]
      Panel["Painel do Mestre<br/>(React, servido em /mestre)"]
    end
    subgraph PC["PC do Mestre"]
      Electron["RPG Play Mestre (Electron)<br/>acha o servidor → carrega /mestre"]
    end
    subgraph Cel["Celulares (APK)"]
      App["App Expo · React Native<br/>fichas · dados · mesa · mapa"]
    end
  end
  Electron -- "UDP broadcast / varredura HTTP" --> UDP
  Electron -- "HTTP + WS" --> API
  App -- "varredura HTTP · QR code" --> API
  App -- "HTTP + WS" --> API
  API --> DB
  API --> Media
  Panel -.-> Electron
```

- **Tudo na casa.** Um processo só (uvicorn) com SQLite em modo WAL, mídia em disco e broadcaster em memória. Postgres (`RPG_DATABASE_URL`) e Redis pub/sub (`RPG_REDIS_URL`) continuam suportados, mas não são necessários.
- **O painel do Mestre vem do servidor** (`/mestre`), e o programa do PC só acha o servidor e carrega esse painel. Assim o painel sempre bate com a versão da API, e o mesmo painel abre em qualquer navegador.
- **O servidor é a autoridade** sobre rolagens (CSPRNG `secrets.SystemRandom`), PV (concorrência otimista por `version`) e posição dos bonecos. O cliente só anima.
- **Visões por papel:** o Mestre recebe a mesa inteira; cada jogador recebe só a cena onde está o boneco dele, sem bonecos escondidos e com os inimigos no formato público (nome, imagem, estado vago).
- **O servidor manda chaves, não assets:** `effect = {animation, palette, sound, haptic, shake, particles, crack, light_burst}`. O app mapeia as chaves para componentes e sons locais.
- **Mesma classificação online e offline:** `backend/app/services/dice/outcome.py` e `mobile/src/lib/dice/outcome.ts` passam pelos mesmos casos em `shared/dice-outcome-vectors.json`.

Descoberta, portas e segurança: [REDE_LOCAL.md](REDE_LOCAL.md). Instalação: [INSTALACAO.md](INSTALACAO.md).

## Estrutura de pastas

```
RPG-Play/
├── backend/                  Servidor (Python 3.11+ · FastAPI)
│   ├── app/
│   │   ├── api/v1/           discovery · auth · admin · me · rulesets · characters · rooms · table · dice · uploads · moderation
│   │   ├── core/             config (modo casa: data_dir, segredos gerados) · security (Argon2/JWT) · discovery (UDP) · rate_limit
│   │   ├── db/               Base declarativa, sessão assíncrona (aiosqlite/asyncpg; pragmas WAL no SQLite)
│   │   ├── models/           User, Character, Room, RoomMember, SessionEvent, Scene, Npc, Token, ...
│   │   ├── rulesets/         pacotes SRD 5.1, SRD 5.2.1, Genérico + catálogo
│   │   ├── services/         dice/* · characters · hp (dano/cura genérico) · rooms (campanhas) · table (visões e audiência) · media · account
│   │   ├── ws/               protocol · router · events · table_events (quem recebe cada evento da mesa) · broadcaster
│   │   ├── main.py           app factory; monta /media e o painel /mestre (fallback de SPA)
│   │   └── server_cli.py     `rpgplay-server`: serve · info · reset-password · make-admin · backup · restore · purge
│   ├── alembic/              migrações (0001 esquema inicial · 0002 servidor caseiro e mesa virtual), SQLite e Postgres
│   ├── scripts/smoke_test.py teste ponta a ponta contra um servidor no ar
│   └── tests/                pytest (SQLite por padrão; Postgres com RPG_TEST_DATABASE_URL)
├── web/                      Painel do Mestre (Vite · React 19 · MUI · react-konva · TanStack Query · zustand)
│   ├── src/screens/          login · mesas (abertas/arquivadas) · contas (admin)
│   ├── src/table/            mesa virtual: MapCanvas (Konva) · TokenNode · SceneBar · Roster · DetailPanel · LogPanel
│   │                         reducer (eventos do WS) · geometry (grade, zoom) · socket · ConnectDialog (QR)
│   └── e2e/                  Playwright contra o servidor real, com uma jogadora no WebSocket
├── desktop/                  Programa do Mestre (Electron · electron-builder → .exe NSIS e .deb)
│   ├── src/                  main (janela, segurança, menu) · preload (ponte só no launcher) · discovery (UDP + HTTP)
│   ├── launcher/             tela local de escolha do servidor (CSP estrita)
│   └── e2e/                  Playwright + Electron contra o servidor real
├── mobile/                   App dos jogadores (Expo SDK 57 · React Native 0.86)
│   ├── src/app/              server (achar servidor) · scan (QR) · join (link) · (auth)/login · (tabs)/* · character/* · room/*
│   ├── src/components/       hud/HPBar · dice/* · table/SceneView (mapa só leitura, pinça/arrasto) · wizard/*
│   ├── src/lib/              api · ws · discovery (varredura /24, QR) · table (reducer + geometria) · dice/*
│   └── src/state/            session (tokens no Keystore) · server (servidor escolhido)
├── packaging/server/         .deb do servidor: PyInstaller, systemd, server.env, scripts do dpkg, build-deb.sh
├── shared/                   vetores de teste e presets de efeito usados pelo backend e pelo app
├── Dockerfile · docker-compose.yml   alternativa ao .deb (network_mode host)
└── docs/
```

## Modelo de dados

```mermaid
erDiagram
  USERS ||--o{ CHARACTERS : "possui"
  USERS ||--o{ REFRESH_TOKENS : ""
  USERS ||--o{ ROOMS : "mestra"
  USERS ||--o{ ROOM_MEMBERS : "participa"
  RULESETS ||--o{ CHARACTERS : "regras"
  RULESETS ||--o{ ROOMS : "regras (fixas)"
  ROOMS ||--o{ ROOM_MEMBERS : ""
  ROOMS ||--o{ SESSION_EVENTS : "log"
  ROOMS ||--o{ SCENES : "cenas"
  ROOMS ||--o{ NPCS : "inimigos"
  SCENES ||--o{ TOKENS : "bonecos"
  CHARACTERS |o--o{ TOKENS : "boneco do personagem"
  NPCS |o--o{ TOKENS : "boneco do inimigo"
  CHARACTERS ||--o{ INVENTORY_ITEMS : ""
  CHARACTERS ||--o{ CHARACTER_ABILITIES : ""
  CHARACTERS |o--o{ ROOM_MEMBERS : "sentado com"

  USERS {
    uuid id PK
    string username UK "a-z 0-9 _ . - (3 a 32)"
    string email "opcional"
    string password_hash "Argon2id"
    string display_name
    bool is_admin "primeira conta"
    timestamptz deleted_at
  }
  ROOMS {
    uuid id PK
    char6 pin "único entre abertas"
    uuid master_id FK
    string ruleset_id FK
    string status "open | closed (arquivada)"
    timestamptz last_activity_at
  }
  SCENES {
    uuid id PK
    uuid room_id FK
    string name
    string map_key "rooms/{room}/map/..."
    int map_width
    int map_height
    int grid_size
    bool grid_visible
    int sort_order
  }
  NPCS {
    uuid id PK
    uuid room_id FK
    string name
    string portrait_key
    int hp_max
    int hp_current
    int hp_temp
    int armor_class
    json attributes
    text notes
    int version
  }
  TOKENS {
    uuid id PK
    uuid room_id FK
    uuid scene_id FK
    uuid character_id FK "OU npc_id (CHECK)"
    uuid npc_id FK
    float x
    float y
    float size "em casas da grade"
    bool hidden
    int z
    int version
  }
  CHARACTERS {
    uuid id PK
    uuid owner_id FK
    string ruleset_id FK
    json attributes
    int hp_max
    int hp_current
    int hp_temp
    int version
  }
  SESSION_EVENTS {
    bigint id PK
    uuid room_id FK
    string type
    string visibility "public | master_only"
    json payload
  }
```

Decisões:
- **Um boneco por personagem por mesa** (índice único parcial `(room_id, character_id)`). Mudar o grupo de cena é trocar o `scene_id`, e a cena de um jogador é a cena do boneco do personagem dele.
- **Inimigos são da mesa**, não da cena. O mesmo inimigo pode ter bonecos em cenas diferentes e é criado em lote ("Goblin" × 3 → Goblin 1, 2, 3).
- **Enums como `VARCHAR`**, e **`JSONB` no Postgres / `JSON` no SQLite.** A migração 0002 usa `batch_alter_table` para funcionar nos dois, e o CI roda `upgrade → check → downgrade → upgrade` em ambos.
- **Campanhas persistentes:** mesas não expiram mais. `closed` = arquivada (dá para reabrir; se o PIN antigo estiver em uso, ganha outro). O expurgo diário apaga campanhas sem atividade há `RPG_ROOM_RETENTION_DAYS` (365 por padrão) e o log com mais de 90 dias.
- **`version`** em personagens, inimigos e bonecos: `hp.change` com versão antiga devolve conflito, e `token.moved` com versão antiga é ignorado pelos clientes (eco atrasado do arrasto).

## Fluxo: o Mestre move um inimigo

```mermaid
sequenceDiagram
  participant M as Painel do Mestre
  participant S as Servidor
  participant A as Ana (mesma cena)
  participant B as Beto (outra cena)
  M->>S: token.move {token_id, x, y} (~10/s durante o arrasto)
  S->>S: só o Mestre · limite de frequência · grava x/y, version+1
  S-->>M: token.moved
  S-->>A: token.moved (boneco visível na cena dela)
  Note over B: não recebe nada
  M->>S: PATCH /tokens/{id} {x, y} ao soltar (encaixado na grade)
  S-->>A: token.upserted (posição final)
```

## Fluxo: rolagem na mesa

```mermaid
sequenceDiagram
  participant P as Jogador (app)
  participant S as Servidor
  participant M as Mestre
  P->>P: gesto → física começa na hora (UI thread)
  P->>S: roll.request {id, notation, character_id, visibility}
  S->>S: parse → roll (CSPRNG) → classify(regras da mesa) → grava no log
  S-->>P: roll.result {roll, outcome.effect, summary}
  S-->>M: roll.result (painel: última rolagem em destaque + log)
  P->>P: dados param → revelam as faces do servidor → efeito (tier)
```

## Protocolo WebSocket (v1)

| Direção | Tipo | Campos |
|---|---|---|
| C→S | `auth` | `token`: **primeira mensagem**, em até 5 s; senão fecha com 4401 |
| C→S | `ping` | resposta `pong` (keepalive a cada 25 s) |
| C→S | `roll.request` | `id`, `notation`, `character_id?` ou `npc_id?` (só o Mestre), `label?`, `visibility: public\|master_only` |
| C→S | `hp.change` | `character_id` ou `npc_id` (só o Mestre), `delta`, `kind: damage\|heal\|temp`, `expected_version?` |
| C→S | `token.move` | `token_id`, `x`, `y` (só o Mestre) |
| S→C | `welcome` | `room`, `log` (últimos 50 eventos visíveis), `table` (visão do Mestre ou do jogador) |
| S→C | `roll.result` · `hp.changed` | resultado com `effect` para a animação e `summary` para o log |
| S→C | `scene.upserted/deleted` · `token.upserted/moved/deleted` · `npc.upserted/deleted` | mesa virtual, filtrada por cena e por papel |
| S→C | `npc.hp.changed` | só para o Mestre (números + log secreto). Os jogadores recebem `npc.upserted` com o estado novo |
| S→C | `view.reset` | a cena do jogador mudou: vem a visão inteira da cena nova |
| S→C | `party.updated` | alguém entrou, trocou de personagem ou foi removido |
| S→C | `presence` · `member.kicked` · `room.closed` · `error{code,message,ref}` | |

Códigos de fechamento: `4401` token inválido · `4403` não é membro / foi removido · `4404` mesa não existe · `4410` mesa arquivada. Os clientes reconectam com backoff (0,5 s → 10–15 s), exceto nos códigos finais, e o `welcome` traz o estado atual.

## Classificação de sucesso/falha

1. **Regras do sistema** (`pack.dice.crit_rules`), por exemplo d20 com natural 20 = crítico e 1 = falha crítica.
2. **Crítico genérico** para dados sem regra: todos os dados mantidos no máximo ou no mínimo, desde que a chance seja ≤ 1/6. Por isso d4 e moeda nunca "criticam", e 2d6 em 6-6 critica.
3. **Faixas**: posição relativa do resultado ≤ 20% = `low`, ≥ 80% = `high`, senão `neutral`. Em sistemas roll-under (`direction: low`, ex. d100 percentual) a escala é invertida.
4. `intensity` (0..1) escala os efeitos: tremor, quantidade de confete, volume.

| Tier | Animação | Paleta | Som | Haptic | Extra |
|---|---|---|---|---|---|
| critical_failure | `die_crack` | blood | impact_dry | error_heavy | tremor 8 px, dado rachado, brasas escuras, vinheta vermelha |
| low | `dim_pulse` | ember | thud_soft | impact_medium | tremor leve |
| neutral | `settle` | stone | clack | impact_light | — |
| high | `glow_soft` | gold_soft | chime | success_light | faíscas |
| critical_success | `golden_burst` | gold | epic_fanfare | success_heavy | explosão de luz, confete |

## Operação

- **Um processo, uma máquina:** o `InMemoryBroadcaster` entrega cada evento às conexões do próprio processo. Com Redis configurado, vários processos podem dividir a carga (útil só fora de casa).
- **Migrações automáticas:** `rpgplay-server serve` roda `alembic upgrade head` antes de subir, então atualizar o `.deb` já migra o banco.
- **Backup consistente** com o servidor ligado (API de backup do SQLite) e **restauração** que guarda os dados anteriores.
- **Expurgo diário** pelo timer systemd `rpgplay-server-purge.timer`.
- **Limites de frequência** em memória (por processo).
