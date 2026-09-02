import { averageSentiment, scoreSentiment, type ScoredItem, type SentimentSignal } from "@ss/core";
import { scoreHeadlinesWithClaude } from "@ss/providers";

/** Construye un SentimentSignal a partir de textos crudos (titulares o posts). Pura. */
export function buildSentimentSignal(source: "news" | "reddit", symbol: string, texts: string[]): SentimentSignal {
  const items: ScoredItem[] = texts.map((text) => ({ text, sentiment: scoreSentiment(text) }));
  return {
    source,
    symbol,
    averageSentiment: averageSentiment(texts),
    sampleSize: texts.length,
    items,
  };
}

/**
 * Igual que `buildSentimentSignal("news", ...)`, pero si hay `ANTHROPIC_API_KEY`
 * sustituye la media de sentimiento por una evaluación de Claude (más matizada
 * que el diccionario léxico) y añade `aiSummary` con el motivo. Sin clave, o si
 * la llamada falla, se queda en el diccionario gratuito sin cambio de comportamiento.
 */
export async function buildNewsSentimentSignal(symbol: string, headlines: string[]): Promise<SentimentSignal> {
  const base = buildSentimentSignal("news", symbol, headlines);
  try {
    const claude = await scoreHeadlinesWithClaude(symbol, headlines);
    if (!claude) return base;
    return { ...base, averageSentiment: claude.score, aiSummary: claude.summary };
  } catch (err) {
    console.error(`[pipeline] claude-sentiment ${symbol}:`, err);
    return base;
  }
}
