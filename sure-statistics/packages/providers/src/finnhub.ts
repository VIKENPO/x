import type { QuoteSignal } from "@ss/core";

/**
 * Provider real basado en Finnhub (https://finnhub.io), API oficial con
 * **tier gratuito** (cotización en tiempo real y noticias por empresa).
 * No se hace scraping de ninguna web: todo llega vía esta API con licencia.
 *
 * Config por variable de entorno: FINNHUB_API_KEY (gratis en finnhub.io/register).
 * Sin key, las funciones devuelven `null`/`[]` (el pipeline sigue con las
 * señales que sí estén disponibles, igual que el resto de providers del monorepo).
 */

export interface FinnhubConfig {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface FinnhubQuoteResponse {
  c: number; // precio actual
  pc: number; // cierre anterior
  t: number; // unix seconds
}

interface FinnhubNewsItem {
  headline: string;
  datetime: number; // unix seconds
  url: string;
}

function resolveConfig(config: FinnhubConfig) {
  return {
    apiKey: config.apiKey ?? process.env.FINNHUB_API_KEY,
    baseUrl: config.baseUrl ?? "https://finnhub.io/api/v1",
    fetchImpl: config.fetchImpl ?? fetch,
  };
}

/** Convierte la respuesta cruda de /quote en un QuoteSignal normalizado. Pura (testable con fixtures). */
export function mapFinnhubQuote(symbol: string, raw: FinnhubQuoteResponse, source = "finnhub"): QuoteSignal | null {
  if (!raw || raw.c === 0 || raw.pc === 0) return null; // 0 = símbolo no encontrado o mercado sin datos
  return {
    symbol,
    price: raw.c,
    previousClose: raw.pc,
    changeRatio: (raw.c - raw.pc) / raw.pc,
    source,
    asOf: new Date(raw.t * 1000).toISOString(),
  };
}

/** Extrae los titulares (más recientes primero) de la respuesta cruda de /company-news. Pura. */
export function mapFinnhubNews(raw: FinnhubNewsItem[], limit = 15): string[] {
  return [...raw]
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, limit)
    .map((item) => item.headline)
    .filter(Boolean);
}

export async function fetchQuote(symbol: string, config: FinnhubConfig = {}): Promise<QuoteSignal | null> {
  const { apiKey, baseUrl, fetchImpl } = resolveConfig(config);
  if (!apiKey) {
    console.warn("[finnhub] sin FINNHUB_API_KEY: no se consulta cotización real.");
    return null;
  }
  const url = `${baseUrl}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`[finnhub] quote ${symbol}: HTTP ${res.status} ${res.statusText}`);
  const raw = (await res.json()) as FinnhubQuoteResponse;
  return mapFinnhubQuote(symbol, raw);
}

/** Titulares de los últimos `daysBack` días para un ticker (tier gratuito de Finnhub). */
export async function fetchCompanyHeadlines(symbol: string, daysBack = 2, config: FinnhubConfig = {}): Promise<string[]> {
  const { apiKey, baseUrl, fetchImpl } = resolveConfig(config);
  if (!apiKey) {
    console.warn("[finnhub] sin FINNHUB_API_KEY: no se consultan noticias reales.");
    return [];
  }
  const to = new Date();
  const from = new Date(to.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const url =
    `${baseUrl}/company-news?symbol=${encodeURIComponent(symbol)}` +
    `&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`[finnhub] company-news ${symbol}: HTTP ${res.status} ${res.statusText}`);
  const raw = (await res.json()) as FinnhubNewsItem[];
  return mapFinnhubNews(raw);
}
