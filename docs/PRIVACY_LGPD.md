# Privacidade: LGPD / GDPR

Este documento é a base técnica da Política de Privacidade e do formulário **Data Safety** da Play Store. O texto jurídico final deve ser revisado por um advogado e publicado numa URL pública.

## Inventário de dados

| Dado | Onde fica | Finalidade | Base legal (LGPD art. 7º) | Retenção |
|---|---|---|---|---|
| E-mail | `users.email` | Login, recuperação de conta | Execução de contrato (V) | Até a exclusão da conta. Anonimizado na hora ao excluir e expurgado em 30 dias |
| Senha | `users.password_hash` (Argon2) | Autenticação | Execução de contrato | Idem |
| Nome de exibição | `users.display_name` | Identificação na mesa | Execução de contrato | Idem |
| Confirmação de idade 13+ | `users.age_gate_confirmed_at` (**sem** data de nascimento) | Cumprir a idade mínima | Obrigação legal/regulatória (II) | Idem |
| Aceite de termos e política | `users.terms_version`, `privacy_version`, `consent_at` | Prova de consentimento/aceite | Obrigação legal (II) | Idem |
| Fichas de personagem | `characters`, `inventory_items`, `character_abilities` | Funcionalidade principal | Execução de contrato | Até o usuário apagar a ficha ou a conta |
| Retrato do personagem | GCS `portraits/{user}/...` (JPEG 512 px **sem EXIF**) | Exibir na ficha e na mesa | Execução de contrato | Apagado com a ficha ou a conta |
| Log das mesas | `session_events` | Histórico da sessão para o Mestre | Legítimo interesse (IX) | **90 dias** (`RPG_EVENT_RETENTION_DAYS`) |
| Denúncias e bloqueios | `content_reports`, `user_blocks` | Segurança e moderação (política de UGC) | Legítimo interesse / obrigação | Denúncia: até a resolução mais o prazo de auditoria. Bloqueios apagados com a conta |
| Tokens de sessão | `refresh_tokens` (só o **hash**); no aparelho, Keystore | Manter o login | Execução de contrato | 30 dias ou logout |

**O que NÃO coletamos:** localização, contatos, ID de publicidade, analytics de terceiros, data de nascimento, gravações de áudio, lista de apps. **Rolagens solo não são gravadas.**

## Direitos do titular (art. 18) e onde estão implementados

| Direito | Implementação |
|---|---|
| Confirmação e acesso | `GET /api/v1/me` e `GET /api/v1/me/export` |
| Portabilidade | `GET /api/v1/me/export` (JSON com conta, fichas, itens, habilidades, mesas, eventos e bloqueios). No app: Conta → "Exportar meus dados" |
| Correção | `PATCH /api/v1/me`, `PATCH /api/v1/characters/{id}` |
| Eliminação | `DELETE /api/v1/me`. Apaga fichas e retratos **na hora**, fecha as mesas em que a pessoa é Mestre, remove participações, tokens e bloqueios, desvincula o log e anonimiza a conta. `python -m app.cli purge` remove a linha em 30 dias. Também pela web (`accountDeletionUrl`) |
| Revogação do consentimento | Excluir a conta. Não há tratamento baseado só em consentimento além do aceite dos termos |

## Segurança

- TLS obrigatório (Cloud Run): o app usa `https://` e `wss://` em produção.
- Senhas com Argon2id (`argon2-cffi`). JWT de acesso de 15 min. Refresh token opaco, **de uso único** (rotação), guardado só como SHA-256.
- WebSocket autenticado na **1ª mensagem** (o token nunca vai na URL, que acaba em logs de proxy).
- Rate limit em login, PIN de sala, rolagens, dano/cura e upload.
- Upload de imagem: limite de 5 MB, proteção contra *decompression bomb*, reencode (descarta EXIF/GPS), bucket privado com URLs assinadas de 1 h.
- No aparelho: tokens no `expo-secure-store` (Android Keystore) e `allowBackup=false`.
- Segredos (`RPG_JWT_SECRET`, credenciais do banco) no Secret Manager. Em produção o app **recusa** subir com o segredo de dev (`core/config.py`).

## Formulário Data Safety

| Pergunta do Play Console | Resposta |
|---|---|
| O app coleta ou compartilha dados? | Coleta: sim. Compartilha com terceiros: **não** (GCP é operador/processador) |
| Informações pessoais → E-mail | Coletado · obrigatório · finalidade: gerenciamento de conta |
| Informações pessoais → Nome | Coletado (nome de exibição/apelido) · obrigatório · funcionalidade do app |
| Fotos e vídeos → Fotos | Coletado · **opcional** · funcionalidade do app (retrato) |
| Atividade no app → Outro conteúdo gerado pelo usuário | Coletado (fichas, nomes, log da mesa) · funcionalidade do app |
| Localização, contatos, IDs de dispositivo/publicidade, dados financeiros, saúde | **Não coletados** |
| Dados criptografados em trânsito? | Sim |
| O usuário pode pedir a exclusão? | Sim: no app e pela URL web |

## Crianças e adolescentes

O público-alvo é 13+. O cadastro exige a confirmação "Tenho 13 anos ou mais" (o servidor recusa sem ela). Não direcionamos o app a crianças nem participamos do programa Families. Se o público mudar, a LGPD (art. 14) exige consentimento específico de um dos pais, e isso muda o fluxo de cadastro.
