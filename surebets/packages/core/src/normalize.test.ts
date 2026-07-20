import { describe, it, expect } from "vitest";
import {
  canonicalizeEntity,
  parseParticipants,
  deriveEventKey,
  similarity,
  normalizeQuotes,
} from "./normalize.js";
import { buildMarkets } from "./merge.js";
import { findSurebets } from "./arbitrage.js";
import type { ProviderQuote } from "./types.js";

describe("canonicalizeEntity", () => {
  it("unifica variantes de fútbol (acentos, puntuación, sufijos, alias)", () => {
    expect(canonicalizeEntity("Real Madrid")).toBe("real madrid");
    expect(canonicalizeEntity("R. Madrid")).toBe("real madrid");
    expect(canonicalizeEntity("Real Madrid CF")).toBe("real madrid");
    expect(canonicalizeEntity("FC Barcelona")).toBe("barcelona");
    expect(canonicalizeEntity("Barça")).toBe("barcelona");
    expect(canonicalizeEntity("Atlético de Madrid")).toBe("atletico madrid");
    expect(canonicalizeEntity("Man City")).toBe("manchester city");
  });

  it("en tenis descarta las iniciales", () => {
    expect(canonicalizeEntity("C. Alcaraz", "tennis")).toBe("alcaraz");
    expect(canonicalizeEntity("Alcaraz", "tennis")).toBe("alcaraz");
    expect(canonicalizeEntity("J. Sinner", "tennis")).toBe("sinner");
  });
});

describe("parseParticipants", () => {
  it("separa distintos formatos de enfrentamiento", () => {
    expect(parseParticipants("Real Madrid vs Barcelona")).toEqual(["Real Madrid", "Barcelona"]);
    expect(parseParticipants("Alcaraz - Sinner")).toEqual(["Alcaraz", "Sinner"]);
    expect(parseParticipants("Lakers @ Celtics")).toEqual(["Lakers", "Celtics"]);
  });
});

describe("deriveEventKey", () => {
  it("dos casas con nombres distintos producen la MISMA clave", () => {
    const a = deriveEventKey("football", "Real Madrid vs Barcelona", "2026-08-01T19:00:00Z");
    const b = deriveEventKey("football", "R. Madrid vs FC Barcelona", "2026-08-01T19:00:00Z");
    expect(a).toBe(b);
  });

  it("es independiente del orden de los participantes", () => {
    const a = deriveEventKey("football", "Barcelona vs Real Madrid", "2026-08-01T19:00:00Z");
    const b = deriveEventKey("football", "Real Madrid vs Barcelona", "2026-08-01T19:00:00Z");
    expect(a).toBe(b);
  });

  it("distingue eventos en días distintos", () => {
    const a = deriveEventKey("football", "Real Madrid vs Barcelona", "2026-08-01T19:00:00Z");
    const b = deriveEventKey("football", "Real Madrid vs Barcelona", "2026-08-02T19:00:00Z");
    expect(a).not.toBe(b);
  });
});

describe("similarity", () => {
  it("da 1 para idénticas y alto para casi idénticas", () => {
    expect(similarity("juventus", "juventus")).toBe(1);
    expect(similarity("juventus", "juventuss")).toBeGreaterThan(0.85);
    expect(similarity("real madrid", "barcelona")).toBeLessThan(0.3);
  });
});

describe("normalizeQuotes + buildMarkets (integración)", () => {
  const START = "2026-08-01T19:00:00Z";

  const quotes: ProviderQuote[] = [
    {
      eventId: "x", eventName: "Real Madrid vs Barcelona", sport: "football",
      marketKey: "1x2", startsAt: START, bookmaker: "A",
      outcomes: [{ label: "home", odds: 3.0 }, { label: "draw", odds: 3.2 }, { label: "away", odds: 3.9 }],
    },
    {
      eventId: "y", eventName: "R. Madrid vs FC Barcelona", sport: "football",
      marketKey: "1x2", startsAt: START, bookmaker: "B",
      outcomes: [{ label: "home", odds: 2.7 }, { label: "draw", odds: 3.6 }, { label: "away", odds: 3.4 }],
    },
    {
      eventId: "z1", eventName: "Alcaraz vs Sinner", sport: "tennis",
      marketKey: "h2h", startsAt: START, bookmaker: "A",
      outcomes: [{ label: "Alcaraz", odds: 1.85 }, { label: "Sinner", odds: 1.95 }],
    },
    {
      eventId: "z2", eventName: "C. Alcaraz vs J. Sinner", sport: "tennis",
      marketKey: "h2h", startsAt: START, bookmaker: "B",
      outcomes: [{ label: "C. Alcaraz", odds: 2.0 }, { label: "J. Sinner", odds: 1.9 }],
    },
  ];

  it("agrupa eventos nombrados distinto en un solo mercado por casa", () => {
    const markets = buildMarkets(quotes);
    // 2 eventos (fútbol + tenis), cada uno con las 2 casas.
    expect(markets).toHaveLength(2);
    for (const m of markets) expect(m.books).toHaveLength(2);
  });

  it("canonicaliza las etiquetas de resultado del tenis para que casen", () => {
    const normalized = normalizeQuotes(quotes);
    const tennis = normalized.filter((q) => q.sport === "tennis");
    const labels = new Set(tennis.flatMap((q) => q.outcomes.map((o) => o.label)));
    // Solo dos etiquetas distintas: "alcaraz" y "sinner".
    expect([...labels].sort()).toEqual(["alcaraz", "sinner"]);
  });

  it("detecta la surebet del partido de fútbol tras normalizar", () => {
    const surebets = findSurebets(buildMarkets(quotes));
    expect(surebets).toHaveLength(1);
    expect(surebets[0].sport).toBe("football");
    expect(surebets[0].profitMargin).toBeGreaterThan(0.1);
  });
});

describe("matching difuso (union-find + participantes)", () => {
  const START = "2026-08-01T19:00:00Z";
  const q = (bookmaker: string, eventName: string): ProviderQuote => ({
    eventId: bookmaker, eventName, sport: "football", marketKey: "1x2",
    startsAt: START, bookmaker,
    outcomes: [{ label: "home", odds: 2.5 }, { label: "draw", odds: 3.3 }, { label: "away", odds: 3.0 }],
  });

  it("une por similitud difusa varias variantes con erratas en UN solo mercado", () => {
    // Mismo partido escrito con erratas distintas por cada casa (no lo pillan
    // ni los alias ni las reglas de sufijos; solo el fallback difuso).
    const markets = buildMarkets([
      q("A", "Bayer Leverkusen vs Union Berlin"),
      q("B", "Bayer Leverkussen vs Union Berlin"),
      q("C", "Bayer Leverkusen vs Union Berln"),
    ]);
    expect(markets).toHaveLength(1);
    expect(markets[0].books.map((b) => b.bookmaker).sort()).toEqual(["A", "B", "C"]);
  });

  it("NO fusiona eventos distintos que comparten un participante (evita surebets falsas)", () => {
    // Mismo día/deporte y un participante común, pero rival distinto: son
    // eventos diferentes y no deben cruzarse (comparar la clave entera, con el
    // prefijo común, sí los uniría por error).
    const markets = buildMarkets([
      q("A", "Real Madrid vs Sevilla"),
      q("B", "Real Madrid vs Real Betis"),
    ]);
    expect(markets).toHaveLength(2);
    for (const m of markets) expect(m.books).toHaveLength(1);
  });
});
