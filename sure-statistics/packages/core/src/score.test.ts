import { describe, expect, it } from "vitest";
import { computeTickerScore } from "./score.js";
import type { QuoteSignal, SentimentSignal } from "./types.js";

const FIXED_NOW = () => new Date("2026-09-02T08:00:00.000Z");

function quote(changeRatio: number): QuoteSignal {
  return { symbol: "AAPL", price: 100 * (1 + changeRatio), previousClose: 100, changeRatio, source: "test", asOf: "2026-09-02T07:55:00.000Z" };
}

function sentiment(source: "news" | "reddit", averageSentiment: number, sampleSize = 5): SentimentSignal {
  return { source, symbol: "AAPL", averageSentiment, sampleSize, items: [] };
}

describe("computeTickerScore", () => {
  it("devuelve neutral (50%) y confianza 0 sin ninguna señal", () => {
    const result = computeTickerScore({ symbol: "AAPL", name: "Apple Inc.", now: FIXED_NOW });
    expect(result.bullishProbability).toBe(50);
    expect(result.confidence).toBe(0);
  });

  it("sube la probabilidad con una subida pre-market fuerte", () => {
    const result = computeTickerScore({ symbol: "AAPL", name: "Apple Inc.", quote: quote(0.03), now: FIXED_NOW });
    expect(result.bullishProbability).toBeGreaterThan(50);
  });

  it("baja la probabilidad con una caída pre-market fuerte", () => {
    const result = computeTickerScore({ symbol: "AAPL", name: "Apple Inc.", quote: quote(-0.03), now: FIXED_NOW });
    expect(result.bullishProbability).toBeLessThan(50);
  });

  it("nunca llega a los extremos 0/100", () => {
    const result = computeTickerScore({
      symbol: "AAPL",
      name: "Apple Inc.",
      quote: quote(1),
      marketProxy: quote(1),
      news: sentiment("news", 1),
      reddit: sentiment("reddit", 1),
      now: FIXED_NOW,
    });
    expect(result.bullishProbability).toBeLessThanOrEqual(95);

    const worst = computeTickerScore({
      symbol: "AAPL",
      name: "Apple Inc.",
      quote: quote(-1),
      marketProxy: quote(-1),
      news: sentiment("news", -1),
      reddit: sentiment("reddit", -1),
      now: FIXED_NOW,
    });
    expect(worst.bullishProbability).toBeGreaterThanOrEqual(5);
  });

  it("aumenta la confianza cuantas más señales hay disponibles", () => {
    const onlyQuote = computeTickerScore({ symbol: "AAPL", name: "Apple Inc.", quote: quote(0.01), now: FIXED_NOW });
    const allSignals = computeTickerScore({
      symbol: "AAPL",
      name: "Apple Inc.",
      quote: quote(0.01),
      marketProxy: quote(0.01),
      news: sentiment("news", 0.2),
      reddit: sentiment("reddit", 0.2),
      now: FIXED_NOW,
    });
    expect(allSignals.confidence).toBeGreaterThan(onlyQuote.confidence);
    expect(allSignals.confidence).toBe(100);
  });

  it("ignora una señal de sentimiento con sampleSize 0", () => {
    const withEmptyNews = computeTickerScore({
      symbol: "AAPL",
      name: "Apple Inc.",
      quote: quote(0.01),
      news: sentiment("news", 0.9, 0),
      now: FIXED_NOW,
    });
    const onlyQuote = computeTickerScore({ symbol: "AAPL", name: "Apple Inc.", quote: quote(0.01), now: FIXED_NOW });
    expect(withEmptyNews.confidence).toBe(onlyQuote.confidence);
  });
});
