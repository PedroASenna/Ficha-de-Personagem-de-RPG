/**
 * Edição da ficha de pontos/dados: cada toque muda a tela na hora e vai para o servidor em fila
 * (uma alteração por vez; o que chega enquanto uma está no ar vai junto na próxima). O servidor devolve
 * a ficha calculada (pontos, NH, derivadas, avisos); se recusar, a tela volta ao que está salvo.
 */
import { useCallback, useRef, useState } from 'react';

import { api, ApiError } from '../../lib/api';
import type { Character } from '../../lib/types';

export type BuildPatch = Record<string, unknown>;

export function useBuildEditor<B extends Record<string, unknown>>(character: Character, onSaved: (c: Character) => void) {
  const [build, setBuild] = useState<B>((character.build ?? {}) as B);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<BuildPatch>({});
  const inFlight = useRef(false);
  const saved = useRef<B>((character.build ?? {}) as B);

  const flush = useCallback(async () => {
    if (inFlight.current || Object.keys(pending.current).length === 0) return;
    inFlight.current = true;
    setSaving(true);
    while (Object.keys(pending.current).length > 0) {
      const body = pending.current;
      pending.current = {};
      try {
        const updated = await api.patchCharacter(character.id, { build: body });
        saved.current = (updated.build ?? {}) as B;
        // O que o jogador mexeu enquanto salvava continua na tela (vai na próxima volta do laço).
        setBuild({ ...saved.current, ...pending.current } as B);
        setError(null);
        onSaved(updated);
      } catch (e) {
        pending.current = {};
        setBuild(saved.current);
        setError(e instanceof ApiError ? e.message : 'Não foi possível salvar. Tente de novo.');
      }
    }
    inFlight.current = false;
    setSaving(false);
  }, [character.id, onSaved]);

  const update = useCallback(
    (patch: Partial<B>) => {
      setBuild((current) => ({ ...current, ...patch }));
      pending.current = { ...pending.current, ...patch };
      void flush();
    },
    [flush],
  );

  return { build, update, saving, error, clearError: () => setError(null) };
}
