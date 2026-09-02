import { describe, expect, it } from "vitest";
import { buildSentimentSignal } from "./sentimentSignal.js";

describe("buildSentimentSignal", () => {
  it("con textos vacíos, sampleSize 0 y media 0", () => {
    const signal = buildSentimentSignal("news", "AAPL", []);
    expect(signal).toEqual({ source: "news", symbol: "AAPL", averageSentiment: 0, sampleSize: 0, items: [] });
  });

  it("puntúa cada item y calcula la media", () => {
    const signal = buildSentimentSignal("reddit", "AAPL", ["AAPL surges on strong demand", "no major news"]);
    expect(signal.sampleSize).toBe(2);
    expect(signal.items).toHaveLength(2);
    expect(signal.items[0].sentiment).toBeGreaterThan(0);
  });
});
