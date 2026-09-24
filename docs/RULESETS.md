# Sistemas de regras: pesquisa de licenças e formato dos pacotes

O Mestre **escolhe o sistema de regras antes de criar a sala** (`POST /api/v1/rooms {ruleset_id}`), e o sistema fica fixo na sala. Personagens só entram numa mesa do mesmo sistema. O servidor valida (`services/rooms.py::_validate_character`).

Para caber num app distribuído (mesmo que só como APK para o grupo), a licença do sistema precisa permitir **software** e, idealmente, **uso comercial**, para o projeto poder crescer sem reescrever o conteúdo. A pesquisa abaixo foi feita em setembro/2026.

> ⚖️ Isto é um levantamento técnico, não parecer jurídico. Antes de publicar, confirme cada licença com um advogado.

## Situação por sistema

| Sistema | Licença | Permite app? | Status no RPG Play | Observações |
|---|---|---|---|---|
| **5ª Edição, SRD 5.1** (2014) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/legalcode) | ✅ Sim | **Disponível** (`srd-5.1`) | Exige atribuição (texto no pacote, exibido no app). CC-BY não licencia marcas: usar "compatível com a 5ª edição", nunca "D&D" como nome. |
| **5ª Edição 2024, SRD 5.2.1** | CC-BY-4.0 | ✅ Sim | **Disponível** (`srd-5.2`) | Publicado em 22/04/2025. Wizards declarou que SRDs futuros também sairão em CC-BY-4.0, e a licença é irrevogável. |
| **Genérico / homebrew** | Original | ✅ Sim | **Disponível** (`generico`) | Raça e origem digitadas pelo jogador, com os pontos de atributo de cada uma; classe da lista ou em texto livre. Serve de "ficha em branco" para sistemas cuja licença não permite regras em apps. |
| **Old Dragon 2** (SRD) | CC-BY-SA-4.0 | ✅ Sim | Planejado | SRD aberto e irrevogável, com uso comercial. O *share-alike* se aplica ao **pacote de dados** (JSON), não ao código do app, se mantido separado. Sistema brasileiro: próximo da fila. |
| **Pathfinder 2e Remaster** | ORC | ✅ Sim | Planejado | Regras sob ORC. Nomes, marcas e cenário são *Reserved Material*: não podem aparecer como nome do sistema no app. |
| **Basic Roleplaying** (d100) | ORC | ✅ Sim | Planejado | Percentual *roll-under*: usa `direction: "low"` na classificação dos dados (já suportado). Conteúdo de Call of Cthulhu é proibido. |
| **Fate Core / Accelerated** | CC-BY-3.0 | ✅ Sim | Planejado | Usa dados Fudge (4dF). O motor de dados precisa ganhar o tipo `dF`. |
| **Cypher System** | Cypher System Open License | ✅ Sim | Planejado | Conferir exigências de logo/atribuição da CSOL. |
| **Year Zero Engine** | Free Tabletop License | ✅ Sim | Planejado | Parada de d6 com contagem de sucessos: precisa de um modo de classificação "por sucessos". |
| **Forged in the Dark** | CC-BY-3.0 | ✅ Sim | Planejado | Parada de d6, vale o maior resultado. Mesmo requisito acima. |
| **Daggerheart** | Darrington Press Community Gaming License | ⚠️ Incerto | Restrito | A licença cobre suplementos impressos/digitais e streams, mas **não cobre explicitamente aplicativos**. Só com autorização por escrito. |
| **Ordem Paranormal** | Licença da Comunidade (jun/2026) | ⚠️ Revisar | Restrito | Resumos indicam que permite vender material em apps, mas **não abre o sistema**: é licença de conteúdo de fã e comercial com condições. Precisa de leitura jurídica integral. |
| **Tormenta20 / 3DeT Victory** | Licença Aberta Jambô (jun/2026) | ❌ Não | **Excluído** | A licença **proíbe explicitamente aplicativos, sites e VTTs**. Só permite fichas preenchíveis. Para jogar Tormenta no app, use o sistema **Genérico** (ficha em branco, sem texto de regras). |
| Call of Cthulhu, GURPS, Savage Worlds, Vampiro… | Proprietárias | ❌ Não | Fora | Sem licença aberta para software. Só com contrato de licenciamento. |

Os sistemas "planejados" e "restritos" aparecem na tela de criação de mesa **desabilitados**, com o motivo, para o Mestre entender por que não pode escolhê-los. Eles vêm de `backend/app/rulesets/data/catalog.json`.

## Atribuições exigidas (exibidas no app)

- **SRD 5.1:** *"This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode."*
- **SRD 5.2.1:** *"This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode."*

As duas acompanham a nota "Tradução e adaptação para o português por RPG Play", porque a CC-BY exige indicar as modificações.

## O que os pacotes trazem hoje

Os pacotes trazem só o **necessário para criar o personagem rápido**, com descrições curtas escritas por nós (não é cópia do texto do SRD):

- **srd-5.1**: 9 raças (a sub-raça que o SRD inclui: Anão da Colina, Alto Elfo, Halfling Pés-Leves, Gnomo das Rochas, mais Humano, Draconato, Meio-Elfo, Meio-Orc, Tiferino), 12 classes, antecedente Acólito, arranjo padrão / compra de 27 pontos / 4d6kh3.
- **srd-5.2**: 9 espécies (inclui Golias e Orc), 12 classes, 4 antecedentes (Acólito, Criminoso, Sábio, Soldado) com bônus +2/+1 ou +1/+1/+1.
- **generico**: 6 atributos neutros, 4 arquétipos para a geração automática. **Raça e origem são obrigatórias e digitadas**, cada uma com pontos de atributo à mão (de -5 a +5 por atributo, `custom_bonus`). Ao subir de nível, o jogador informa os PV ganhos e soma até 10 pontos de atributo (`level_up.free_points`), até o nível 30.
- **srd-5.1 / srd-5.2**: ao subir de nível, os PV vêm da classe (dado cheio no 1º nível, média fixa depois) e os níveis 4, 8, 12, 16 e 19 dão +2 em atributos (ou nada, para quem pega um talento), sem passar de 20.

> 🔎 Os dados foram digitados a partir do conhecimento dos SRDs. **Confira contra o documento oficial antes do lançamento**, principalmente bônus, deslocamento, dados de vida e espaços de magia do nível 1.

## Como adicionar um sistema

1. Crie `backend/app/rulesets/data/<id>.json` seguindo `RulesetPack` (`backend/app/rulesets/schema.py`). O Pydantic valida as referências cruzadas: toda classe precisa ordenar **todos** os atributos em `attribute_priority`, os bônus só podem citar atributos existentes etc.
2. Escolha as estratégias declarativas (sem fórmulas livres, sem `eval`):
   - `modifier.strategy`: `dnd` · `raw` · `none`
   - `hp.strategy`: `hit_die_max_plus_mod` · `fixed` · `manual`
   - `carry.strategy`: `attribute_multiplier` · `fixed`
   - `background_bonus.strategy`: `none` · `plus2_plus1`
   - `custom_bonus` (`{min, max}`) com `allow_custom`: pontos de atributo digitados para raça/antecedente personalizados
   - `custom_required`: `ancestry`/`background` obrigatórios mesmo sem lista de opções (o jogador digita)
   - `ancestry_label` / `background_label`: como o app chama cada passo (Raça, Espécie, Origem, Antecedente…)
   - `level_up`: `max_level`, `asi_levels` + `asi_points` + `attribute_max` (pontos em níveis fixos) ou `free_points` (livre)
   - `dice`: `crit_rules` (faces de crítico por tipo de dado), `direction` (`high`/`low` para roll-under), `generic_crits`
3. Remova a entrada correspondente de `catalog.json`. O loader recusa o mesmo id nos dois lugares.
4. `pytest` valida o pacote. No startup, `sync_rulesets` faz upsert na tabela `rulesets`.
5. Se o sistema precisar de mecânica nova (dados Fudge, parada de sucessos), estenda `services/dice` **e** `mobile/src/lib/dice` e adicione casos em `shared/dice-outcome-vectors.json`.

## Fontes

- [D&D SRD 5.2.1 (D&D Beyond)](https://www.dndbeyond.com/srd) · [Anúncio do SRD 5.2 em CC](https://www.dndbeyond.com/posts/1949-you-can-now-publish-your-own-creations-using-the)
- [Licenças: Archives of Nethys (PF2e)](https://2e.aonprd.com/Licenses.aspx)
- [Old Dragon: Licenciamento](https://olddragon.com.br/licenciamento)
- [Chaosium: BRP SRD (ORC)](https://www.chaosium.com/brp-system-reference-document/)
- [Cypher System Open License](https://www.montecookgames.com/cypher-system-open-license/)
- [Free League: Free Tabletop Licenses](https://freeleaguepublishing.com/community-content/free-tabletop-licenses/)
- [Blades in the Dark: Licensing](https://bladesinthedark.com/licensing)
- [Darrington Press Community Gaming License](https://darringtonpress.com/license/)
- [Licença da Comunidade de Ordem Paranormal](https://ordemparanormal.com.br/licenca)
- [Licença Aberta Jambô (Tormenta20 / 3DeT)](https://jamboeditora.com.br/licenca-aberta/)
