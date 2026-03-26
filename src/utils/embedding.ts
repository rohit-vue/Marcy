const EMBEDDING_DIMENSION = 1536;

/**
 * Deterministic pseudo-embedding for development until OpenAI embeddings are wired.
 */
export function mockEmbeddingFromText(text: string): number[] {
  const out = new Array<number>(EMBEDDING_DIMENSION);
  let seed = hashString(text);
  for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out[i] = seed / 0xffffffff - 0.5;
  }
  return out;
}

export function vectorToPgLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
