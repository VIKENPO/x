import type { OddsProvider, ProviderQuote, Outcome } from "@x/core";

/**
 * Provider real basado en The Odds API (https://the-odds-api.com).
 *
 * Ventaja: una sola llamada devuelve las cuotas de MUCHAS casas por evento
 * (en la región `eu` aparecen bet365, Winamax, etc.), así que este único
 * provider ya produce varias casas que cruzar.
 *
 * Config por variables de entorno:
 *   ODDS_API_KEY      (obligatoria para datos reales)
 *   ODDS_API_SPORTS   lista separada por comas; por defecto "upcoming"
 *   ODDS_API_REGIONS  por defecto "eu"
 *
 * Sin ODDS_API_KEY devuelve [] (el sistema sigue con los providers de ejemplo).
 */

/** Forma (parcial) de la respuesta de /v4/sports/{sport}/odds. */
export interface OddsApiOutcome {
  name: string;
  price: number; // cuota decimal (con oddsFormat=decimal)
  point?: number; // línea (para totals/spreads): p. ej. 2.5
  description?: string; // jugador/equipo (props): p. ej. "Lionel Messi"
}
export interface OddsApiMarket {
  key: string; // "h2h", "spreads", ...
  outcomes: OddsApiOutcome[];
}
export interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}
export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string; // ISO
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

/** Deriva un deporte "grueso" a partir del sport_key de la API. */
export function deriveSport(sportKey: string): string {
  if (sportKey.startsWith("soccer")) return "football";
  return sportKey.split("_")[0] || sportKey;
}

/** Compara nombres de equipo de forma tolerante (mayúsculas, acentos, puntuación). */
function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
}

/**
 * Mapea el mercado H2H (1x2 de 3 vías o moneyline/tenis de 2 vías).
 */
function mapH2H(ev: OddsApiEvent, market: OddsApiMarket): { marketKey: string; outcomes: Outcome[] } | null {
  const hasDraw = market.outcomes.some((o) => o.name.toLowerCase() === "draw");
  const outcomes: Outcome[] = [];
  for (const o of market.outcomes) {
    let label: string;
    if (hasDraw) {
      // Mercado 1x2 (3 vías): mapeamos a home/draw/away.
      if (o.name.toLowerCase() === "draw") label = "draw";
      else if (sameName(o.name, ev.home_team)) label = "home";
      else if (sameName(o.name, ev.away_team)) label = "away";
      else label = o.name;
    } else {
      // 2 vías (tenis, moneyline): la etiqueta es el participante; la capa de
      // normalización la canonicaliza después.
      label = o.name;
    }
    outcomes.push({ label, odds: o.price });
  }
  if (outcomes.length < 2) return null;
  return { marketKey: hasDraw ? "1x2" : "h2h", outcomes };
}

/**
 * Mapea cualquier mercado OVER/UNDER (goles, córners, tiros a puerta, tarjetas…).
 * La LÍNEA (point) va en el marketKey (`<market>:<point>`, p. ej. `totals:2.5`,
 * `alternate_totals_corners:9.5`) para cruzar solo cuotas de la MISMA línea del
 * MISMO tipo de mercado entre casas.
 */
/**
 * Mapea mercados 2-vías genéricos: OVER/UNDER y SÍ/NO, con o sin jugador/equipo
 * (`description`). Un mismo mercado (p. ej. `player_shots_on_target`) trae los
 * outcomes de MUCHOS jugadores; se agrupan para producir un ProviderQuote por
 * (mercado × jugador × línea), de modo que solo se cruce lo comparable.
 *
 * Cubre: btts, btts_h1, player_goal_scorer_anytime/first/last (yes/no por jugador),
 * player_to_receive_card/red_card (yes/no por jugador), player_shots/shots_on_target/
 * assists (over/under por jugador), alternate_totals_corners/cards, team totals, etc.
 * Los over/under solo se aceptan en líneas .5 (2 vías limpio, sin push).
 */
function mapTwoWayGroups(market: OddsApiMarket): { marketKey: string; outcomes: Outcome[] }[] {
  type Group = { odds: Record<string, number>; point?: number; who: string; ou: boolean };
  const groups = new Map<string, Group>();

  for (const o of market.outcomes) {
    const n = o.name.toLowerCase();
    const side =
      n === "over" ? "over" : n === "under" ? "under" :
      n === "yes" ? "yes" : n === "no" ? "no" : null;
    if (!side) return []; // no es un mercado 2-vías que sepamos tratar aquí
    const ou = side === "over" || side === "under";
    const who = o.description ?? "";
    const gk = ou ? `${who}|${o.point ?? ""}` : who; // O/U agrupa también por línea
    let g = groups.get(gk);
    if (!g) { g = { odds: {}, point: ou ? o.point : undefined, who, ou }; groups.set(gk, g); }
    g.odds[side] = o.price;
  }

  // Se emiten los lados que ESTA casa ofrezca (aunque sea uno solo): en
  // arbitraje el Over puede venir de la casa A y el Under de la B, así que el
  // cruce entre casas (mergeQuotes) los combina. Un mercado con un único lado en
  // todas las casas no producirá surebet (findSurebet exige ≥2 resultados).
  const out: { marketKey: string; outcomes: Outcome[] }[] = [];
  for (const g of groups.values()) {
    const suffix = g.who ? `:${g.who}` : "";
    if (g.ou) {
      if (g.point == null || Math.abs(g.point) % 1 !== 0.5) continue; // solo .5 (sin push)
      const outcomes: Outcome[] = [];
      if (g.odds.over != null) outcomes.push({ label: "over", odds: g.odds.over });
      if (g.odds.under != null) outcomes.push({ label: "under", odds: g.odds.under });
      if (outcomes.length === 0) continue;
      out.push({ marketKey: `${market.key}${suffix}:${g.point}`, outcomes });
    } else {
      const outcomes: Outcome[] = [];
      if (g.odds.yes != null) outcomes.push({ label: "yes", odds: g.odds.yes });
      if (g.odds.no != null) outcomes.push({ label: "no", odds: g.odds.no });
      if (outcomes.length === 0) continue;
      out.push({ marketKey: `${market.key}${suffix}`, outcomes });
    }
  }
  return out;
}

/**
 * Mapea DRAW NO BET (ganador sin empate): 2 vías (home/away); si hay empate, la
 * apuesta se anula (reembolso). Arbitrable: Σ 1/cuota < 1 => beneficio si no hay
 * empate, y si lo hay, reembolso (sin pérdida).
 */
function mapDrawNoBet(ev: OddsApiEvent, market: OddsApiMarket): { marketKey: string; outcomes: Outcome[] } | null {
  const outcomes: Outcome[] = [];
  for (const o of market.outcomes) {
    const label =
      sameName(o.name, ev.home_team) ? "home" :
      sameName(o.name, ev.away_team) ? "away" :
      null;
    if (!label) return null;
    outcomes.push({ label, odds: o.price });
  }
  if (outcomes.length < 2) return null;
  return { marketKey: "dnb", outcomes };
}

/**
 * Mapea el mercado SPREADS (hándicap). Solo se aceptan líneas `.5`
 * (p. ej. -1.5 / +1.5): son 2 vías LIMPIAS (mutuamente excluyentes y
 * exhaustivas, sin posibilidad de push), lo que permite arbitraje seguro.
 * Las líneas enteras (.0, con push) y las asiáticas de cuarto (.25/.75, que
 * dividen la apuesta) se descartan para no generar surebets falsas.
 *
 * La línea absoluta va en el marketKey (`spreads:1.5`) para cruzar solo cuotas
 * de la MISMA línea: home -1.5 @ casaA + away +1.5 @ casaB.
 */
function mapSpreads(ev: OddsApiEvent, market: OddsApiMarket): { marketKey: string; outcomes: Outcome[] } | null {
  const outcomes: Outcome[] = [];
  let homePoint: number | undefined; // línea CON signo del local (discrimina el mercado)
  for (const o of market.outcomes) {
    if (o.point == null) return null;
    if (Math.abs(o.point) % 1 !== 0.5) return null; // solo líneas .5
    const label =
      sameName(o.name, ev.home_team) ? "home" :
      sameName(o.name, ev.away_team) ? "away" :
      null;
    if (!label) return null;
    if (label === "home") homePoint = o.point;
    outcomes.push({ label, odds: o.price });
  }
  if (outcomes.length < 2 || homePoint == null) return null;
  // La clave lleva el hándicap CON SIGNO del local: así home -1.5 / away +1.5 de
  // una casa solo cruza con la MISMA línea de otra (home -1.5 / away +1.5),
  // nunca con una línea alternativa (home +1.5), que no sería complementaria.
  return { marketKey: `spreads:${homePoint}`, outcomes };
}

/**
 * Convierte la respuesta de The Odds API en ProviderQuote[] normalizados de
 * este sistema. Función PURA (sin red) para poder testearla con fixtures.
 *
 * Soporta: `h2h` (1x2/moneyline), `draw_no_bet` (ganador sin empate), `btts`
 * (ambos marcan), `spreads` (hándicap .5) y CUALQUIER mercado over/under
 * (`totals` de goles, y córners/tiros/tarjetas cuando llegan del endpoint
 * por-evento). Cada (evento × casa × mercado/línea) genera un ProviderQuote.
 * Los mercados no soportados (p. ej. `double_chance`, no excluyente) se ignoran.
 */
export function mapEventsToQuotes(events: OddsApiEvent[]): ProviderQuote[] {
  const quotes: ProviderQuote[] = [];

  for (const ev of events) {
    const sport = deriveSport(ev.sport_key);
    const eventName = `${ev.home_team} vs ${ev.away_team}`;

    for (const bm of ev.bookmakers ?? []) {
      for (const market of bm.markets ?? []) {
        // h2h/dnb/spreads producen 1 mercado; el resto (btts, props, córners…)
        // pueden producir VARIOS (uno por jugador/línea) vía mapTwoWayGroups.
        let mappedList: { marketKey: string; outcomes: Outcome[] }[];
        if (market.key === "h2h") { const m = mapH2H(ev, market); mappedList = m ? [m] : []; }
        else if (market.key === "draw_no_bet") { const m = mapDrawNoBet(ev, market); mappedList = m ? [m] : []; }
        else if (market.key === "spreads") { const m = mapSpreads(ev, market); mappedList = m ? [m] : []; }
        else { mappedList = mapTwoWayGroups(market); }

        for (const mapped of mappedList) {
          quotes.push({
            eventId: ev.id, // se recalcula en la capa de normalización
            eventName,
            sport,
            marketKey: mapped.marketKey,
            startsAt: ev.commence_time,
            bookmaker: bm.title,
            outcomes: mapped.outcomes,
          });
        }
      }
    }
  }

  return quotes;
}

export interface TheOddsApiConfig {
  apiKey?: string;
  sports?: string[];
  /** Regiones (casas) separadas por comas, p. ej. "eu,uk,us". Más regiones = más casas = más surebets. */
  regions?: string;
  /**
   * Casas concretas (keys de The Odds API), p. ej. ["pinnacle","williamhill"].
   * Si se indica, se usa el parámetro `bookmakers` en vez de `regions` (solo esas
   * casas; hasta 10 cuentan como 1 región → más barato). Ideal para las 2 casas
   * donde tienes cuenta.
   */
  bookmakers?: string[];
  /** Mercados destacados de la llamada masiva /odds, p. ej. ["h2h","totals"]. Por defecto ["h2h"]. */
  markets?: string[];
  /**
   * Mercados ADICIONALES a pedir por-evento (draw_no_bet, btts, córners, tiros…),
   * vía /events/{id}/odds. Vacío por defecto (no gasta cuota extra).
   */
  eventMarkets?: string[];
  /** Máximo de eventos por ciclo para pedir mercados adicionales (control de cuota). Por defecto 10. */
  maxEventsPerCycle?: number;
  baseUrl?: string;
  /** TTL de caché en ms (respeta el rate-limit del plan). 0 = sin caché. */
  cacheTtlMs?: number;
  /** Reintentos ante 429/5xx (por defecto 2). 0 = sin reintentos. */
  retries?: number;
  /** Base del backoff lineal en ms entre reintentos (por defecto 300). */
  retryDelayMs?: number;
  /** Inyectable para tests; por defecto el fetch global de Node 18+. */
  fetchImpl?: typeof fetch;
  /** Reloj inyectable (para tests de caché). Por defecto Date.now. */
  now?: () => number;
  /** Espera inyectable (para tests de reintentos). Por defecto setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

function csvEnv(v: string | undefined): string[] | undefined {
  const parts = v?.split(",").map((s) => s.trim()).filter(Boolean);
  return parts && parts.length > 0 ? parts : undefined;
}

export class TheOddsApiProvider implements OddsProvider {
  readonly name = "the-odds-api";
  private readonly apiKey?: string;
  private readonly sports: string[];
  private readonly regions: string;
  private readonly bookmakers: string[];
  private readonly markets: string[];
  private readonly eventMarkets: string[];
  private readonly maxEventsPerCycle: number;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Caché por (sport|regions|markets): respuesta cruda + instante. */
  private readonly cache = new Map<string, { at: number; events: OddsApiEvent[] }>();

  constructor(config: TheOddsApiConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.ODDS_API_KEY;
    this.sports = config.sports ?? csvEnv(process.env.ODDS_API_SPORTS) ?? ["upcoming"];
    this.regions = config.regions ?? process.env.ODDS_API_REGIONS ?? "eu";
    this.bookmakers = config.bookmakers ?? csvEnv(process.env.ODDS_API_BOOKMAKERS) ?? [];
    this.markets = config.markets ?? csvEnv(process.env.ODDS_API_MARKETS) ?? ["h2h"];
    this.eventMarkets = config.eventMarkets ?? csvEnv(process.env.ODDS_API_EVENT_MARKETS) ?? [];
    const maxEv = config.maxEventsPerCycle ?? Number(process.env.ODDS_API_MAX_EVENTS ?? 10);
    this.maxEventsPerCycle = Number.isFinite(maxEv) && maxEv >= 0 ? maxEv : 10;
    this.baseUrl = config.baseUrl ?? "https://api.the-odds-api.com/v4";
    this.cacheTtlMs = config.cacheTtlMs ?? Number(process.env.ODDS_API_CACHE_TTL_MS ?? 0);
    this.retries = config.retries ?? Number(process.env.ODDS_API_RETRIES ?? 2);
    this.retryDelayMs = config.retryDelayMs ?? Number(process.env.ODDS_API_RETRY_DELAY_MS ?? 300);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => Date.now());
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Ámbito de casas para la URL: `bookmakers=...` (si se fijan) o `regions=...`. */
  private scopeQuery(): string {
    return this.bookmakers.length > 0
      ? `bookmakers=${encodeURIComponent(this.bookmakers.join(","))}`
      : `regions=${encodeURIComponent(this.regions)}`;
  }

  /** Identificador del ámbito para las claves de caché. */
  private scopeId(): string {
    return this.bookmakers.length > 0 ? `b:${this.bookmakers.join(",")}` : `r:${this.regions}`;
  }

  async fetchQuotes(): Promise<ProviderQuote[]> {
    if (!this.apiKey) {
      console.warn(
        "[the-odds-api] sin ODDS_API_KEY: no se consultan datos reales.",
      );
      return [];
    }

    const marketsParam = this.markets.join(",");
    const eventMarketsParam = this.eventMarkets.join(",");
    const all: ProviderQuote[] = [];

    for (const sport of this.sports) {
      // 1) Mercados destacados (llamada masiva /odds): h2h, spreads, totals.
      const events = await this.cached(
        `${sport}|${this.scopeId()}|${marketsParam}`,
        () => this.fetchSportOdds(sport, marketsParam),
      );
      all.push(...mapEventsToQuotes(events));

      // 2) Mercados ADICIONALES por-evento (draw_no_bet, btts, córners, tiros…),
      //    limitado a los N eventos más próximos para controlar la cuota.
      if (this.eventMarkets.length > 0 && events.length > 0) {
        // Los N eventos MÁS PRÓXIMOS (orden por inicio; la API no lo garantiza).
        const targets = [...events]
          .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
          .slice(0, this.maxEventsPerCycle);
        const settled = await Promise.allSettled(
          targets.map((ev) =>
            this.cached(
              `event|${ev.id}|${this.scopeId()}|${eventMarketsParam}`,
              async () => {
                const one = await this.fetchEventOdds(sport, ev.id, eventMarketsParam);
                return one ? [one] : [];
              },
            ),
          ),
        );
        for (const r of settled) {
          if (r.status === "fulfilled") all.push(...mapEventsToQuotes(r.value));
          else console.error("[the-odds-api] mercado por-evento falló:", r.reason);
        }
      }
    }
    return all;
  }

  /** Sirve de caché (si TTL>0) o ejecuta el loader y cachea el resultado. */
  private async cached(key: string, loader: () => Promise<OddsApiEvent[]>): Promise<OddsApiEvent[]> {
    const c = this.cache.get(key);
    if (c && this.cacheTtlMs > 0 && this.now() - c.at < this.cacheTtlMs) return c.events;
    const events = await loader();
    if (this.cacheTtlMs > 0) this.cache.set(key, { at: this.now(), events });
    return events;
  }

  private async fetchSportOdds(sport: string, marketsParam: string): Promise<OddsApiEvent[]> {
    const url =
      `${this.baseUrl}/sports/${encodeURIComponent(sport)}/odds` +
      `?apiKey=${encodeURIComponent(this.apiKey!)}` +
      `&${this.scopeQuery()}` +
      `&markets=${encodeURIComponent(marketsParam)}&oddsFormat=decimal`;
    return this.fetchJson<OddsApiEvent[]>(url, sport);
  }

  private async fetchEventOdds(sport: string, eventId: string, marketsParam: string): Promise<OddsApiEvent | null> {
    const url =
      `${this.baseUrl}/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds` +
      `?apiKey=${encodeURIComponent(this.apiKey!)}` +
      `&${this.scopeQuery()}` +
      `&markets=${encodeURIComponent(marketsParam)}&oddsFormat=decimal`;
    return this.fetchJson<OddsApiEvent>(url, `${sport}/${eventId}`);
  }

  /** GET con reintentos ante 429/5xx (backoff lineal); devuelve el JSON parseado. */
  private async fetchJson<T>(url: string, ctx: string): Promise<T> {
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url);
      if (res.ok) {
        const remaining = res.headers.get("x-requests-remaining");
        if (remaining) console.log(`[the-odds-api] peticiones restantes: ${remaining}`);
        return (await res.json()) as T;
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.retries) {
        attempt++;
        await this.sleep(this.retryDelayMs * attempt);
        continue;
      }
      const body = await res.text().catch(() => "");
      throw new Error(`[the-odds-api] ${ctx}: HTTP ${res.status} ${res.statusText} ${body}`);
    }
  }
}
