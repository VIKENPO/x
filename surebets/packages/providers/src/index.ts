import type { OddsProvider } from "@x/core";
import { FixtureBookA, FixtureBookB } from "./fixture.js";
import { Bet365Provider } from "./bet365.js";
import { WinamaxProvider } from "./winamax.js";
import { TheOddsApiProvider } from "./theOddsApi.js";

export { FixtureBookA, FixtureBookB } from "./fixture.js";
export { Bet365Provider } from "./bet365.js";
export { WinamaxProvider } from "./winamax.js";
export {
  TheOddsApiProvider,
  mapEventsToQuotes,
  deriveSport,
} from "./theOddsApi.js";
export type {
  OddsApiEvent,
  OddsApiBookmaker,
  OddsApiMarket,
  OddsApiOutcome,
  TheOddsApiConfig,
} from "./theOddsApi.js";

/**
 * Providers activos del sistema.
 *
 * - Si hay ODDS_API_KEY -> provider real (The Odds API, con varias casas).
 * - Si no -> providers de ejemplo (datos falsos con surebet garantizada),
 *   para poder desarrollar sin depender de ninguna API.
 *
 * bet365/Winamax (Fase 4) se añadirán aquí cuando estén implementados y todo
 * lo demás (merge + motor + API + frontend) funcionará sin cambios.
 */
export function activeProviders(): OddsProvider[] {
  if (process.env.ODDS_API_KEY) {
    return [new TheOddsApiProvider()];
  }
  return [new FixtureBookA(), new FixtureBookB()];
}

// Referenciados para dejar clara la intención aunque aún no estén activos.
void Bet365Provider;
void WinamaxProvider;
