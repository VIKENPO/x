import { describe, it, expect } from "vitest";
import { findSurebet, findSurebets, stakePlan, stakeSummary } from "./arbitrage.js";
import { mergeQuotes } from "./merge.js";
import type { MarketQuote, ProviderQuote } from "./types.js";

function market(books: MarketQuote["books"]): MarketQuote {
  return {
    eventId: "e1",
    eventName: "A vs B",
    sport: "football",
    marketKey: "1x2",
    startsAt: "2026-01-01T00:00:00Z",
    books,
  };
}

describe("findSurebet", () => {
  it("detecta un arbitraje real en un mercado 1x2", () => {
    // Mejores cuotas: home 3.0 (X), draw 3.6 (Y), away 3.9 (X)
    // Σ 1/c = 0.3333 + 0.2778 + 0.2564 = 0.8675 < 1  => surebet ~15.3%
    const m = market([
      {
        bookmaker: "X",
        outcomes: [
          { label: "home", odds: 3.0 },
          { label: "draw", odds: 3.2 },
          { label: "away", odds: 3.9 },
        ],
      },
      {
        bookmaker: "Y",
        outcomes: [
          { label: "home", odds: 2.7 },
          { label: "draw", odds: 3.6 },
          { label: "away", odds: 3.4 },
        ],
      },
    ]);

    const sb = findSurebet(m);
    expect(sb).not.toBeNull();
    expect(sb!.totalImpliedProbability).toBeLessThan(1);
    expect(sb!.profitMargin).toBeGreaterThan(0.1);

    const home = sb!.outcomes.find((o) => o.label === "home")!;
    expect(home.bestOdds).toBe(3.0);
    expect(home.bookmaker).toBe("X");
    const away = sb!.outcomes.find((o) => o.label === "away")!;
    expect(away.bookmaker).toBe("X");
    const draw = sb!.outcomes.find((o) => o.label === "draw")!;
    expect(draw.bookmaker).toBe("Y");

    // Las fracciones de stake suman 1.
    const total = sb!.outcomes.reduce((a, o) => a + o.stakeFraction, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("no reporta nada cuando no hay arbitraje (margen de la casa)", () => {
    const m = market([
      {
        bookmaker: "X",
        outcomes: [
          { label: "home", odds: 2.0 },
          { label: "draw", odds: 3.3 },
          { label: "away", odds: 3.5 },
        ],
      },
      {
        bookmaker: "Y",
        outcomes: [
          { label: "home", odds: 1.95 },
          { label: "draw", odds: 3.4 },
          { label: "away", odds: 3.6 },
        ],
      },
    ]);
    expect(findSurebet(m)).toBeNull();
  });

  it("necesita al menos dos casas", () => {
    const m = market([
      {
        bookmaker: "X",
        outcomes: [
          { label: "home", odds: 10 },
          { label: "away", odds: 10 },
        ],
      },
    ]);
    expect(findSurebet(m)).toBeNull();
  });

  it("respeta el margen mínimo", () => {
    const m = market([
      { bookmaker: "X", outcomes: [{ label: "home", odds: 2.02 }, { label: "away", odds: 2.0 }] },
      { bookmaker: "Y", outcomes: [{ label: "home", odds: 2.0 }, { label: "away", odds: 2.02 }] },
    ]);
    // Arbitraje minúsculo (~0.5%): con umbral 5% no debe reportarse.
    expect(findSurebet(m, 0.05)).toBeNull();
    expect(findSurebet(m, 0)).not.toBeNull();
  });
});

describe("stakePlan", () => {
  it("reparte el capital para igualar el retorno pase lo que pase", () => {
    const m = market([
      { bookmaker: "X", outcomes: [{ label: "home", odds: 2.2 }, { label: "away", odds: 2.2 }] },
      { bookmaker: "Y", outcomes: [{ label: "home", odds: 2.1 }, { label: "away", odds: 2.1 }] },
    ]);
    const sb = findSurebet(m)!;
    const plan = stakePlan(sb, 100);
    const totalStake = plan.reduce((a, p) => a + p.stake, 0);
    expect(totalStake).toBeCloseTo(100, 1);
    // El payout debe ser prácticamente el mismo gane quien gane.
    const payouts = plan.map((p) => p.payout);
    expect(Math.max(...payouts) - Math.min(...payouts)).toBeLessThan(0.5);
    expect(Math.min(...payouts)).toBeGreaterThan(100); // beneficio garantizado
  });
});

describe("mergeQuotes + findSurebets", () => {
  it("agrupa cuotas de varias casas y detecta surebets", () => {
    const quotes: ProviderQuote[] = [
      {
        eventId: "e1", eventName: "A vs B", sport: "football", marketKey: "1x2",
        startsAt: "2026-01-01T00:00:00Z", bookmaker: "X",
        outcomes: [{ label: "home", odds: 3.0 }, { label: "draw", odds: 3.2 }, { label: "away", odds: 3.9 }],
      },
      {
        eventId: "e1", eventName: "A vs B", sport: "football", marketKey: "1x2",
        startsAt: "2026-01-01T00:00:00Z", bookmaker: "Y",
        outcomes: [{ label: "home", odds: 2.7 }, { label: "draw", odds: 3.6 }, { label: "away", odds: 3.4 }],
      },
    ];
    const markets = mergeQuotes(quotes);
    expect(markets).toHaveLength(1);
    expect(markets[0].books).toHaveLength(2);
    const surebets = findSurebets(markets);
    expect(surebets).toHaveLength(1);
  });
});

describe("SurebetOptions (fiabilidad y accionabilidad)", () => {
  // Arbitraje irreal (~150%): buenas para probar los filtros.
  const arb2way = (): MarketQuote =>
    market([
      { bookmaker: "X", outcomes: [{ label: "home", odds: 5.0 }, { label: "away", odds: 2.0 }] },
      { bookmaker: "Y", outcomes: [{ label: "home", odds: 2.0 }, { label: "away", odds: 5.0 }] },
    ]);

  it("descarta márgenes irreales con maxProfitMargin (datos malos)", () => {
    const m = arb2way();
    expect(findSurebet(m)).not.toBeNull();
    expect(findSurebet(m, { maxProfitMargin: 0.5 })).toBeNull();
  });

  it("descarta eventos ya empezados con now", () => {
    const m = arb2way(); // startsAt 2026-01-01 (pasado)
    expect(findSurebet(m)).not.toBeNull();
    expect(findSurebet(m, { now: "2026-02-01T00:00:00Z" })).toBeNull();
  });

  it("respeta la antelación mínima (minLeadMs)", () => {
    const future: MarketQuote = { ...arb2way(), startsAt: "2026-12-31T18:00:00Z" };
    const oneHour = 60 * 60 * 1000;
    expect(findSurebet(future, { now: "2026-12-31T12:00:00Z", minLeadMs: oneHour })).not.toBeNull();
    expect(findSurebet(future, { now: "2026-12-31T17:30:00Z", minLeadMs: oneHour })).toBeNull();
  });

  it("el número posicional sigue siendo minProfitMargin (compatibilidad)", () => {
    const m = market([
      { bookmaker: "X", outcomes: [{ label: "home", odds: 2.02 }, { label: "away", odds: 2.0 }] },
      { bookmaker: "Y", outcomes: [{ label: "home", odds: 2.0 }, { label: "away", odds: 2.02 }] },
    ]);
    expect(findSurebet(m, 0.05)).toBeNull();
    expect(findSurebet(m, 0)).not.toBeNull();
  });
});

describe("stakeSummary (garantía real tras redondeo)", () => {
  it("expone el beneficio garantizado del peor resultado", () => {
    const m = market([
      { bookmaker: "X", outcomes: [{ label: "home", odds: 2.2 }, { label: "away", odds: 2.2 }] },
      { bookmaker: "Y", outcomes: [{ label: "home", odds: 2.1 }, { label: "away", odds: 2.1 }] },
    ]);
    const sb = findSurebet(m)!;
    const s = stakeSummary(sb, 100, 0.01);
    expect(s.totalStaked).toBeCloseTo(100, 0);
    expect(s.guaranteedProfit).toBeGreaterThan(0);
    expect(s.worstCasePayout).toBeGreaterThan(s.totalStaked);
    // La garantía real no puede superar el margen teórico.
    expect(s.guaranteedMargin).toBeLessThanOrEqual(sb.profitMargin + 1e-9);
  });
});

describe("comisión de exchanges", () => {
  const m = () => market([
    { bookmaker: "Betfair", outcomes: [{ label: "home", odds: 2.1 }, { label: "away", odds: 1.9 }] },
    { bookmaker: "Pinnacle", outcomes: [{ label: "home", odds: 1.9 }, { label: "away", odds: 2.1 }] },
  ]);

  it("sin comisión detecta la surebet (~5%)", () => {
    const sb = findSurebet(m());
    expect(sb).not.toBeNull();
    expect(sb!.profitMargin).toBeGreaterThan(0.04);
  });

  it("con comisión de Betfair el margen baja y la cuota neta < bruta", () => {
    const sbNo = findSurebet(m())!;
    const sbC = findSurebet(m(), { commission: { betfair: 0.05 } })!;
    expect(sbC).not.toBeNull();
    expect(sbC.profitMargin).toBeLessThan(sbNo.profitMargin);
    const homeLeg = sbC.outcomes.find((o) => o.label === "home")!;
    expect(homeLeg.bookmaker.toLowerCase()).toContain("betfair");
    expect(homeLeg.bestOdds).toBeLessThan(homeLeg.grossOdds); // neta < bruta
  });
});
