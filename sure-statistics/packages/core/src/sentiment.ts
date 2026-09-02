/**
 * Analizador de sentimiento léxico (sin llamadas a red ni a un LLM): cada
 * palabra del texto se busca en un diccionario con peso [-5, 5] y la media
 * ponderada se normaliza a [-1, 1]. Es el mismo enfoque que diccionarios
 * clásicos de finanzas (p. ej. Loughran-McDonald) pero con una lista propia,
 * pequeña y libre de licencia, pensada para titulares de mercado en inglés.
 *
 * Es deliberadamente simple (no es un LLM ni un modelo entrenado): sirve como
 * señal barata y 100% gratuita, no como oráculo. Ver disclaimer en README.
 */

const POSITIVE: Record<string, number> = {
  beat: 4, beats: 4, beating: 4, upgrade: 4, upgraded: 4, upgrades: 4,
  outperform: 3, surge: 4, surges: 4, surging: 4, rally: 3, rallies: 3,
  soar: 4, soars: 4, soaring: 4, jump: 3, jumps: 3, gain: 2, gains: 2,
  gaining: 2, record: 3, growth: 2, growing: 2, strong: 2, stronger: 3,
  bullish: 4, optimistic: 3, buyback: 3, buybacks: 3, "raises": 2,
  raised: 2, "raise": 2, profit: 2, profits: 2, profitable: 3, win: 2,
  wins: 2, winning: 2, boost: 2, boosts: 2, boosted: 2, expansion: 2,
  partnership: 2, approval: 3, approved: 3, breakthrough: 4, exceeds: 3,
  exceeded: 3, positive: 2, up: 1, higher: 2, rise: 2, rises: 2,
  rising: 2, recovery: 2, recovers: 2, innovation: 2, demand: 1,
};

const NEGATIVE: Record<string, number> = {
  miss: -4, misses: -4, missed: -4, downgrade: -4, downgraded: -4,
  downgrades: -4, underperform: -3, plunge: -4, plunges: -4,
  plunging: -4, slump: -3, slumps: -3, crash: -5, crashes: -5,
  crashing: -5, fall: -2, falls: -2, falling: -2, drop: -2, drops: -2,
  dropping: -2, decline: -2, declines: -2, declining: -2, weak: -2,
  weaker: -3, bearish: -4, pessimistic: -3, layoffs: -3, layoff: -3,
  lawsuit: -3, lawsuits: -3, investigation: -3, probe: -3, antitrust: -3,
  recall: -3, recalls: -3, fraud: -5, scandal: -4, bankruptcy: -5,
  loss: -2, losses: -2, cut: -2, cuts: -2, cutting: -2, warns: -3,
  warning: -3, warned: -3, sues: -3, sued: -3, fine: -2, fined: -2,
  fears: -2, fear: -2, concern: -2, concerns: -2, risk: -1, risks: -1,
  down: -1, lower: -2, sinks: -3, sinking: -3, tumble: -3, tumbles: -3,
  resign: -2, resigns: -2, resigned: -2, delay: -2, delays: -2,
  delayed: -2,
};

const NEGATORS = new Set(["not", "no", "never", "without", "n't"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^a-z']+/)
    .filter(Boolean);
}

/**
 * Puntúa un texto en [-1, 1]. Un negador justo antes de una palabra del
 * diccionario invierte su signo (p. ej. "not profitable" -> negativo).
 * Devuelve 0 si no hay ninguna palabra del diccionario (texto neutro/desconocido).
 */
export function scoreSentiment(text: string): number {
  const tokens = tokenize(text);
  let total = 0;
  let matches = 0;
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const weight = POSITIVE[word] ?? NEGATIVE[word];
    if (weight === undefined) continue;
    const negated = i > 0 && NEGATORS.has(tokens[i - 1]);
    total += negated ? -weight : weight;
    matches++;
  }
  if (matches === 0) return 0;
  // Media ponderada normalizada por el peso máximo posible (5).
  const avg = total / matches / 5;
  return Math.max(-1, Math.min(1, avg));
}

/** Puntúa una lista de textos y devuelve la media (0 si la lista está vacía). */
export function averageSentiment(texts: string[]): number {
  if (texts.length === 0) return 0;
  const sum = texts.reduce((acc, t) => acc + scoreSentiment(t), 0);
  return sum / texts.length;
}
