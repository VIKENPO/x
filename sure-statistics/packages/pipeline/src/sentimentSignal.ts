import { averageSentiment, scoreSentiment, type ScoredItem, type SentimentSignal } from "@ss/core";

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
