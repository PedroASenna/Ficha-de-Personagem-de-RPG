# Checklist da Google Play Store: RPG Play

> **Referência, não usado na distribuição atual.** O RPG Play hoje é instalado direto (APK, .exe, .deb) com o servidor na rede de casa: veja [INSTALACAO.md](../INSTALACAO.md). Este documento fica para o caso de um dia publicar na Google Play.

O checklist cobre as políticas que mais pesam para este tipo de app: câmera/fotos, conteúdo gerado por usuário (UGC), dados pessoais, IP de sistemas de RPG e requisitos técnicos. As datas e regras foram conferidas em setembro/2026 (fontes no fim). Revise antes de cada envio: as políticas mudam com frequência.

Legenda: ✅ já implementado no código · 🟡 depende de configuração no Play Console ou de material externo · ⬜ pendente.

---

## 1. Requisitos técnicos

| | Item | Onde |
|---|---|---|
| ✅ | **Target API 36 (Android 16)**. Obrigatório para apps novos e atualizações desde **31/08/2026** (extensão possível até 01/11/2026). | `mobile/app.config.ts` → `expo-build-properties` (`targetSdkVersion: 36`, `compileSdkVersion: 36`) |
| ✅ | `minSdkVersion 24` (padrão do React Native 0.86) | idem |
| ✅ | **Android App Bundle (AAB)** no perfil de produção | `mobile/eas.json` → `production.android.buildType: app-bundle` |
| 🟡 | **Play App Signing** ativado (chave de upload separada da chave de assinatura) | Play Console → Integridade do app |
| 🟡 | Suporte a **páginas de memória de 16 KB** (exigido para apps com código nativo que miram Android 15+). RN 0.86 e Expo SDK 57 já compilam alinhados, mas isso **não foi verificado num build real** | conferir o AAB do EAS com o relatório de pré-lançamento / `bundletool` |
| ✅ | Nova arquitetura + Hermes ligados | gerado pelo prebuild |
| 🟡 | Relatório de pré-lançamento sem crash (Firebase Test Lab) | Play Console → Testes |
| ✅ | `versionCode` incremental automático | `eas.json` → `autoIncrement` |

## 2. Permissões: câmera, fotos e arquivos

| | Item | Detalhe |
|---|---|---|
| ✅ | **Sem `READ_MEDIA_IMAGES`/`READ_MEDIA_VIDEO`**. A Política de Fotos e Vídeos só aceita essas permissões para uso central e frequente de mídia, o que não é o caso de um retrato. Usamos o **Android Photo Picker**, que dispensa permissão. | `android.blockedPermissions` em `app.config.ts` remove a permissão mesmo se uma biblioteca tentar incluí-la |
| ✅ | `READ_MEDIA_AUDIO`, `READ_MEDIA_VISUAL_USER_SELECTED`, `RECORD_AUDIO`, localização e `SYSTEM_ALERT_WINDOW` bloqueadas | idem |
| ✅ | **`FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` bloqueadas**. O `expo-audio` as inclui por padrão para tocar em segundo plano, e declarar um tipo de foreground service obriga a preencher formulário e mostrar vídeo na revisão. Só tocamos efeitos curtos com o app aberto. | `expo-audio` com `enableBackgroundPlayback: false` + bloqueio |
| ✅ | **`CAMERA` opcional e pedida em tempo de execução** só ao tocar "Tirar foto", depois de um diálogo explicando o uso. Negar a permissão não bloqueia nada: dá para usar a galeria. | `src/app/character/new.tsx`, `src/lib/portrait.ts` |
| ✅ | `READ/WRITE_EXTERNAL_STORAGE` apenas com `maxSdkVersion=32`, vindas do `expo-image-picker`; só se aplicam a Android ≤ 12 | manifest gerado |
| ✅ | Metadados EXIF (GPS, modelo do aparelho) removidos **no aparelho** (reencode) e **de novo no servidor** | `portrait.ts` + `backend/app/services/media.py` |
| ✅ | Manifesto final auditado: `npx expo prebuild -p android` e depois ler `android/app/src/main/AndroidManifest.xml` | seção "Verificação" do README |
| 🟡 | Declaração de permissões no Play Console coerente (câmera: "foto de perfil do personagem, opcional") | Play Console → Conteúdo do app |

## 3. Conteúdo gerado pelo usuário (política de UGC)

Nomes de personagens e de salas, retratos e o log das mesas são UGC visto por outras pessoas. Para isso a Play exige:

| | Item | Onde |
|---|---|---|
| ✅ | Termos de uso aceitos **antes** de criar conta, com tolerância zero para conteúdo impróprio | `login.tsx` (checkbox) + `terms_version` gravado em `users` |
| ✅ | **Denúncia dentro do app** de usuário, personagem, sala ou evento | `POST /api/v1/reports`, menu "Denunciar" na mesa |
| ✅ | **Bloqueio de usuários** | `POST/DELETE /api/v1/blocks` |
| ✅ | O Mestre pode **remover jogadores** e **encerrar a sala** | `POST /rooms/{id}/kick`, `/close` |
| 🟡 | Fila de moderação com prazo de resposta definido (ex.: 24 h) e remoção de conteúdo e contas infratoras | tabela `content_reports` (falta um painel de moderação) |
| ⬜ | Filtro automático de imagem (Cloud Vision SafeSearch) no upload do retrato | ponto de extensão em `services/media.py` |
| ⬜ | Filtro de palavras ofensivas em nomes (pt-BR/en) | sugestão: validar em `CharacterPatch`/`RoomCreate` |
| ✅ | Não há chat livre entre usuários, o que reduz o risco. Se entrar chat, reavaliar a política e a classificação etária. | — |

## 4. Privacidade (LGPD / GDPR) e Segurança de Dados

| | Item | Onde |
|---|---|---|
| 🟡 | **Política de privacidade** publicada em URL pública, informada no Play Console **e** acessível no app | `extra.privacyPolicyUrl` + tela Conta |
| ✅ | **Exclusão de conta dentro do app** (exigência da Play desde 2024) | Conta → "Excluir minha conta" → `DELETE /api/v1/me` |
| 🟡 | **Exclusão de conta por URL web** (sem precisar reinstalar o app), informada no formulário Data Safety | `extra.accountDeletionUrl`; falta publicar a página |
| ✅ | Exportação dos dados (LGPD art. 18, V) | `GET /api/v1/me/export` |
| ✅ | Minimização: sem data de nascimento (só confirmação 13+), sem localização, sem contatos, sem ID de publicidade; rolagens solo não são gravadas | `models/user.py`, `api/v1/dice.py` |
| ✅ | Retenção: log de sessão por 90 dias; conta excluída expurgada em 30 dias; salas expiram em 24 h | `services/account.py::purge` (+ Cloud Scheduler) |
| ✅ | Tokens em armazenamento criptografado (Keystore via `expo-secure-store`), backup do Android desligado | `state/session.ts`, `allowBackup: false` |
| ✅ | Senhas com Argon2, refresh token de uso único, JWT curto (15 min), tráfego só em HTTPS/WSS | `core/security.py`, Cloud Run |
| 🟡 | **Formulário Data Safety**: ver o mapeamento em [`PRIVACY_LGPD.md`](PRIVACY_LGPD.md#formulário-data-safety) | Play Console |
| 🟡 | Encarregado de dados (DPO) nomeado com canal de contato na política | documento jurídico |

## 5. Público-alvo, classificação e monetização

| | Item |
|---|---|
| ✅ | Público **13+** com age gate no cadastro, sem guardar a data de nascimento. **Fora do programa "Designed for Families"**: não direcionar a crianças em listagem, ícone nem screenshots. |
| 🟡 | Questionário **IARC**: violência de fantasia (combate descrito em texto, sem sangue realista), UGC e interação entre usuários (sim, em mesas privadas). |
| ✅ | **Dados não são jogo de azar**: nada de dinheiro real, apostas ou prêmios. |
| ⬜ | Se houver monetização: compras só pelo **Google Play Billing**. Se um dia existirem "baús"/loot boxes, é **obrigatório divulgar as probabilidades** antes da compra. |
| ⬜ | Se usar anúncios, declarar SDK e ID de publicidade; famílias de SDK certificadas. (Hoje não há.) |

## 6. Propriedade intelectual e metadados da loja

| | Item |
|---|---|
| ✅ | Só entram no app sistemas com licença que permite software: SRD 5.1/5.2.1 (CC-BY-4.0) e Genérico. Tormenta20/3DeT estão **excluídos**, porque a Licença Aberta da Jambô proíbe apps. Detalhes em [`RULESETS.md`](RULESETS.md). |
| ✅ | Atribuição CC-BY exibida no app (Conta → Licenças, e no card do sistema ao criar a mesa) |
| ✅ | Nomes neutros no app: "Fantasia 5ª Edição (SRD 5.1)", sem usar "Dungeons & Dragons"/"D&D" como nome de produto |
| 🟡 | **Título, ícone, screenshots e descrição sem marcas de terceiros** ("D&D", "Pathfinder", "Tormenta", "Ordem Paranormal"). "Compatível com a 5ª edição" é aceitável na descrição. |
| 🟡 | ⚠️ **"RPG Play"** tem "Play" no nome. A política de metadados proíbe sugerir vínculo com o Google/Google Play. Considere um título de listagem diferente (ex.: "RPG Play: Fichas e Dados" já reduz o risco, mas um nome sem "Play" é mais seguro). |
| ⬜ | Revisar os nomes do catálogo "Em breve" (Pathfinder, Daggerheart…) antes de publicar: mostrar marca de terceiro mesmo desabilitada pode gerar reclamação de IP. |
| ✅ | Sons e efeitos são próprios (síntese em `mobile/scripts/gen_sfx.py`). Assets do LottieFiles só com licença compatível (Lottie Simple License) e crédito quando exigido. |

## 7. Acessibilidade e qualidade (recomendado; conta pontos na revisão e nas avaliações)

| | Item |
|---|---|
| ✅ | Material Design 3 (react-native-paper), tema claro e escuro, alvos de toque ≥ 48 dp |
| ✅ | Barra de HP como `progressbar` com valor lido pelo TalkBack; bandeja de dados com botão "Rolar" acessível, além do gesto |
| ✅ | "Remover animações" do sistema desliga tremor, partículas e pulsação |
| 🟡 | Som respeita o modo silencioso. A API para desligar haptics e sons existe (`setFeedbackPreferences`), mas a tela de preferências ainda falta |
| 🟡 | Contraste AA nas cores de HUD/efeitos (conferir com o Accessibility Scanner) |

## 8. Publicação (conta de desenvolvedor)

| | Item |
|---|---|
| 🟡 | **Conta pessoal criada depois de 13/11/2023: teste fechado com no mínimo 12 testadores opt-in por 14 dias seguidos** antes de pedir acesso à produção. Contas de organização estão isentas. |
| 🟡 | Verificação de identidade do desenvolvedor concluída no Play Console |
| 🟡 | Faixas: interna → fechada (12 × 14 dias) → produção com lançamento gradual (10% → 50% → 100%) |
| 🟡 | Ficha da loja: ícone 512×512, gráfico de destaque 1024×500, ≥ 2 screenshots de telefone, descrição curta e longa em pt-BR (e en) |

---

### Fontes

- [Target API level requirements (Play Console Help)](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Photo and Video Permissions policy](https://support.google.com/googleplay/android-developer/answer/14115180)
- [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [Licença Aberta Jambô](https://jamboeditora.com.br/licenca-aberta/) · [SRD 5.2.1 (CC-BY-4.0)](https://www.dndbeyond.com/srd)
