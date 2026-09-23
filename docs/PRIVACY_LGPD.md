# Privacidade: LGPD / GDPR (uso doméstico)

O RPG Play roda num servidor **na casa de quem instala**. Não há nuvem, empresa intermediária, analytics nem anúncios: os dados das contas, fichas e campanhas ficam no disco desse servidor (`/var/lib/rpgplay`). Quem instala e administra o servidor (normalmente o Mestre) é quem guarda esses dados.

Para um grupo de amigos jogando em casa, a LGPD não se aplica a tratamento "por pessoa natural para fins exclusivamente particulares e não econômicos" (art. 4º, I). Mesmo assim, o sistema foi feito para respeitar os direitos do titular. E se um dia for usado de forma pública ou comercial (clube, loja, evento pago), este documento serve de base para a política de privacidade.

## Inventário de dados

| Dado | Onde fica | Para quê | Retenção |
|---|---|---|---|
| Usuário e nome de exibição | `users.username`, `users.display_name` | Login e identificação na mesa | Até a pessoa excluir a conta (anonimizados na hora) |
| Senha | `users.password_hash` (Argon2id) | Autenticação | Idem |
| E-mail | `users.email` (**opcional**; os apps não pedem) | — | Idem |
| Fichas de personagem | `characters`, itens e habilidades | Funcionalidade principal | Até apagar a ficha ou a conta |
| Retratos e mapas | `/var/lib/rpgplay/media` (JPEG **sem EXIF/GPS**) | Exibir na ficha e na mesa | Apagados com a ficha, a mesa ou a conta |
| Campanhas (cenas, inimigos, bonecos) | `scenes`, `npcs`, `tokens` | Mesa virtual | Até apagar a conta do Mestre; expurgo após `RPG_ROOM_RETENTION_DAYS` (365) dias sem atividade |
| Log das mesas | `session_events` | Histórico da sessão | **90 dias** (`RPG_EVENT_RETENTION_DAYS`) |
| Tokens de sessão | `refresh_tokens` (só o **hash**); no celular, Android Keystore | Manter o login | 90 dias ou logout. A redefinição de senha pelo admin derruba todas as sessões da pessoa |

**Não coletados:** localização, contatos, data de nascimento, identificadores de publicidade, analytics, gravações de áudio, lista de apps. A câmera só é usada na hora de tirar a foto do personagem ou de ler o QR code. **Rolagens fora de mesa não são gravadas.**

## Direitos do titular (art. 18)

| Direito | Onde |
|---|---|
| Acesso e portabilidade | App → Conta → **Exportar meus dados** (`GET /api/v1/me/export`: JSON com conta, fichas, mesas e eventos) |
| Correção | Editar a ficha no app; `PATCH /api/v1/me` |
| Eliminação | App → Conta → **Excluir minha conta** (`DELETE /api/v1/me`): apaga fichas, retratos e as mesas em que a pessoa é Mestre (com os mapas); remove participações e sessões; anonimiza a conta |
| Senha esquecida | O admin do servidor define uma nova (`sudo rpgplay-server reset-password <usuário>` ou pelo painel) e as sessões antigas caem |

## Segurança

Resumo (detalhes em [REDE_LOCAL.md](REDE_LOCAL.md#modelo-de-segurança)):

- Feito para a **rede de casa**: HTTP sem TLS dentro da LAN. **Nunca exponha a porta 8080 na internet.** Para jogar à distância, use uma VPN (Tailscale, WireGuard).
- Senhas com Argon2id; refresh token de uso único guardado como hash; segredo JWT gerado na instalação (permissão 600).
- Cada jogador só recebe o que pode ver: a própria cena, sem bonecos escondidos, e dos inimigos só o estado vago.
- Uploads reencodados (sem EXIF/GPS), com limite de tamanho e proteção contra *decompression bomb*.
- Serviço com usuário próprio e escrita só em `/var/lib/rpgplay`; backups com `rpgplay-server backup`.
- No celular: tokens no Android Keystore e `allowBackup=false` (nada vai para o backup em nuvem do Android).

## Menores de idade

Como é um sistema doméstico, não há verificação de idade no cadastro: quem administra o servidor decide quem entra (e pode fechar o cadastro com `RPG_ALLOW_REGISTRATION=false`). Se um dia o sistema for oferecido ao público, a LGPD (art. 14) exige consentimento específico de um dos pais para crianças, e o fluxo de cadastro precisa mudar.
