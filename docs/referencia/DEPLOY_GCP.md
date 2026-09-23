# Deploy na Google Cloud Platform

> **Referência, não usado na distribuição atual.** O RPG Play hoje é instalado direto (APK, .exe, .deb) com o servidor na rede de casa: veja [INSTALACAO.md](../INSTALACAO.md). Este documento fica para o caso de um dia publicar na nuvem (Google Cloud).

Alvo: **Cloud Run** (API + WebSocket), **Cloud SQL for PostgreSQL 16**, **Memorystore for Redis** (fan-out do WebSocket entre instâncias), **Cloud Storage** (retratos), **Secret Manager**, **Artifact Registry**, com **Cloud Run Jobs + Cloud Scheduler** para migrações e retenção.

> Os comandos abaixo são um roteiro. Ajuste região, nomes e tamanhos, e leve para Terraform quando o ambiente se estabilizar.

```bash
PROJECT=rpgplay-prod
REGION=southamerica-east1          # São Paulo: menor latência para jogadores no Brasil
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com cloudscheduler.googleapis.com \
  vpcaccess.googleapis.com
```

## 1. Banco, Redis e bucket

```bash
gcloud sql instances create rpgplay-db --database-version=POSTGRES_16 --region=$REGION \
  --tier=db-custom-1-3840 --storage-auto-increase --backup-start-time=05:00 --availability-type=zonal
gcloud sql databases create rpg --instance=rpgplay-db
gcloud sql users create rpg --instance=rpgplay-db --password="$(openssl rand -base64 24)"

gcloud redis instances create rpgplay-redis --region=$REGION --size=1 --tier=basic
# Cloud Run precisa de acesso à VPC para falar com o Memorystore (Direct VPC egress ou conector).

gcloud storage buckets create gs://rpgplay-portraits --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention
```

## 2. Segredos

```bash
openssl rand -base64 48 | gcloud secrets create rpg-jwt-secret --data-file=-
printf 'postgresql+asyncpg://rpg:SENHA@/rpg?host=/cloudsql/%s:%s:rpgplay-db' $PROJECT $REGION \
  | gcloud secrets create rpg-database-url --data-file=-
```

Conta de serviço da API (`rpgplay-api@…`) com o mínimo necessário: `roles/cloudsql.client`, `roles/secretmanager.secretAccessor`, `roles/storage.objectAdmin` **só no bucket** e `roles/iam.serviceAccountTokenCreator` em si mesma (necessário para assinar URLs V4 sem chave privada).

## 3. Imagem

```bash
gcloud artifacts repositories create rpgplay --repository-format=docker --location=$REGION
gcloud builds submit backend --tag $REGION-docker.pkg.dev/$PROJECT/rpgplay/api:$(git rev-parse --short HEAD)
```

## 4. Migrações (Cloud Run Job) e API (Cloud Run)

```bash
IMAGE=$REGION-docker.pkg.dev/$PROJECT/rpgplay/api:$(git rev-parse --short HEAD)
COMMON="--region=$REGION --service-account=rpgplay-api@$PROJECT.iam.gserviceaccount.com \
  --set-cloudsql-instances=$PROJECT:$REGION:rpgplay-db \
  --set-secrets=RPG_DATABASE_URL=rpg-database-url:latest,RPG_JWT_SECRET=rpg-jwt-secret:latest \
  --set-env-vars=RPG_ENV=prod,RPG_MEDIA_BACKEND=gcs,RPG_GCS_BUCKET=rpgplay-portraits,RPG_REDIS_URL=redis://REDIS_IP:6379/0"

gcloud run jobs deploy rpgplay-migrate --image=$IMAGE $COMMON --command=alembic --args=upgrade,head
gcloud run jobs execute rpgplay-migrate --region=$REGION --wait

gcloud run deploy rpgplay-api --image=$IMAGE $COMMON \
  --network=default --subnet=default --vpc-egress=private-ranges-only \
  --timeout=3600 --concurrency=250 --min-instances=1 --max-instances=20 \
  --cpu=1 --memory=512Mi --session-affinity --allow-unauthenticated
```

Notas sobre WebSocket no Cloud Run:
- `--timeout=3600`: cada conexão WS dura no máximo 60 min. O app reconecta sozinho (backoff) e recebe o estado atual no `welcome`.
- `--session-affinity` reduz as reconexões para instâncias diferentes, mas **não substitui o Redis**: jogadores da mesma mesa podem estar em instâncias diferentes.
- `--min-instances=1` evita o *cold start* na primeira rolagem da noite.

## 5. Retenção (LGPD)

```bash
gcloud run jobs deploy rpgplay-purge --image=$IMAGE $COMMON --command=python --args=-m,app.cli,purge
gcloud scheduler jobs create http rpgplay-purge-daily --location=$REGION --schedule="0 4 * * *" \
  --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/rpgplay-purge:run" \
  --http-method=POST --oauth-service-account-email=rpgplay-api@$PROJECT.iam.gserviceaccount.com
```

A rotina apaga o log de sessão com mais de 90 dias, remove de vez as contas excluídas há mais de 30 dias e fecha salas expiradas.

## 6. Domínio e app

- Mapeie `api.rpgplay.app` para o serviço (Cloud Run domain mapping ou Load Balancer + Cloud Armor, que traz proteção contra abuso).
- No app, o perfil `production` do `eas.json` usa `EXPO_PUBLIC_API_URL=https://api.rpgplay.app`. O `wss://` é derivado automaticamente.

## Observabilidade (recomendado)

- Logs estruturados do Cloud Run e um alerta de taxa de 5xx e de latência p95 de `/api/v1/dice/roll`.
- Uptime check em `/health`.
- Error Reporting: exceções não tratadas do handler de WebSocket já são logadas com stack trace (`logger.exception`).
