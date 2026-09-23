"""Formato dos pacotes de regras. Adicionar um sistema novo = adicionar um JSON validado por estes modelos."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class Ancestry(_Strict):
    key: str
    name: str
    source_name: str | None = None
    description: str = ""
    bonuses: dict[str, int] = {}
    bonus_choices: BonusChoice | None = None
    speed: int | None = None
    hp_bonus_per_level: int = 0
    traits: list[str] = []


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


class HpRule(_Strict):
    strategy: Literal["hit_die_max_plus_mod", "fixed", "manual"]
    attribute: str | None = None
    value: int | None = None
    minimum: int = 1


class CarryRule(_Strict):
    strategy: Literal["attribute_multiplier", "fixed"]
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


class RulesetPack(_Strict):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9.-]{1,63}$")
    name: str
    short_name: str
    version: str
    status: RulesetStatus = RulesetStatus.AVAILABLE
    language: str = "pt-BR"
    license: str
    license_url: str | None = None
    attribution: str = ""
    source_url: str | None = None
    description: str = ""

    attributes: list[AttributeDef]
    modifier: ModifierRule = ModifierRule()
    generation: GenerationMethods
    ancestry_label: str = "Raça"
    ancestries: list[Ancestry] = []
    classes: list[CharacterClass] = []
    backgrounds: list[Background] = []
    background_bonus: BackgroundBonusRule = BackgroundBonusRule()
    # Permite texto livre em raça/classe/antecedente (sistemas genéricos e homebrew).
    allow_custom: bool = False
    hp: HpRule
    carry: CarryRule
    dice: DiceRules = DiceRules()

    @model_validator(mode="after")
    def _check_references(self) -> "RulesetPack":
        keys = {a.key for a in self.attributes}
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
        std = self.generation.standard_array
        if std is not None and len(std) != len(self.attributes):
            raise ValueError("standard_array precisa ter um valor por atributo")
        return self

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
