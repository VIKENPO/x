import type { QuoteSignal, ScoreBreakdown, SentimentSignal, TickerScore } from "./types.js";

/**
 * Modelo de score: heurístico y transparente, NO un modelo entrenado ni una
 * predicción validada estadísticamente (ver disclaimer en README/SPEC). Cada
 * señal se normaliza a [-1, 1] y se combina en una media ponderada; el peso
 * mayor lo tiene el movimiento pre-market del propio valor (es la señal más
 * directa), y el resto (mercado amplio, noticias, Reddit) matizan.
 */
export const WEIGHTS = {
  quote: 0.45,
  marketProxy: 0.2,
  news: 0.2,
  reddit: 0.15,
} as const;

/** Variación (en tanto por uno) que se considera "movimiento máximo típico" para escalar a [-1,1]. */
const CHANGE_SCALE = 0.03; // 3%

function changeScore(q: QuoteSignal | undefined): number | undefined {
  if (!q) return undefined;
  return Math.max(-1, Math.min(1, q.changeRatio / CHANGE_SCALE));
}

function sentimentScore(s: SentimentSignal | undefined): number | undefined {
  if (!s || s.sampleSize === 0) return undefined;
  return Math.max(-1, Math.min(1, s.averageSentiment));
}

export interface ScoreInput {
  symbol: string;
  name: string;
  quote?: QuoteSignal;
  marketProxy?: QuoteSignal;
  news?: SentimentSignal;
  reddit?: SentimentSignal;
  now?: () => Date;
}

/**
 * Combina las señales disponibles en una probabilidad de sesgo alcista
 * (50 = neutral) y una confianza (cuántas señales había disponibles).
 * Con cero señales, devuelve neutral (50%) y confianza 0: nunca se afirma
 * un extremo (0/100%) porque el modelo es heurístico, no una certeza.
 */
export function computeTickerScore(input: ScoreInput): TickerScore {
  const signals: { key: keyof typeof WEIGHTS; score: number | undefined }[] = [
    { key: "quote", score: changeScore(input.quote) },
    { key: "marketProxy", score: changeScore(input.marketProxy) },
    { key: "news", score: sentimentScore(input.news) },
    { key: "reddit", score: sentimentScore(input.reddit) },
  ];

  let weightedSum = 0;
  let weightTotal = 0;
  for (const { key, score } of signals) {
    if (score === undefined) continue;
    weightedSum += score * WEIGHTS[key];
    weightTotal += WEIGHTS[key];
  }

  const combined = weightTotal > 0 ? weightedSum / weightTotal : 0;
  // Se mapea a [5, 95]: nunca 0/100% (el modelo es heurístico, no una certeza).
  const bullishProbability = Math.round(50 + combined * 45);
  const confidence = Math.round((weightTotal / 1) * 100);

  const breakdown: ScoreBreakdown = {
    quote: input.quote,
    marketProxy: input.marketProxy,
    news: input.news,
    reddit: input.reddit,
  };

  const now = input.now?.() ?? new Date();
  return {
    symbol: input.symbol,
    name: input.name,
    bullishProbability: Math.max(5, Math.min(95, bullishProbability)),
    confidence: Math.max(0, Math.min(100, confidence)),
    breakdown,
    computedAt: now.toISOString(),
  };
}
