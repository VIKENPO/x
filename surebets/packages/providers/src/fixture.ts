import type { OddsProvider, ProviderQuote } from "@x/core";

/**
 * Providers de EJEMPLO (Fase 1). No consultan nada externo: devuelven cuotas
 * fijas para poder validar el motor de surebets sin depender de ninguna casa.
 *
 * Los datos están montados para que al cruzar "FixtureBookA" y "FixtureBookB"
 * aparezca una surebet real en el Real Madrid vs Barcelona.
 */

const START = "2026-08-01T19:00:00Z";

/**
 * Con FIXTURE_JITTER activado, aplica una pequeña variación aleatoria a cada
 * cuota. Sirve para DEMO en tiempo real: las surebets aparecen y desaparecen
 * entre ticks, disparando alertas. Sin la variable, las cuotas son fijas.
 */
function jitter(quotes: ProviderQuote[]): ProviderQuote[] {
  if (!process.env.FIXTURE_JITTER) return quotes;
  return quotes.map((q) => ({
    ...q,
    outcomes: q.outcomes.map((o) => {
      const factor = 1 + (Math.random() - 0.5) * 0.16; // ±8%
      return { ...o, odds: Math.round(o.odds * factor * 100) / 100 };
    }),
  }));
}

export class FixtureBookA implements OddsProvider {
  readonly name = "FixtureBookA";
  async fetchQuotes(): Promise<ProviderQuote[]> {
    return jitter([
      {
        // Nombres "oficiales". La otra casa los escribe distinto (ver FixtureBookB).
        eventId: "ignored", eventName: "Real Madrid vs Barcelona",
        sport: "football", marketKey: "1x2", startsAt: START, bookmaker: this.name,
        outcomes: [
          { label: "home", odds: 3.0 },
          { label: "draw", odds: 3.2 },
          { label: "away", odds: 3.9 }, // <- mejor cuota away
        ],
      },
      {
        eventId: "ignored", eventName: "Alcaraz vs Sinner",
        sport: "tennis", marketKey: "h2h", startsAt: START, bookmaker: this.name,
        outcomes: [
          { label: "Alcaraz", odds: 1.85 },
          { label: "Sinner", odds: 1.95 },
        ],
      },
    ]);
  }
}

export class FixtureBookB implements OddsProvider {
  readonly name = "FixtureBookB";
  async fetchQuotes(): Promise<ProviderQuote[]> {
    return jitter([
      {
        // Mismos equipos que FixtureBookA pero nombrados distinto: la capa de
        // normalización debe reconocer que es el MISMO evento.
        eventId: "ignored", eventName: "R. Madrid vs FC Barcelona",
        sport: "football", marketKey: "1x2", startsAt: START, bookmaker: this.name,
        outcomes: [
          { label: "home", odds: 2.7 },
          { label: "draw", odds: 3.6 }, // <- mejor cuota draw
          { label: "away", odds: 3.4 },
        ],
      },
      {
        eventId: "ignored", eventName: "C. Alcaraz vs J. Sinner",
        sport: "tennis", marketKey: "h2h", startsAt: START, bookmaker: this.name,
        outcomes: [
          { label: "C. Alcaraz", odds: 2.0 },
          { label: "J. Sinner", odds: 1.9 },
        ],
      },
    ]);
  }
}
