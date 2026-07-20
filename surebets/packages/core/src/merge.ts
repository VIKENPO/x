import type { ProviderQuote, MarketQuote } from "./types.js";
import { normalizeQuotes } from "./normalize.js";

/**
 * Fusiona las cuotas de varias fuentes agrupándolas por (eventId + marketKey).
 *
 * Aquí es donde, en el mundo real, entra la NORMALIZACIÓN / MATCHING de eventos:
 * distintas casas nombran a los equipos de forma diferente ("Real Madrid" vs
 * "R. Madrid"), así que el eventId debe haberse normalizado ANTES (en cada
 * provider o en una capa dedicada). Este merge asume que ya coinciden.
 */
export function mergeQuotes(quotes: ProviderQuote[]): MarketQuote[] {
  const groups = new Map<string, MarketQuote>();

  for (const q of quotes) {
    const key = `${q.eventId}::${q.marketKey}`;
    let market = groups.get(key);
    if (!market) {
      market = {
        eventId: q.eventId,
        eventName: q.eventName,
        sport: q.sport,
        marketKey: q.marketKey,
        startsAt: q.startsAt,
        books: [],
      };
      groups.set(key, market);
    }
    market.books.push({ bookmaker: q.bookmaker, outcomes: q.outcomes });
  }

  return [...groups.values()];
}

/**
 * Pipeline completo de agrupación: NORMALIZA las cuotas crudas (matching de
 * eventos entre casas) y luego las fusiona por mercado. Es lo que debe usar la
 * API, en lugar de `mergeQuotes` a secas, cuando las fuentes son reales y cada
 * una nombra a los participantes a su manera.
 */
export function buildMarkets(quotes: ProviderQuote[]): MarketQuote[] {
  return mergeQuotes(normalizeQuotes(quotes));
}
