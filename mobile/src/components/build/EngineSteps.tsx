/**
 * Passos do wizard (e da edição) para GURPS e Savage Worlds. Cada toque salva na hora; o que o servidor
 * calculou (pontos, NH, derivadas, avisos) aparece logo abaixo.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { HelperText, Text, useTheme } from 'react-native-paper';

import type { Character, GurpsBuild, GurpsSheet, RulesetPack, SavageBuild, SavageSheet, TraitKind } from '../../lib/types';
import { BuildBudget, GurpsAttributes, SavageAttributes } from './AttributeSteppers';
import { SkillPicker, type SkillEntry } from './SkillPicker';
import { TraitPicker, type TraitEntry } from './TraitPicker';
import { useBuildEditor } from './useBuildEditor';

export type EngineStepId = 'points' | 'advantages' | 'disadvantages' | 'skills' | 'hindrances' | 'dice' | 'edges' | 'powers';

export const GURPS_STEPS: { id: EngineStepId; label: string }[] = [
  { id: 'points', label: 'Atributos' },
  { id: 'advantages', label: 'Vantagens' },
  { id: 'disadvantages', label: 'Desvantagens' },
  { id: 'skills', label: 'Perícias' },
];

export const SAVAGE_STEPS: { id: EngineStepId; label: string }[] = [
  { id: 'hindrances', label: 'Complicações' },
  { id: 'dice', label: 'Atributos' },
  { id: 'skills', label: 'Perícias' },
  { id: 'edges', label: 'Vantagens' },
];

const KINDS: Partial<Record<EngineStepId, TraitKind[]>> = {
  advantages: ['advantage', 'perk'],
  disadvantages: ['disadvantage', 'quirk'],
  hindrances: ['hindrance'],
  edges: ['edge'],
  powers: ['power'],
};

const HELP: Partial<Record<EngineStepId, string>> = {
  advantages: 'Vantagens custam pontos. As Qualidades (1 ponto) também ficam aqui.',
  disadvantages: 'Desvantagens e peculiaridades devolvem pontos. Até 5 peculiaridades de -1.',
  hindrances: 'Até 1 Complicação Maior (2 pontos) e 2 Menores (1 ponto cada). Os pontos compram atributos (2), Vantagens (2) ou perícias (1).',
  edges: 'Na criação só Vantagens de Novato. Humanos ganham uma de graça.',
  powers: 'Poderes do seu Antecedente Arcano (confira quantos começam com o Mestre).',
};

type Props = {
  pack: RulesetPack;
  character: Character;
  step: EngineStepId;
  onSaved: (c: Character) => void;
  onSaving?: (saving: boolean) => void;
};

export function EngineSteps({ pack, character, step, onSaved, onSaving }: Props) {
  const theme = useTheme();
  const editor = useBuildEditor<Record<string, unknown>>(character, onSaved);
  const { build, update, saving, error } = editor;
  const sheet = character.sheet ?? null;
  const complete = character.status === 'complete';

  useEffect(() => {
    onSaving?.(saving);
  }, [saving, onSaving]);

  const traits = (build.traits ?? []) as TraitEntry[];
  const skills = (build.skills ?? []) as SkillEntry[];
  const ancestry = pack.ancestries.find((a) => a.key === character.ancestry_key);
  const startDice = Object.fromEntries(pack.attributes.map((a) => [a.key, [4, 6, 8, 10, 12][ancestry?.bonuses[a.key] ?? 0] ?? 4]));
  const hasArcane = traits.some((t) => t.key === 'antecedente-arcano');

  let body = null;
  if (step === 'points' && pack.engine === 'gurps') {
    body = (
      <GurpsAttributes
        pack={pack}
        build={build as unknown as GurpsBuild}
        sheet={sheet?.engine === 'gurps' ? (sheet as GurpsSheet) : undefined}
        editableStart={!complete}
        onChange={(patch) => update(patch as Record<string, unknown>)}
      />
    );
  } else if (step === 'dice' && pack.engine === 'savage') {
    body = <SavageAttributes pack={pack} build={build as unknown as SavageBuild} start={startDice} onChange={(patch) => update(patch as Record<string, unknown>)} />;
  } else if (step === 'skills') {
    body = <SkillPicker pack={pack} entries={skills} sheet={sheet} minDie={ancestry?.free_skills ?? {}} onChange={(next) => update({ skills: next })} />;
  } else if (KINDS[step]) {
    const kinds = KINDS[step]!;
    body = (
      <>
        <TraitPicker
          pack={pack}
          kinds={kinds}
          entries={traits}
          computed={sheet?.traits ?? []}
          onChange={(next) => update({ traits: next })}
          emptyText={step === 'hindrances' ? 'Sem Complicações (dá para jogar assim, mas sem pontos extras).' : undefined}
        />
        {step === 'edges' && hasArcane ? (
          <View style={{ gap: 8, marginTop: 8 }}>
            <Text variant="titleMedium">Poderes</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              {HELP.powers}
            </Text>
            <TraitPicker pack={pack} kinds={['power']} entries={traits} computed={sheet?.traits ?? []} onChange={(next) => update({ traits: next })} />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {!complete || pack.engine === 'gurps' ? <BuildBudget sheet={sheet} /> : null}
      {HELP[step] ? (
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {HELP[step]}
        </Text>
      ) : null}
      {error ? <HelperText type="error">{error}</HelperText> : null}
      {body}
    </View>
  );
}

/** Revisão: derivadas, pontos e avisos da ficha calculada pelo servidor. */
export function EngineReview({ character }: { character: Character }) {
  const theme = useTheme();
  const sheet = character.sheet;
  if (!sheet) return null;
  return (
    <View style={{ gap: 8 }}>
      <BuildBudget sheet={sheet} />
      <Text>
        {sheet.derived.map((d) => `${d.label} ${d.value}`).join(' · ')}
      </Text>
      {sheet.engine === 'savage' ? (
        <Text>{(sheet as SavageSheet).attributes.map((a) => `${a.name} ${a.label}`).join(' · ')}</Text>
      ) : null}
      <Text style={{ color: theme.colors.onSurfaceVariant }}>
        {sheet.skills.map((s) => `${s.name} ${'level' in s ? s.level : s.label}`).join(' · ') || 'Sem perícias.'}
      </Text>
      {sheet.warnings.map((w) => (
        <HelperText key={w} type="info">
          {w}
        </HelperText>
      ))}
    </View>
  );
}
