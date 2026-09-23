# RPG Play

App Android de RPG de mesa que ataca a **lentidão na criação de personagens**: personagem jogável em um toque (ou num wizard guiado com autosave), **dados animados com física e emoção** (rachadura e tremor na falha crítica, explosão dourada e confete no crítico), **HUD de combate** com barra de HP que sangra e brilha, e **mesa sincronizada** em que o Mestre recebe cada rolagem e cada dano em tempo real.

| Camada | Stack |
|---|---|
| Mobile | React Native 0.86 · Expo SDK 57 · TypeScript · expo-router · Reanimated 4 + worklets · react-native-svg · react-native-paper (Material 3) · TanStack Query · zustand |
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 (async) · PostgreSQL 16 · Alembic · WebSockets · Redis pub/sub |
| Infra | Docker · Cloud Run · Cloud SQL · Memorystore · Cloud Storage · Secret Manager |

## Onde está cada entregável

| Entregável | Onde |
|---|---|
| 1. Estrutura de pastas | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#estrutura-de-pastas) |
| 2. Esquema do banco (usuários, fichas, salas) | [`backend/app/models/`](backend/app/models) · migração [`0001_esquema_inicial.py`](backend/alembic/versions/0001_esquema_inicial.py) · [diagrama ER](docs/ARCHITECTURE.md#modelo-de-dados) |
| 3. Barra de HP animada | [`mobile/src/components/hud/HPBar.tsx`](mobile/src/components/hud/HPBar.tsx) + lógica testável em [`hpBarLogic.ts`](mobile/src/components/hud/hpBarLogic.ts) |
| 4. Rolagem no backend + animação de sucesso/falha via WebSocket | [`services/dice/`](backend/app/services/dice) (parser, rolagem, classificação) · [`ws/router.py`](backend/app/ws/router.py) · [protocolo](docs/ARCHITECTURE.md#protocolo-websocket-v1) |
| 5. Checklist da Play Store | [docs/PLAY_STORE_CHECKLIST.md](docs/PLAY_STORE_CHECKLIST.md) |
| Sistemas de regras (o Mestre escolhe ao criar a sala) | [docs/RULESETS.md](docs/RULESETS.md) |
| Fluxos de UX | [docs/UX_FLOWS.md](docs/UX_FLOWS.md) |
| LGPD / Data Safety | [docs/PRIVACY_LGPD.md](docs/PRIVACY_LGPD.md) |
| Deploy GCP | [docs/DEPLOY_GCP.md](docs/DEPLOY_GCP.md) |

## Rodando localmente

### Backend

Com Docker:

```bash
docker compose up --build        # API em http://localhost:8080 (docs em /docs)
```

Sem Docker (Postgres 16 e Redis locais):

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env              # ajuste RPG_DATABASE_URL / RPG_REDIS_URL
alembic upgrade head
uvicorn app.main:create_app --factory --reload --port 8080
python scripts/smoke_test.py http://localhost:8080    # Mestre + jogadora, rolagem e dano via WebSocket
```

Testes: `pytest` usa SQLite por padrão. Para rodar contra Postgres (como no CI), use `RPG_TEST_DATABASE_URL=postgresql+asyncpg://rpg:rpg@localhost:5432/rpg_test pytest`.

### Mobile

```bash
cd mobile
npm install
npx expo run:android                                  # development build (emulador ou aparelho)
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080 npx expo start   # aparelho físico na mesma rede
```

O app usa módulos nativos (Reanimated, SVG, haptics, áudio, image picker), então **não roda no Expo Go**: use um development build (`npx expo run:android` ou `eas build --profile development`).

Qualidade: `npx tsc --noEmit` · `npx eslint .` · `npx jest` · `npx expo export --platform android`.

### Builds para a loja

```bash
cd mobile
npx eas-cli@latest build --platform android --profile production   # AAB, target API 36
npx eas-cli@latest submit --platform android --profile production  # faixa interna
```

## Verificação feita neste scaffold

- **Backend**: 95 testes pytest (SQLite **e** PostgreSQL 16), `ruff` e `black` limpos. `alembic upgrade → check → downgrade → upgrade` sem divergência dos models. Smoke test ponta a ponta com uvicorn + Postgres + Redis pub/sub (sala SRD 5.1, PIN, `1d20+5`, dano, log do Mestre).
- **Mobile**: `tsc` e `eslint` (regras do React Compiler) limpos. 75 testes Jest, incluindo os **mesmos vetores de classificação do backend** (`shared/`) e a renderização da HPBar. `expo export` gera o bundle Hermes de Android, e `expo prebuild` confere o manifest: target/compile SDK 36, permissões de mídia, microfone, localização e foreground service removidas, `allowBackup=false`.
- **Não verificado aqui**: build nativo (Gradle/AAB) e execução em aparelho, porque o ambiente não tem Android SDK. Isso fica para o `eas build` e o teste fechado. O `docker compose` também não pôde ser executado (o download de imagens do Docker Hub está bloqueado neste ambiente). O mesmo conjunto rodou com Postgres/Redis nativos.

## Próximos passos sugeridos

1. Revisar os pacotes SRD contra o texto oficial e publicar a política de privacidade, os termos e a página web de exclusão de conta.
2. Painel de moderação para `content_reports` e SafeSearch no upload de retratos.
3. Pacote **Old Dragon 2** (CC-BY-SA, pt-BR) e dados Fudge/paradas de d6 no motor para Fate, Year Zero e Forged in the Dark.
4. Push (FCM) para avisar o Mestre com o app em segundo plano. Isso pede `POST_NOTIFICATIONS` e a atualização do Data Safety.
5. Tela de preferências (sons, haptics, D6 padrão/numérico persistido).
