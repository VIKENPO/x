import { describe, it, expect } from "vitest";
import {
  mapEventsToQuotes,
  deriveSport,
  TheOddsApiProvider,
  type OddsApiEvent,
} from "./theOddsApi.js";
import { buildMarkets, findSurebets } from "@x/core";

// Payload de ejemplo con la forma REAL de The Odds API (/v4/.../odds).
const SAMPLE: OddsApiEvent[] = [
  {
    id: "evt-laliga-1",
    sport_key: "soccer_spain_la_liga",
    sport_title: "La Liga - Spain",
    commence_time: "2026-08-01T19:00:00Z",
    home_team: "Real Madrid",
    away_team: "Barcelona",
    bookmakers: [
      {
        key: "bet365",
        title: "Bet365",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Real Madrid", price: 3.0 },
              { name: "Barcelona", price: 3.9 },
              { name: "Draw", price: 3.2 },
            ],
          },
        ],
      },
      {
        key: "winamax",
        title: "Winamax",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Real Madrid", price: 2.7 },
              { name: "Barcelona", price: 3.4 },
              { name: "Draw", price: 3.6 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "evt-atp-1",
    sport_key: "tennis_atp_wimbledon",
    sport_title: "ATP Wimbledon",
    commence_time: "2026-08-02T12:00:00Z",
    home_team: "Carlos Alcaraz",
    away_team: "Jannik Sinner",
    bookmakers: [
      {
        key: "bet365",
        title: "Bet365",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Carlos Alcaraz", price: 1.85 },
              { name: "Jannik Sinner", price: 1.95 },
            ],
          },
        ],
      },
    ],
  },
];

describe("deriveSport", () => {
  it("mapea sport_key a deporte grueso", () => {
    expect(deriveSport("soccer_spain_la_liga")).toBe("football");
    expect(deriveSport("tennis_atp_wimbledon")).toBe("tennis");
    expect(deriveSport("basketball_nba")).toBe("basketball");
  });
});

describe("mapEventsToQuotes", () => {
  it("genera un quote por (evento × casa × mercado h2h)", () => {
    const quotes = mapEventsToQuotes(SAMPLE);
    // La Liga: 2 casas. Tenis: 1 casa. => 3 quotes.
    expect(quotes).toHaveLength(3);
  });

  it("mapea el 3-vías a 1x2 con home/draw/away", () => {
    const quotes = mapEventsToQuotes(SAMPLE);
    const laliga = quotes.filter((q) => q.marketKey === "1x2");
    expect(laliga).toHaveLength(2);
    const b365 = laliga.find((q) => q.bookmaker === "Bet365")!;
    const labels = b365.outcomes.map((o) => o.label).sort();
    expect(labels).toEqual(["away", "draw", "home"]);
    expect(b365.outcomes.find((o) => o.label === "home")!.odds).toBe(3.0);
    expect(b365.outcomes.find((o) => o.label === "away")!.odds).toBe(3.9);
  });

  it("mapea el 2-vías (tenis) a h2h con nombres de jugador", () => {
    const quotes = mapEventsToQuotes(SAMPLE);
    const tennis = quotes.find((q) => q.marketKey === "h2h")!;
    expect(tennis.sport).toBe("tennis");
    expect(tennis.outcomes.map((o) => o.label).sort()).toEqual([
      "Carlos Alcaraz",
      "Jannik Sinner",
    ]);
  });

  it("el pipeline completo detecta la surebet entre Bet365 y Winamax", () => {
    // Mejores cuotas: home 3.0 (B365), draw 3.6 (Winamax), away 3.9 (B365).
    const surebets = findSurebets(buildMarkets(mapEventsToQuotes(SAMPLE)));
    expect(surebets).toHaveLength(1);
    expect(surebets[0].sport).toBe("football");
    expect(surebets[0].profitMargin).toBeGreaterThan(0.1);
  });
});

describe("TheOddsApiProvider", () => {
  it("sin apiKey devuelve [] y no llama a la red", async () => {
    let called = false;
    const provider = new TheOddsApiProvider({
      apiKey: undefined,
      fetchImpl: (async () => {
        called = true;
        return new Response("[]");
      }) as unknown as typeof fetch,
    });
    // Forzamos ausencia de key aunque el entorno la tuviera.
    const quotes = await provider.fetchQuotes();
    expect(quotes).toEqual([]);
    expect(called).toBe(false);
  });

  it("con apiKey consulta la API y mapea la respuesta (fetch simulado)", async () => {
    const fakeFetch = (async (url: string) => {
      expect(String(url)).toContain("apiKey=test-key");
      expect(String(url)).toContain("oddsFormat=decimal");
      return new Response(JSON.stringify(SAMPLE), {
        status: 200,
        headers: { "x-requests-remaining": "499" },
      });
    }) as unknown as typeof fetch;

    const provider = new TheOddsApiProvider({
      apiKey: "test-key",
      sports: ["upcoming"],
      fetchImpl: fakeFetch,
    });
    const quotes = await provider.fetchQuotes();
    expect(quotes).toHaveLength(3);
  });

  it("con bookmakers usa el parámetro bookmakers (no regions)", async () => {
    let seenUrl = "";
    const fakeFetch = (async (url: string) => {
      seenUrl = String(url);
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new TheOddsApiProvider({
      apiKey: "k", sports: ["upcoming"], markets: ["h2h"],
      bookmakers: ["betfair_ex_eu", "winamax_fr"], fetchImpl: fakeFetch,
    });
    await provider.fetchQuotes();
    expect(seenUrl).toContain("bookmakers=betfair_ex_eu%2Cwinamax_fr");
    expect(seenUrl).not.toContain("regions=");
  });

  it("propaga un error HTTP con contexto", async () => {
    const fakeFetch = (async () =>
      new Response("quota exceeded", { status: 429, statusText: "Too Many Requests" })) as unknown as typeof fetch;
    const provider = new TheOddsApiProvider({
      apiKey: "test-key",
      sports: ["upcoming"],
      retries: 0, // sin reintentos: falla directo (determinista)
      fetchImpl: fakeFetch,
    });
    await expect(provider.fetchQuotes()).rejects.toThrow(/HTTP 429/);
  });

  it("reintenta ante 429 y acaba con éxito", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      if (calls < 3) return new Response("rate limit", { status: 429 });
      return new Response(JSON.stringify(SAMPLE), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new TheOddsApiProvider({
      apiKey: "test-key", sports: ["upcoming"],
      retries: 2, fetchImpl: fakeFetch, sleep: async () => {},
    });
    const quotes = await provider.fetchQuotes();
    expect(calls).toBe(3);
    expect(quotes).toHaveLength(3);
  });

  it("agota los reintentos ante 5xx y lanza", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response("boom", { status: 503, statusText: "Service Unavailable" });
    }) as unknown as typeof fetch;
    const provider = new TheOddsApiProvider({
      apiKey: "test-key", sports: ["upcoming"],
      retries: 2, fetchImpl: fakeFetch, sleep: async () => {},
    });
    await expect(provider.fetchQuotes()).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(3); // 1 intento + 2 reintentos
  });

  it("cachea la respuesta dentro del TTL (no vuelve a llamar a la red)", async () => {
    let calls = 0;
    let t = 1000;
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify(SAMPLE), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new TheOddsApiProvider({
      apiKey: "test-key", sports: ["upcoming"], cacheTtlMs: 5000,
      fetchImpl: fakeFetch, now: () => t,
    });

    await provider.fetchQuotes();
    await provider.fetchQuotes(); // dentro del TTL => cache
    expect(calls).toBe(1);

    t += 6000; // expira el TTL
    await provider.fetchQuotes();
    expect(calls).toBe(2);
  });
});

describe("mercado totals (over/under)", () => {
  const SAMPLE_TOTALS: OddsApiEvent[] = [
    {
      id: "evt-tot-1", sport_key: "soccer_epl", sport_title: "EPL",
      commence_time: "2026-08-03T18:00:00Z", home_team: "Arsenal", away_team: "Chelsea",
      bookmakers: [
        {
          key: "a", title: "A",
          markets: [{ key: "totals", outcomes: [
            { name: "Over", price: 2.1, point: 2.5 },
            { name: "Under", price: 1.8, point: 2.5 },
          ] }],
        },
        {
          key: "b", title: "B",
          markets: [{ key: "totals", outcomes: [
            { name: "Over", price: 1.8, point: 2.5 },
            { name: "Under", price: 2.1, point: 2.5 },
          ] }],
        },
      ],
    },
  ];

  it("mapea totals con la línea (point) en el marketKey", () => {
    const quotes = mapEventsToQuotes(SAMPLE_TOTALS);
    expect(quotes).toHaveLength(2);
    expect(quotes.every((q) => q.marketKey === "totals:2.5")).toBe(true);
    expect(quotes[0].outcomes.map((o) => o.label).sort()).toEqual(["over", "under"]);
  });

  it("detecta surebet de totals entre casas (mejor over + mejor under)", () => {
    const surebets = findSurebets(buildMarkets(mapEventsToQuotes(SAMPLE_TOTALS)));
    expect(surebets).toHaveLength(1);
    expect(surebets[0].marketKey).toBe("totals:2.5");
    expect(surebets[0].profitMargin).toBeGreaterThan(0.02);
  });

  it("no cruza líneas distintas (totals 2.5 vs 3.5)", () => {
    const mixed: OddsApiEvent[] = [
      { ...SAMPLE_TOTALS[0], bookmakers: [
        SAMPLE_TOTALS[0].bookmakers[0],
        { key: "c", title: "C", markets: [{ key: "totals", outcomes: [
          { name: "Over", price: 1.9, point: 3.5 },
          { name: "Under", price: 1.9, point: 3.5 },
        ] }] },
      ] },
    ];
    const markets = buildMarkets(mapEventsToQuotes(mixed));
    // Dos mercados distintos por línea: totals:2.5 (1 casa) y totals:3.5 (1 casa).
    expect(markets.map((m) => m.marketKey).sort()).toEqual(["totals:2.5", "totals:3.5"]);
    expect(findSurebets(markets)).toHaveLength(0); // ninguna con 2 casas
  });

  it("descarta líneas over/under no .5 (enteras/cuartos, con push/split)", () => {
    const evLine = (pt: number): OddsApiEvent => ({
      ...SAMPLE_TOTALS[0],
      bookmakers: [{ key: "a", title: "A", markets: [{ key: "totals", outcomes: [
        { name: "Over", price: 2.0, point: pt }, { name: "Under", price: 2.0, point: pt },
      ] }] }],
    });
    expect(mapEventsToQuotes([evLine(2.0)])).toHaveLength(0);
    expect(mapEventsToQuotes([evLine(2.25)])).toHaveLength(0);
  });
});

describe("mercado spreads (hándicap .5)", () => {
  const book = (title: string, homeOdds: number, awayOdds: number, point = 1.5) => ({
    key: title.toLowerCase(), title,
    markets: [{ key: "spreads", outcomes: [
      { name: "Lakers", price: homeOdds, point: -point },
      { name: "Celtics", price: awayOdds, point: +point },
    ] }],
  });
  const evSpreads = (books: OddsApiEvent["bookmakers"]): OddsApiEvent => ({
    id: "evt-sp", sport_key: "basketball_nba", sport_title: "NBA",
    commence_time: "2026-08-04T23:00:00Z", home_team: "Lakers", away_team: "Celtics",
    bookmakers: books,
  });

  it("mapea spreads .5 con la línea absoluta en el marketKey", () => {
    const quotes = mapEventsToQuotes([evSpreads([book("A", 2.1, 1.8)])]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].marketKey).toBe("spreads:-1.5"); // hándicap del local, con signo
    expect(quotes[0].outcomes.map((o) => o.label).sort()).toEqual(["away", "home"]);
  });

  it("detecta surebet de spreads entre casas", () => {
    const events = [evSpreads([book("A", 2.1, 1.8), book("B", 1.8, 2.1)])];
    const surebets = findSurebets(buildMarkets(mapEventsToQuotes(events)));
    expect(surebets).toHaveLength(1);
    expect(surebets[0].marketKey).toBe("spreads:-1.5");
  });

  it("descarta líneas no .5 (enteras o de cuarto, con push/split)", () => {
    expect(mapEventsToQuotes([evSpreads([book("A", 2.0, 2.0, 1.0)])])).toHaveLength(0);
    expect(mapEventsToQuotes([evSpreads([book("A", 2.0, 2.0, 1.25)])])).toHaveLength(0);
  });

  it("no cruza líneas alternativas de distinto signo (home -1.5 vs home +1.5)", () => {
    const a = evSpreads([book("A", 2.0, 1.9)]); // home -1.5 -> spreads:-1.5
    const bAlt: OddsApiEvent = {
      ...evSpreads([]),
      bookmakers: [{ key: "b", title: "B", markets: [{ key: "spreads", outcomes: [
        { name: "Lakers", price: 1.9, point: 1.5 },   // home +1.5 -> spreads:1.5
        { name: "Celtics", price: 2.0, point: -1.5 },
      ] }] }],
    };
    const markets = buildMarkets(mapEventsToQuotes([a, bAlt]));
    expect(markets.map((m) => m.marketKey).sort()).toEqual(["spreads:-1.5", "spreads:1.5"]);
    expect(findSurebets(markets)).toHaveLength(0); // líneas distintas => sin cruce falso
  });
});

describe("otros mercados (DNB, BTTS, over/under genérico)", () => {
  const ev = (marketsPerBook: OddsApiEvent["bookmakers"]): OddsApiEvent => ({
    id: "m1", sport_key: "soccer_epl", sport_title: "EPL",
    commence_time: "2026-08-05T18:00:00Z", home_team: "Ajax", away_team: "PSV",
    bookmakers: marketsPerBook,
  });

  it("mapea draw_no_bet y detecta surebet (dnb)", () => {
    const events = [ev([
      { key: "a", title: "A", markets: [{ key: "draw_no_bet", outcomes: [{ name: "Ajax", price: 2.1 }, { name: "PSV", price: 1.8 }] }] },
      { key: "b", title: "B", markets: [{ key: "draw_no_bet", outcomes: [{ name: "Ajax", price: 1.8 }, { name: "PSV", price: 2.1 }] }] },
    ])];
    const surebets = findSurebets(buildMarkets(mapEventsToQuotes(events)));
    expect(surebets).toHaveLength(1);
    expect(surebets[0].marketKey).toBe("dnb");
    expect(surebets[0].outcomes.map((o) => o.label).sort()).toEqual(["away", "home"]);
  });

  it("mapea btts (ambos marcan) y detecta surebet", () => {
    const events = [ev([
      { key: "a", title: "A", markets: [{ key: "btts", outcomes: [{ name: "Yes", price: 2.1 }, { name: "No", price: 1.8 }] }] },
      { key: "b", title: "B", markets: [{ key: "btts", outcomes: [{ name: "Yes", price: 1.8 }, { name: "No", price: 2.1 }] }] },
    ])];
    const surebets = findSurebets(buildMarkets(mapEventsToQuotes(events)));
    expect(surebets).toHaveLength(1);
    expect(surebets[0].marketKey).toBe("btts");
    expect(surebets[0].outcomes.map((o) => o.label).sort()).toEqual(["no", "yes"]);
  });

  it("mapea over/under genérico (córners) con tipo+línea en el marketKey", () => {
    const events = [ev([
      { key: "x", title: "X", markets: [{ key: "alternate_totals_corners", outcomes: [{ name: "Over", price: 1.9, point: 9.5 }, { name: "Under", price: 1.9, point: 9.5 }] }] },
    ])];
    const quotes = mapEventsToQuotes(events);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].marketKey).toBe("alternate_totals_corners:9.5");
    expect(quotes[0].outcomes.map((o) => o.label).sort()).toEqual(["over", "under"]);
  });
});

describe("mercados adicionales por-evento", () => {
  const bulk: OddsApiEvent[] = [{
    id: "e1", sport_key: "soccer_epl", sport_title: "EPL", commence_time: "2026-08-05T18:00:00Z",
    home_team: "Ajax", away_team: "PSV",
    bookmakers: [{ key: "a", title: "A", markets: [{ key: "h2h", outcomes: [
      { name: "Ajax", price: 2.0 }, { name: "PSV", price: 3.9 }, { name: "Draw", price: 3.2 },
    ] }] }],
  }];
  const eventOdds: OddsApiEvent = {
    id: "e1", sport_key: "soccer_epl", sport_title: "EPL", commence_time: "2026-08-05T18:00:00Z",
    home_team: "Ajax", away_team: "PSV",
    bookmakers: [{ key: "a", title: "A", markets: [{ key: "draw_no_bet", outcomes: [
      { name: "Ajax", price: 1.9 }, { name: "PSV", price: 1.95 },
    ] }] }],
  };

  it("pide /events/{id}/odds y añade los mercados adicionales", async () => {
    let bulkCalls = 0, eventCalls = 0;
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      if (u.includes("/events/") && u.includes("/odds")) { eventCalls++; return new Response(JSON.stringify(eventOdds), { status: 200 }); }
      bulkCalls++; return new Response(JSON.stringify(bulk), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new TheOddsApiProvider({
      apiKey: "k", sports: ["soccer_epl"], markets: ["h2h"],
      eventMarkets: ["draw_no_bet"], maxEventsPerCycle: 5, fetchImpl,
    });
    const quotes = await provider.fetchQuotes();
    expect(bulkCalls).toBe(1);
    expect(eventCalls).toBe(1);
    const keys = new Set(quotes.map((q) => q.marketKey));
    expect(keys.has("1x2")).toBe(true); // del bulk (h2h 3 vías)
    expect(keys.has("dnb")).toBe(true); // del per-event draw_no_bet
  });

  it("respeta maxEventsPerCycle (limita las llamadas por-evento)", async () => {
    const many: OddsApiEvent[] = [1, 2, 3, 4].map((i) => ({ ...bulk[0], id: "e" + i }));
    let eventCalls = 0;
    const fetchImpl = (async (url: string) => {
      if (String(url).includes("/events/")) { eventCalls++; return new Response(JSON.stringify({ ...eventOdds, id: "x" }), { status: 200 }); }
      return new Response(JSON.stringify(many), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new TheOddsApiProvider({
      apiKey: "k", sports: ["soccer_epl"], markets: ["h2h"],
      eventMarkets: ["btts"], maxEventsPerCycle: 2, fetchImpl,
    });
    await provider.fetchQuotes();
    expect(eventCalls).toBe(2); // solo 2 de los 4 eventos
  });
});

describe("player props (agrupación por jugador/línea)", () => {
  const evProps = (markets: OddsApiEvent["bookmakers"][number]["markets"]): OddsApiEvent => ({
    id: "pp", sport_key: "soccer_usa_mls", sport_title: "MLS",
    commence_time: "2026-07-20T23:00:00Z", home_team: "LA Galaxy", away_team: "LAFC",
    bookmakers: [{ key: "a", title: "A", markets }],
  });

  it("player_shots_on_target: un mercado por (jugador × línea)", () => {
    const quotes = mapEventsToQuotes([evProps([{ key: "player_shots_on_target", outcomes: [
      { name: "Over", price: 1.9, point: 1.5, description: "Player X" },
      { name: "Under", price: 1.9, point: 1.5, description: "Player X" },
      { name: "Over", price: 2.0, point: 0.5, description: "Player Y" },
      { name: "Under", price: 1.8, point: 0.5, description: "Player Y" },
    ] }])]);
    expect(quotes.map((q) => q.marketKey).sort()).toEqual([
      "player_shots_on_target:Player X:1.5",
      "player_shots_on_target:Player Y:0.5",
    ]);
    expect(quotes[0].outcomes.map((o) => o.label).sort()).toEqual(["over", "under"]);
  });

  it("player_goal_scorer_anytime: yes/no por jugador", () => {
    const quotes = mapEventsToQuotes([evProps([{ key: "player_goal_scorer_anytime", outcomes: [
      { name: "Yes", price: 2.5, description: "Messi" }, { name: "No", price: 1.5, description: "Messi" },
      { name: "Yes", price: 3.0, description: "Suarez" }, { name: "No", price: 1.3, description: "Suarez" },
    ] }])]);
    expect(quotes.map((q) => q.marketKey).sort()).toEqual([
      "player_goal_scorer_anytime:Messi",
      "player_goal_scorer_anytime:Suarez",
    ]);
  });

  it("detecta surebet en un player prop del MISMO jugador entre casas", () => {
    const mk = (title: string, yes: number, no: number) => ({
      key: title.toLowerCase(), title,
      markets: [{ key: "player_goal_scorer_anytime", outcomes: [
        { name: "Yes", price: yes, description: "Messi" }, { name: "No", price: no, description: "Messi" },
      ] }],
    });
    const ev: OddsApiEvent = {
      id: "pp3", sport_key: "soccer_usa_mls", sport_title: "MLS",
      commence_time: "2026-07-20T23:00:00Z", home_team: "A", away_team: "B",
      bookmakers: [mk("A", 2.1, 1.9), mk("B", 1.9, 2.1)],
    };
    const surebets = findSurebets(buildMarkets(mapEventsToQuotes([ev])));
    expect(surebets.some((s) => s.marketKey === "player_goal_scorer_anytime:Messi")).toBe(true);
  });

  it("cruza Over (casa A) + Under (casa B) del MISMO prop en casas distintas", () => {
    const evA: OddsApiEvent = {
      id: "pp4", sport_key: "soccer_usa_mls", sport_title: "MLS",
      commence_time: "2026-07-20T23:00:00Z", home_team: "A", away_team: "B",
      bookmakers: [{ key: "a", title: "A", markets: [{ key: "player_shots_on_target", outcomes: [
        { name: "Over", price: 2.1, point: 1.5, description: "X" },
      ] }] }],
    };
    const evB: OddsApiEvent = {
      ...evA,
      bookmakers: [{ key: "b", title: "B", markets: [{ key: "player_shots_on_target", outcomes: [
        { name: "Under", price: 2.1, point: 1.5, description: "X" },
      ] }] }],
    };
    const surebets = findSurebets(buildMarkets([...mapEventsToQuotes([evA]), ...mapEventsToQuotes([evB])]));
    expect(surebets.some((s) => s.marketKey === "player_shots_on_target:X:1.5")).toBe(true);
  });

  it("un prop con un solo lado en TODAS las casas no da surebet", () => {
    const mk = (t: string, price: number) => ({
      key: t.toLowerCase(), title: t,
      markets: [{ key: "player_shots_on_target", outcomes: [{ name: "Over", price, point: 1.5, description: "X" }] }],
    });
    const ev: OddsApiEvent = {
      id: "pp5", sport_key: "soccer_usa_mls", sport_title: "MLS",
      commence_time: "2026-07-20T23:00:00Z", home_team: "A", away_team: "B",
      bookmakers: [mk("A", 2.1), mk("B", 2.2)],
    };
    expect(findSurebets(buildMarkets(mapEventsToQuotes([ev])))).toHaveLength(0);
  });
});
