import { computeTickerScore, type QuoteSignal, type Snapshot, type Ticker } from "@ss/core";
import { fetchCompanyHeadlines, fetchQuote, fetchTickerMentions } from "@ss/providers";
import { MARKET_PROXY_SYMBOL, TICKERS } from "./tickers.js";
import { buildSentimentSignal } from "./sentimentSignal.js";
import { nextMarketOpenUtc } from "./nextMarketOpen.js";
import { writeSnapshot } from "./writeSnapshot.js";

/** Envuelve una promesa de señal opcional: un fallo en UNA fuente no debe tirar todo el pipeline. */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[pipeline] ${label}:`, err);
    return fallback;
  }
}

async function buildTickerScore(ticker: Ticker, marketProxy: QuoteSignal | undefined) {
  const [quote, headlines, mentions] = await Promise.all([
    safe(`quote ${ticker.symbol}`, () => fetchQuote(ticker.symbol), null),
    safe(`news ${ticker.symbol}`, () => fetchCompanyHeadlines(ticker.symbol), []),
    safe(`reddit ${ticker.symbol}`, () => fetchTickerMentions(ticker.symbol), []),
  ]);

  return computeTickerScore({
    symbol: ticker.symbol,
    name: ticker.name,
    quote: quote ?? undefined,
    marketProxy,
    news: buildSentimentSignal("news", ticker.symbol, headlines),
    reddit: buildSentimentSignal("reddit", ticker.symbol, mentions),
  });
}

async function main() {
  const marketProxy = await safe(`quote proxy ${MARKET_PROXY_SYMBOL}`, () => fetchQuote(MARKET_PROXY_SYMBOL), null);

  const scores = await Promise.all(TICKERS.map((ticker) => buildTickerScore(ticker, marketProxy ?? undefined)));

  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    nextMarketOpenMadrid: nextMarketOpenUtc().toISOString(),
    scores,
  };

  await writeSnapshot(snapshot);
  console.log(`[pipeline] snapshot escrito con ${scores.length} tickers (${snapshot.generatedAt}).`);
}

main().catch((err) => {
  console.error("[pipeline] fallo no controlado:", err);
  process.exitCode = 1;
});
