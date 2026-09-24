"""Formato dos pacotes de regras. Adicionar um sistema novo = adicionar um JSON validado por estes modelos."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from app.models.enums import RulesetStatus


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class AttributeDef(_Strict):
    key: str
    name: str
    abbr: str


class ModifierRule(_Strict):
    # dnd: (valor - 10) // 2 · raw: o próprio valor · none: sistema sem modificador
    strategy: Literal["dnd", "raw", "none"] = "dnd"


class PointBuy(_Strict):
    budget: int
    costs: dict[str, int]  # {"8": 0, "9": 1, ...}; chaves são os valores permitidos


class ScoreRange(_Strict):
    min: int
    max: int


class GenerationMethods(_Strict):
    standard_array: list[int] | None = None
    point_buy: PointBuy | None = None
    roll: str | None = None  # notação por atributo, ex. "4d6kh3"
    manual: ScoreRange = ScoreRange(min=1, max=20)


class BonusChoice(_Strict):
    count: int
    amount: int
    exclude: list[str] = []


class TraitEffects(_Strict):
    """Efeitos mecânicos que o app aplica sozinho nas estatísticas derivadas (Savage Worlds e GURPS)."""

    charisma: int = 0
    parry: int = 0
    toughness: int = 0
    pace: int = 0
    bennies: int = 0
    attribute_points: int = 0
    skill_points: int = 0
    # GURPS: Aptidão Mágica soma o nível às mágicas.
    spell_bonus_per_level: int = 0


class Ancestry(_Strict):
    key: str
    name: str
    source_name: str | None = None
    description: str = ""
    # Savage Worlds: tipos de dado a mais no atributo inicial (Anões: {"vig": 1} = Vigor d6).
    bonuses: dict[str, int] = {}
    bonus_choices: BonusChoice | None = None
    speed: int | None = None
    hp_bonus_per_level: int = 0
    traits: list[str] = []
    effects: TraitEffects = TraitEffects()
    free_edges: int = 0
    # Características que a raça já traz (ex.: Complicação Desastrado dos elfos).
    granted_traits: list[str] = []
    # Perícias que começam num dado de graça (Atlante: {"nadar": 6}).
    free_skills: dict[str, int] = {}
    page: str | None = None


class CharacterClass(_Strict):
    key: str
    name: str
    source_name: str | None = None
    description: str = ""
    hit_die: int | None = None
    primary: list[str] = []
    # Ordem usada pela geração automática ("class_preset"): maior valor vai para o primeiro.
    attribute_priority: list[str]
    saving_throws: list[str] = []
    spell_slots_level1: dict[str, int] = {}


class Background(_Strict):
    key: str
    name: str
    source_name: str | None = None
    description: str = ""
    bonus_options: list[str] = []
    skills: list[str] = []


class BackgroundBonusRule(_Strict):
    # plus2_plus1: +2/+1 ou +1/+1/+1 entre os atributos do antecedente (regras 2024)
    strategy: Literal["none", "plus2_plus1"] = "none"


class CustomBonusRule(_Strict):
    """Pontos de atributo digitados pelo jogador para raça/origem personalizadas (sistemas livres)."""

    min: int = -5
    max: int = 5


class LevelUpRule(_Strict):
    max_level: int = 20
    # Níveis que dão pontos de atributo e quantos (5ª edição: +2 nos níveis 4, 8, 12, 16 e 19).
    asi_levels: list[int] = []
    asi_points: int = 0
    attribute_max: int | None = None
    # Sistemas livres: a cada nível o jogador soma os pontos que a mesa combinou, à mão.
    free_points: bool = False


class HpRule(_Strict):
    # engine: o motor do sistema calcula (GURPS: PV = ST + comprados; Savage: 3 ferimentos).
    strategy: Literal["hit_die_max_plus_mod", "fixed", "manual", "engine"]
    attribute: str | None = None
    value: int | None = None
    minimum: int = 1


class CarryRule(_Strict):
    # basic_lift: Base de Carga do GURPS (ST² / 10 kg).
    strategy: Literal["attribute_multiplier", "fixed", "basic_lift"]
    attribute: str | None = None
    multiplier: float | None = None
    value: float | None = None
    unit: Literal["lb", "kg"] = "kg"


class CritRuleModel(_Strict):
    sides: int
    success: list[int] = []
    failure: list[int] = []


class DiceRules(_Strict):
    default_check: str = "1d20"
    direction: Literal["high", "low"] = "high"
    generic_crits: bool = True
    crit_rules: list[CritRuleModel] = []


class TraitCost(_Strict):
    """Custo em pontos de uma vantagem/desvantagem do GURPS, como aparece na lista do livro."""

    fixed: int | None = None
    options: list[int] = []
    min: int | None = None
    max: int | None = None
    # Por nível (ou por unidade: "apetrecho", "vida"...), às vezes com mais de uma opção e um valor base.
    per_level: list[int] = []
    base: int = 0
    unit: str | None = None
    variable: bool = False
    # Desvantagem com número de autocontrole (o custo muda com 6, 9, 12 ou 15).
    self_control: bool = False


class TraitRequirements(_Strict):
    """Requisitos das Vantagens e Poderes do Savage Worlds (0 = Novato ... 4 = Lendário)."""

    rank: int = Field(default=0, ge=0, le=4)
    wild_card: bool = False
    attributes: dict[str, int] = {}
    skills: dict[str, int] = {}
    edges: list[str] = []
    # O que o app não confere sozinho (ex.: "Atirar ou Lutar d10+"): aparece para o Mestre decidir.
    other: list[str] = []
    text: str = ""


class TraitDef(_Strict):
    key: str
    name: str
    kind: Literal["advantage", "disadvantage", "perk", "quirk", "edge", "hindrance", "power"]
    category: str = ""
    tags: list[str] = []
    cost: TraitCost | None = None
    severity: Literal["minor", "major", "either"] | None = None
    requirements: TraitRequirements | None = None
    effects: TraitEffects = TraitEffects()
    # Poderes: Pontos de Poder, Distância, Duração.
    info: dict[str, str] = {}
    page: str | None = None


class SkillDef(_Strict):
    key: str
    name: str
    # Atributo dominante; no GURPS também "will" (Vontade) e "per" (Percepção).
    attribute: str
    difficulty: Literal["F", "M", "D", "MD"] | None = None
    # GURPS: valor pré-definido a partir do atributo (ex.: -5 = DX-5). None = não dá para usar sem treino.
    default: int | None = None
    specialize: bool = False
    category: str = ""
    group: str = ""
    page: str | None = None


class GurpsRules(_Strict):
    starting_points: int = 150
    # Limite de desvantagens: porcentagem dos pontos iniciais (padrão do livro: 50%).
    disadvantage_limit_percent: int = 50
    quirk_limit: int = 5
    # Tabela de dano: [ST, GdP, GeB].
    damage: list[tuple[int, str, str]] = []


class SavageRules(_Strict):
    attribute_points: int = 5
    skill_points: int = 15
    hindrance_points_max: int = 4
    major_hindrances_max: int = 1
    minor_hindrances_max: int = 2
    base_pace: int = 6
    bennies: int = 3
    starting_funds: int = 500
    xp_per_advance: int = 5
    legendary_xp: int = 80
    legendary_xp_per_advance: int = 10
    ranks: list[str] = ["Novato", "Experiente", "Veterano", "Heroico", "Lendário"]


GURPS_ATTRIBUTES = {"st", "dx", "iq", "ht"}
SAVAGE_ATTRIBUTES = {"agi", "ast", "esp", "for", "vig"}


class RulesetPack(_Strict):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9.-]{1,63}$")
    name: str
    short_name: str
    version: str
    status: RulesetStatus = RulesetStatus.AVAILABLE
    language: str = "pt-BR"
    # Cabe na coluna rulesets.license (40).
    license: str = Field(max_length=40)
    license_url: str | None = None
    attribution: str = ""
    source_url: str | None = None
    description: str = ""

    attributes: list[AttributeDef]
    modifier: ModifierRule = ModifierRule()
    generation: GenerationMethods
    ancestry_label: str = "Raça"
    background_label: str = "Antecedente"
    ancestries: list[Ancestry] = []
    classes: list[CharacterClass] = []
    backgrounds: list[Background] = []
    background_bonus: BackgroundBonusRule = BackgroundBonusRule()
    # Permite texto livre em raça/classe/antecedente (sistemas genéricos e homebrew).
    allow_custom: bool = False
    # Com texto livre: pontos de atributo da raça/origem digitados pelo jogador.
    custom_bonus: CustomBonusRule | None = None
    # Escolhas obrigatórias mesmo sem lista de opções no pacote (o jogador digita).
    custom_required: list[Literal["ancestry", "background"]] = []
    hp: HpRule
    carry: CarryRule
    dice: DiceRules = DiceRules()
    level_up: LevelUpRule = LevelUpRule()
    # classic: raça/classe/antecedente + atributos (5ª edição, genérico). gurps e savage: motores próprios.
    engine: Literal["classic", "gurps", "savage"] = "classic"
    skills: list[SkillDef] = []
    traits: list[TraitDef] = []
    gurps: GurpsRules | None = None
    savage: SavageRules | None = None
    _trait_index: dict[str, TraitDef] = PrivateAttr(default_factory=dict)
    _skill_index: dict[str, SkillDef] = PrivateAttr(default_factory=dict)

    @model_validator(mode="after")
    def _check_references(self) -> "RulesetPack":
        keys = {a.key for a in self.attributes}
        self._check_engine(keys)
        for anc in self.ancestries:
            unknown = set(anc.bonuses) - keys
            if unknown:
                raise ValueError(f"{anc.key}: atributos desconhecidos {unknown}")
        for cls in self.classes:
            if set(cls.attribute_priority) != keys:
                raise ValueError(f"{cls.key}: attribute_priority precisa listar todos os atributos")
        for bg in self.backgrounds:
            if set(bg.bonus_options) - keys:
                raise ValueError(f"{bg.key}: bonus_options com atributo desconhecido")
        for rule in (self.hp.attribute, self.carry.attribute):
            if rule is not None and rule not in keys:
                raise ValueError(f"atributo desconhecido: {rule}")
        if self.custom_bonus and not self.allow_custom:
            raise ValueError("custom_bonus exige allow_custom")
        if self.level_up.asi_levels and self.level_up.asi_points <= 0:
            raise ValueError("asi_levels sem asi_points")
        std = self.generation.standard_array
        if std is not None and len(std) != len(self.attributes):
            raise ValueError("standard_array precisa ter um valor por atributo")
        return self

    def _check_engine(self, keys: set[str]) -> None:
        if self.engine == "gurps":
            if keys != GURPS_ATTRIBUTES or self.gurps is None:
                raise ValueError("GURPS precisa dos atributos st, dx, iq, ht e do bloco gurps")
        if self.engine == "savage":
            if keys != SAVAGE_ATTRIBUTES or self.savage is None:
                raise ValueError("Savage Worlds precisa dos atributos agi, ast, esp, for, vig e do bloco savage")
        if self.engine != "classic" and self.hp.strategy != "engine":
            raise ValueError("Sistemas com motor próprio usam hp.strategy = engine")
        trait_keys = [t.key for t in self.traits]
        skill_keys = [s.key for s in self.skills]
        for label, items in (("característica", trait_keys), ("perícia", skill_keys)):
            dupes = {k for k in items if items.count(k) > 1}
            if dupes:
                raise ValueError(f"{label} repetida: {dupes}")
        skill_attrs = keys | ({"will", "per"} if self.engine == "gurps" else set())
        for skill in self.skills:
            if skill.attribute not in skill_attrs:
                raise ValueError(f"{skill.key}: atributo desconhecido {skill.attribute}")
        known_traits, known_skills = set(trait_keys), set(skill_keys)
        for trait in self.traits:
            if (
                self.engine == "gurps"
                and trait.kind in ("advantage", "disadvantage", "perk", "quirk")
                and trait.cost is None
            ):
                raise ValueError(f"{trait.key}: sem custo")
            req = trait.requirements
            if req is None:
                continue
            if set(req.attributes) - keys or set(req.skills) - known_skills or set(req.edges) - known_traits:
                raise ValueError(f"{trait.key}: requisito aponta para algo que não existe")
        for anc in self.ancestries:
            if set(anc.granted_traits) - known_traits or set(anc.free_skills) - known_skills:
                raise ValueError(f"{anc.key}: característica ou perícia desconhecida")

    def model_post_init(self, context: object, /) -> None:
        self._trait_index = {t.key: t for t in self.traits}
        self._skill_index = {s.key: s for s in self.skills}

    def trait(self, key: str) -> TraitDef | None:
        return self._trait_index.get(key)

    def skill(self, key: str) -> SkillDef | None:
        return self._skill_index.get(key)

    def attribute_keys(self) -> list[str]:
        return [a.key for a in self.attributes]

    def ancestry(self, key: str) -> Ancestry | None:
        return next((a for a in self.ancestries if a.key == key), None)

    def character_class(self, key: str) -> CharacterClass | None:
        return next((c for c in self.classes if c.key == key), None)

    def background(self, key: str) -> Background | None:
        return next((b for b in self.backgrounds if b.key == key), None)


class CatalogEntry(_Strict):
    """Sistemas pesquisados que ainda não têm pacote (planejados) ou dependem de licença (restritos)."""

    id: str
    name: str
    status: Literal[RulesetStatus.PLANNED, RulesetStatus.RESTRICTED]
    license: str
    license_url: str | None = None
    notes: str
