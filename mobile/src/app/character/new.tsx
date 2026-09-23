/**
 * Wizard de criação: Sistema → Identidade (nome/foto) → Raça → Classe → Atributos → Antecedente → Revisão.
 * Cada "Próximo" salva o rascunho no servidor; fechar o app no meio não perde nada.
 */
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, Portal, RadioButton, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { Screen } from '../../components/common/Screen';
import { AttributeStep } from '../../components/wizard/AttributeStep';
import { OptionList } from '../../components/wizard/OptionList';
import { WizardProgress } from '../../components/wizard/WizardProgress';
import { api, ApiError } from '../../lib/api';
import { absoluteUrl } from '../../lib/config';
import { choosePortrait, PortraitSource } from '../../lib/portrait';
import { keys, useRulesetPack, useRulesets } from '../../lib/queries';
import type { AttributeMethod, Character } from '../../lib/types';

type StepId = 'system' | 'identity' | 'ancestry' | 'class' | 'attributes' | 'background' | 'review';

export default function NewCharacterScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ rulesetId?: string; draftId?: string }>();
  const { data: rulesets } = useRulesets();

  const [rulesetId, setRulesetId] = useState<string | null>(params.rulesetId ?? null);
  const [draft, setDraft] = useState<Character | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState('');
  const [customName, setCustomName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraRationale, setCameraRationale] = useState(false);
  const [bonusMode, setBonusMode] = useState<'21' | '111'>('21');

  const { data: pack } = useRulesetPack(rulesetId);

  const steps = useMemo<{ id: StepId; label: string }[]>(() => {
    const list: { id: StepId; label: string }[] = [];
    if (!params.rulesetId && !params.draftId) list.push({ id: 'system', label: 'Sistema' });
    list.push({ id: 'identity', label: 'Identidade' });
    if (pack?.ancestries.length || pack?.allow_custom) list.push({ id: 'ancestry', label: pack?.ancestry_label ?? 'Raça' });
    list.push({ id: 'class', label: 'Classe' });
    list.push({ id: 'attributes', label: 'Atributos' });
    if (pack?.backgrounds.length || pack?.allow_custom) list.push({ id: 'background', label: 'Antecedente' });
    list.push({ id: 'review', label: 'Revisão' });
    return list;
  }, [pack, params.rulesetId, params.draftId]);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  // Retomar rascunho.
  useEffect(() => {
    if (!params.draftId) return;
    void api.character(params.draftId).then((c) => {
      setDraft(c);
      setRulesetId(c.ruleset_id);
      setName(c.name);
      setStepIndex(Math.max(0, c.wizard_step));
    });
  }, [params.draftId]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Algo deu errado.');
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: Record<string, unknown>) =>
    run(async () => {
      const updated = await api.patchCharacter(draft!.id, body);
      setDraft(updated);
      return updated;
    });

  const next = async () => {
    let current: Character | null | undefined = draft;
    if (step.id === 'identity') {
      current = await run(async () => {
        const c = draft ? await api.patchCharacter(draft.id, { name }) : await api.createDraft(rulesetId!, name);
        setDraft(c);
        return c;
      });
      if (!current) return;
    }
    // Autosave do passo: ao reabrir o rascunho, o wizard volta exatamente aqui.
    if (current) await api.patchCharacter(current.id, { wizard_step: stepIndex + 1 }).catch(() => undefined);
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  };

  const pickPortrait = async (source: PortraitSource) => {
    setCameraRationale(false);
    const result = await run(() => choosePortrait(source));
    if (result && draft) await patch({ portrait_key: result.portraitKey });
    else if (result && !draft) {
      const c = await run(() => api.createDraft(rulesetId!, name || 'Sem nome'));
      if (c) {
        setDraft(c);
        const updated = await api.patchCharacter(c.id, { portrait_key: result.portraitKey });
        setDraft(updated);
      }
    }
  };

  const generate = (method: AttributeMethod, scores?: Record<string, number>) =>
    run(async () => {
      const updated = await api.generateAttributes(draft!.id, method, scores);
      setDraft(updated);
      return updated;
    });

  const finalize = async () => {
    const done = await run(() => api.finalize(draft!.id));
    if (done) {
      await queryClient.invalidateQueries({ queryKey: keys.characters });
      router.replace({ pathname: '/character/[id]', params: { id: done.id } });
    }
  };

  const ancestry = pack?.ancestries.find((a) => a.key === draft?.ancestry_key);
  const background = pack?.backgrounds.find((b) => b.key === draft?.background_key);
  const canNext =
    (step.id === 'system' && !!rulesetId) ||
    (step.id === 'identity' && name.trim().length > 0) ||
    (step.id === 'ancestry' && !!draft?.ancestry_key) ||
    (step.id === 'class' && !!draft?.class_key) ||
    (step.id === 'attributes' && Object.keys(draft?.attributes ?? {}).length > 0) ||
    step.id === 'background';

  return (
    <Screen>
      <WizardProgress steps={steps.map((s) => s.label)} current={Math.min(stepIndex, steps.length - 1)} />

      {step.id === 'system' ? (
        <RadioButton.Group value={rulesetId ?? ''} onValueChange={setRulesetId}>
          {rulesets
            ?.filter((r) => r.status === 'available')
            .map((r) => <RadioButton.Item key={r.id} value={r.id} label={`${r.name}\n${r.description}`} position="leading" labelVariant="bodyMedium" />)}
        </RadioButton.Group>
      ) : null}

      {step.id === 'identity' ? (
        <View style={styles.identity}>
          {draft?.portrait_url ? (
            <Image source={{ uri: absoluteUrl(draft.portrait_url) }} style={styles.portrait} accessibilityLabel="Retrato do personagem" />
          ) : (
            <View style={[styles.portrait, { backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }]}>
              <Text variant="displaySmall">{(name || '?').slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Button icon="image" mode="outlined" onPress={() => pickPortrait('library')} disabled={busy}>
              Galeria
            </Button>
            <Button icon="camera" mode="outlined" onPress={() => setCameraRationale(true)} disabled={busy}>
              Tirar foto
            </Button>
          </View>
          <TextInput mode="outlined" label="Nome do personagem" value={name} onChangeText={setName} maxLength={60} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {step.id === 'ancestry' && pack ? (
        <>
          <OptionList
            options={pack.ancestries.map((a) => ({
              key: a.key,
              name: a.name,
              description: a.description,
              tags: [
                ...Object.entries(a.bonuses).map(([k, v]) => `${pack.attributes.find((x) => x.key === k)?.abbr} +${v}`),
                ...(a.speed ? [`${a.speed} pés`] : []),
              ],
            }))}
            selected={draft?.ancestry_key ?? null}
            onSelect={(key) => (key === 'custom' ? setCustomName('') : void patch({ ancestry_key: key }))}
            allowCustom={pack.allow_custom}
            customName={customName}
            onCustomName={setCustomName}
          />
          {pack.allow_custom && customName ? (
            <Button onPress={() => patch({ ancestry_key: 'custom', ancestry_name: customName })}>Usar “{customName}”</Button>
          ) : null}
          {ancestry?.bonus_choices ? (
            <View style={{ gap: 6 }}>
              <Text variant="titleSmall">Escolha {ancestry.bonus_choices.count} atributos para +{ancestry.bonus_choices.amount}</Text>
              <View style={styles.row}>
                {pack.attributes
                  .filter((a) => !ancestry.bonus_choices!.exclude.includes(a.key))
                  .map((a) => {
                    const picked = draft?.ancestry_choices ?? [];
                    const on = picked.includes(a.key);
                    return (
                      <Chip
                        key={a.key}
                        selected={on}
                        showSelectedOverlay
                        onPress={() => {
                          const nextPicked = on ? picked.filter((k) => k !== a.key) : [...picked, a.key].slice(-ancestry.bonus_choices!.count);
                          if (nextPicked.length === ancestry.bonus_choices!.count || nextPicked.length === 0) void patch({ ancestry_choices: nextPicked });
                          else setDraft(draft && { ...draft, ancestry_choices: nextPicked });
                        }}
                      >
                        {a.abbr}
                      </Chip>
                    );
                  })}
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {step.id === 'class' && pack ? (
        <OptionList
          options={pack.classes.map((c) => ({
            key: c.key,
            name: c.name,
            description: c.description,
            tags: [...(c.hit_die ? [`d${c.hit_die} de vida`] : []), ...c.primary.map((k) => pack.attributes.find((a) => a.key === k)?.name ?? k)],
          }))}
          selected={draft?.class_key ?? null}
          onSelect={(key) => void patch({ class_key: key })}
        />
      ) : null}

      {step.id === 'attributes' && pack && draft ? <AttributeStep pack={pack} character={draft} busy={busy} onGenerate={generate} /> : null}

      {step.id === 'background' && pack ? (
        <>
          <OptionList
            options={pack.backgrounds.map((b) => ({ key: b.key, name: b.name, description: b.description, tags: b.skills }))}
            selected={draft?.background_key ?? null}
            onSelect={(key) => (key === 'custom' ? setCustomName('') : void patch({ background_key: key }))}
            allowCustom={pack.allow_custom}
            customName={customName}
            onCustomName={setCustomName}
          />
          {pack.allow_custom && customName ? (
            <Button onPress={() => patch({ background_key: 'custom', background_name: customName })}>Usar “{customName}”</Button>
          ) : null}
          {pack.background_bonus.strategy === 'plus2_plus1' && background ? (
            <View style={{ gap: 8 }}>
              <Text variant="titleSmall">Bônus do antecedente</Text>
              <SegmentedButtons
                value={bonusMode}
                onValueChange={(v) => setBonusMode(v as '21' | '111')}
                density="small"
                buttons={[
                  { value: '21', label: '+2 / +1' },
                  { value: '111', label: '+1 / +1 / +1' },
                ]}
              />
              {bonusMode === '111' ? (
                <Button mode="outlined" onPress={() => patch({ background_bonus: Object.fromEntries(background.bonus_options.map((k) => [k, 1])) })}>
                  +1 em {background.bonus_options.map((k) => pack.attributes.find((a) => a.key === k)?.abbr).join(', ')}
                </Button>
              ) : (
                <View style={styles.row}>
                  {background.bonus_options.flatMap((two) =>
                    background.bonus_options
                      .filter((one) => one !== two)
                      .map((one) => {
                        const abbr = (k: string) => pack.attributes.find((a) => a.key === k)?.abbr;
                        const on = draft?.background_bonus[two] === 2 && draft?.background_bonus[one] === 1;
                        return (
                          <Chip key={`${two}-${one}`} selected={on} showSelectedOverlay onPress={() => patch({ background_bonus: { [two]: 2, [one]: 1 } })}>
                            {`${abbr(two)} +2 · ${abbr(one)} +1`}
                          </Chip>
                        );
                      }),
                  )}
                </View>
              )}
            </View>
          ) : null}
        </>
      ) : null}

      {step.id === 'review' && draft ? (
        <View style={{ gap: 8 }}>
          <Text variant="headlineSmall">{draft.name}</Text>
          <Text>{[draft.ancestry_name, draft.class_name, draft.background_name].filter(Boolean).join(' · ')}</Text>
          <Text>
            {pack?.attributes.map((a) => `${a.abbr} ${draft.attributes[a.key] ?? '-'}`).join('   ')}
          </Text>
          {draft.missing.length > 0 ? <HelperText type="error">Falta: {draft.missing.join(', ')}</HelperText> : null}
        </View>
      ) : null}

      {error ? <HelperText type="error">{error}</HelperText> : null}

      <View style={styles.nav}>
        <Button onPress={() => (stepIndex === 0 ? router.back() : setStepIndex((i) => i - 1))}>Voltar</Button>
        {step.id === 'review' ? (
          <Button mode="contained" icon="check-decagram" onPress={finalize} loading={busy} disabled={busy || (draft?.missing.length ?? 1) > 0}>
            Concluir personagem
          </Button>
        ) : (
          <Button mode="contained" onPress={next} loading={busy} disabled={busy || !canNext}>
            Próximo
          </Button>
        )}
      </View>

      <Portal>
        <Dialog visible={cameraRationale} onDismiss={() => setCameraRationale(false)}>
          <Dialog.Title>Usar a câmera?</Dialog.Title>
          <Dialog.Content>
            <Text>
              A câmera é usada só agora, para tirar a foto do retrato. A imagem é cortada e reduzida no seu aparelho antes de ser enviada, sem dados de localização.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setCameraRationale(false)}>Agora não</Button>
            <Button onPress={() => pickPortrait('camera')}>Continuar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: 12 },
  portrait: { width: 140, height: 140, borderRadius: 70 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
