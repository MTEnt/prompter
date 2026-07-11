/** Rough local token estimate (no network, no model API). */

export function estimateTokens(text) {
  if (!text) return 0;
  // Mixed heuristic: ~4 chars/token for code, adjust for whitespace density
  const chars = text.length;
  const words = text.split(/\s+/).filter(Boolean).length;
  const byChar = chars / 3.8;
  const byWord = words * 1.3;
  return Math.max(1, Math.round((byChar + byWord) / 2));
}

export function formatTokens(n) {
  if (n < 1000) return `${n}`;
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
