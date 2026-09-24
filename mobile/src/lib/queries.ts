import { useQuery } from '@tanstack/react-query';

import { api } from './api';

export const keys = {
  characters: ['characters'] as const,
  character: (id: string) => ['characters', id] as const,
  rulesets: ['rulesets'] as const,
  ruleset: (id: string) => ['rulesets', id] as const,
  rooms: ['rooms'] as const,
};

export const useCharacters = () => useQuery({ queryKey: keys.characters, queryFn: api.characters });
export const useCharacter = (id: string | undefined) =>
  useQuery({ queryKey: keys.character(id ?? ''), queryFn: () => api.character(id!), enabled: !!id });
export const useRulesets = () => useQuery({ queryKey: keys.rulesets, queryFn: api.rulesets, staleTime: 10 * 60_000 });
export const useRulesetPack = (id: string | null | undefined) =>
  useQuery({ queryKey: keys.ruleset(id ?? ''), queryFn: () => api.ruleset(id!), enabled: !!id, staleTime: 60 * 60_000 });
export const useRooms = () => useQuery({ queryKey: keys.rooms, queryFn: api.rooms });
