/**
 * Editar a ficha depois de pronta. GURPS: gastar os pontos ganhos (atributos, vantagens, perícias).
 * Savage Worlds: só os Poderes; o resto muda por Progresso (na ficha, "Evoluir").
 */
import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { SegmentedButtons, Text } from 'react-native-paper';

import { EngineSteps, GURPS_STEPS, type EngineStepId } from '../../components/build/EngineSteps';
import { Screen } from '../../components/common/Screen';
import { keys, useCharacter, useRulesetPack } from '../../lib/queries';
import type { Character } from '../../lib/types';

const SAVAGE_EDIT: { id: EngineStepId; label: string }[] = [{ id: 'powers', label: 'Poderes' }];

export default function EditCharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: character } = useCharacter(id);
  const { data: pack } = useRulesetPack(character?.ruleset_id);
  const steps = pack?.engine === 'gurps' ? GURPS_STEPS : SAVAGE_EDIT;
  const [step, setStep] = useState<EngineStepId>(steps[0]!.id);
  const onSaved = useCallback((c: Character) => queryClient.setQueryData(keys.character(id), c), [id, queryClient]);

  if (!character || !pack) {
    return (
      <Screen>
        <Text>Carregando ficha…</Text>
      </Screen>
    );
  }
  const current = steps.some((s) => s.id === step) ? step : steps[0]!.id;
  return (
    <>
      <Stack.Screen options={{ title: `Editar ${character.name}` }} />
      <Screen>
        {steps.length > 1 ? (
          <SegmentedButtons value={current} onValueChange={(v) => setStep(v as EngineStepId)} density="small" buttons={steps.map((s) => ({ value: s.id, label: s.label }))} />
        ) : null}
        <EngineSteps key={character.id} pack={pack} character={character} step={current} onSaved={onSaved} />
      </Screen>
    </>
  );
}
