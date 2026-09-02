import type { Ticker } from "@ss/core";

/** Universo fijo del MVP: las "Magnificent 7". Ampliable sin tocar el resto del pipeline. */
export const TICKERS: Ticker[] = [
  { symbol: "META", name: "Meta Platforms, Inc." },
  { symbol: "AMZN", name: "Amazon.com, Inc." },
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "MSFT", name: "Microsoft Corporation" },
  { symbol: "NVDA", name: "NVIDIA Corporation" },
  { symbol: "TSLA", name: "Tesla, Inc." },
];

/**
 * ETF usado como proxy de "mercado amplio" (S&P 500). Sencillo a propósito para
 * el MVP; añadir QQQ (Nasdaq 100) como segunda señal es un roadmap item natural.
 */
export const MARKET_PROXY_SYMBOL = "SPY";
