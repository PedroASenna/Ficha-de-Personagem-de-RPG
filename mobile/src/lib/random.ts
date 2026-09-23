/**
 * PRNG determinístico (mulberry32) para efeitos visuais: dado o mesmo seed, as mesmas partículas.
 * Mantém a renderização pura (regras do React Compiler) e deixa os efeitos reproduzíveis em teste.
 * Nunca use para rolar dados: isso é papel do servidor (CSPRNG) ou de rollLocal.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
