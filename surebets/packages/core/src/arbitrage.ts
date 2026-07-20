import type { MarketQuote, BookmakerOdds } from "./types.js";

/** Mejor cuota encontrada para un resultado, con la casa que la ofrece. */
export interface BestOutcome {
  label: string;
  /** Cuota EFECTIVA (neta de comisión) usada para el cálculo y la garantía. */
  bestOdds: number;
  /** Cuota BRUTA que muestra la casa (antes de comisión). Igual a bestOdds si no hay comisión. */
  grossOdds: number;
  bookmaker: string;
  /** Porcentaje del capital total a apostar en este resultado (0-1). */
  stakeFraction: number;
}

/**
 * Comisiones por defecto de exchanges conocidos (fracción sobre la ganancia).
 * Las cuotas de un exchange rinden menos de lo que muestran: la ganancia neta es
 * `1 + (cuota-1)·(1-comisión)`. Ignorarlo genera surebets FALSAS.
 * El emparejamiento es por subcadena en minúsculas del nombre de la casa.
 */
export const DEFAULT_EXCHANGE_COMMISSIONS: Record<string, number> = {
  betfair: 0.05,
  smarkets: 0.02,
  betdaq: 0.02,
  matchbook: 0.02,
};

/** Comisión aplicable a una casa según la tabla (0 si no aplica). */
export function commissionFor(bookmaker: string, table?: Record<string, number>): number {
  if (!table) return 0;
  const name = bookmaker.toLowerCase();
  for (const [k, v] of Object.entries(table)) {
    if (name.includes(k.toLowerCase())) return v;
  }
  return 0;
}

/** Cuota neta tras aplicar la comisión sobre la ganancia. */
export function netOdds(odds: number, commission: number): number {
  return commission > 0 ? 1 + (odds - 1) * (1 - commission) : odds;
}

/** Una oportunidad de arbitraje (surebet) detectada en un mercado. */
export interface Surebet {
  eventId: string;
  eventName: string;
  sport: string;
  marketKey: string;
  startsAt: string;
  /** Mejor cuota por resultado y su reparto de capital óptimo. */
  outcomes: BestOutcome[];
  /** Suma de probabilidades implícitas (Σ 1/cuota). < 1 => surebet. */
  totalImpliedProbability: number;
  /** Margen de beneficio garantizado sobre el capital (0.03 = 3%). */
  profitMargin: number;
}

const EPSILON = 1e-9;

/** Opciones de detección/filtrado de surebets. */
export interface SurebetOptions {
  /** Margen mínimo para reportar (0.005 = 0.5%). */
  minProfitMargin?: number;
  /**
   * Margen máximo plausible. Un margen por encima casi siempre indica cuotas
   * obsoletas o un matching de eventos erróneo (se cruzaron dos eventos que no
   * son el mismo) => se descarta por fiabilidad. Por defecto no hay tope.
   */
  maxProfitMargin?: number;
  /**
   * Referencia temporal "ahora" (ms epoch, ISO string o Date). Si se indica, se
   * descartan las surebets de eventos ya empezados o que empiezan en < minLeadMs.
   */
  now?: number | string | Date;
  /** Antelación mínima al inicio para que la surebet sea accionable (ms). */
  minLeadMs?: number;
  /**
   * Comisiones por casa (fracción sobre ganancia), p. ej. { betfair: 0.05 }.
   * Se aplican a las cuotas antes de calcular, para no reportar surebets falsas
   * por exchanges. Emparejamiento por subcadena del nombre. Ver DEFAULT_EXCHANGE_COMMISSIONS.
   */
  commission?: Record<string, number>;
}

function toMillis(t: number | string | Date): number {
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  return Date.parse(t);
}

function normalizeOptions(opt?: number | SurebetOptions): SurebetOptions {
  // Compatibilidad: un número posicional se interpreta como minProfitMargin.
  if (typeof opt === "number") return { minProfitMargin: opt };
  return opt ?? {};
}

/** Mejor cuota (máxima) que una casa ofrece para un label; 0 si no lo ofrece. */
function bestOddsForLabel(book: BookmakerOdds, label: string): number {
  let best = 0;
  for (const o of book.outcomes) if (o.label === label && o.odds > best) best = o.odds;
  return best;
}

/**
 * Analiza un mercado y devuelve una surebet si existe.
 *
 * Matemática:
 *   - prob. implícita de una cuota decimal = 1 / cuota
 *   - se toma la MEJOR cuota (máxima) de cada resultado entre todas las casas
 *   - S = Σ (1 / mejor_cuota_i)
 *   - si S < 1  => hay arbitraje garantizado
 *   - beneficio garantizado sobre el capital = (1 / S) - 1
 *   - reparto óptimo: stake_i = (1 / mejor_cuota_i) / S
 *
 * @param market   mercado con las cuotas de todas las casas ya agrupadas
 * @param options  margen mínimo (número, compatibilidad) u opciones completas
 */
export function findSurebet(
  market: MarketQuote,
  options: number | SurebetOptions = 0,
): Surebet | null {
  const { minProfitMargin = 0, maxProfitMargin, now, minLeadMs = 0, commission } =
    normalizeOptions(options);

  if (market.books.length < 2) return null;

  // Filtro temporal: descartar eventos ya empezados, demasiado próximos, o con
  // fecha no parseable (no se puede verificar que sea accionable).
  if (now !== undefined) {
    const lead = toMillis(market.startsAt) - toMillis(now);
    if (Number.isNaN(lead) || lead < minLeadMs) return null;
  }

  // Conjunto de resultados esperado: la unión de labels de todas las casas.
  const labels = new Set<string>();
  for (const book of market.books) {
    for (const o of book.outcomes) labels.add(o.label);
  }
  if (labels.size < 2) return null;

  const best: BestOutcome[] = [];
  for (const label of labels) {
    // Se elige la casa con la MEJOR cuota NETA (tras comisión), no la bruta:
    // un exchange con cuota alta puede rendir menos que otra casa sin comisión.
    let bestNet = 0;
    let bestGross = 0;
    let bestBook = "";
    for (const book of market.books) {
      const gross = bestOddsForLabel(book, label);
      if (gross <= 0) continue;
      const net = netOdds(gross, commissionFor(book.bookmaker, commission));
      if (net > bestNet) {
        bestNet = net;
        bestGross = gross;
        bestBook = book.bookmaker;
      }
    }
    // Si algún resultado no tiene cuota en ninguna casa, no se puede cubrir.
    if (bestNet <= 1) return null;
    best.push({ label, bestOdds: bestNet, grossOdds: bestGross, bookmaker: bestBook, stakeFraction: 0 });
  }

  const sumInverse = best.reduce((acc, o) => acc + 1 / o.bestOdds, 0);
  const profitMargin = 1 / sumInverse - 1;

  if (sumInverse >= 1 - EPSILON) return null; // no hay arbitraje
  if (profitMargin < minProfitMargin) return null;
  // Tope de plausibilidad: un margen absurdamente alto = datos malos.
  if (maxProfitMargin !== undefined && profitMargin > maxProfitMargin) return null;

  for (const o of best) {
    o.stakeFraction = 1 / o.bestOdds / sumInverse;
  }

  return {
    eventId: market.eventId,
    eventName: market.eventName,
    sport: market.sport,
    marketKey: market.marketKey,
    startsAt: market.startsAt,
    outcomes: best,
    totalImpliedProbability: sumInverse,
    profitMargin,
  };
}

/** Aplica findSurebet a muchos mercados y devuelve las surebets ordenadas por margen. */
export function findSurebets(
  markets: MarketQuote[],
  options: number | SurebetOptions = 0,
): Surebet[] {
  return markets
    .map((m) => findSurebet(m, options))
    .filter((s): s is Surebet => s !== null)
    .sort((a, b) => b.profitMargin - a.profitMargin);
}

/** Calcula el reparto concreto de capital para una surebet dada. */
export function stakePlan(
  surebet: Surebet,
  totalStake: number,
): { label: string; bookmaker: string; odds: number; stake: number; payout: number }[] {
  return surebet.outcomes.map((o) => {
    const stake = totalStake * o.stakeFraction;
    return {
      label: o.label,
      bookmaker: o.bookmaker,
      odds: o.bestOdds,
      stake: round2(stake),
      payout: round2(stake * o.bestOdds),
    };
  });
}

/** Una pata del reparto de capital. */
export interface StakeLeg {
  label: string;
  bookmaker: string;
  /** Cuota efectiva (neta de comisión) con la que se calcula el retorno. */
  odds: number;
  /** Cuota bruta que muestra la casa (para el usuario). */
  grossOdds: number;
  stake: number;
  payout: number;
}

/** Reparto de capital con la GARANTÍA REAL tras redondear los stakes. */
export interface StakeSummary {
  legs: StakeLeg[];
  /** Capital total realmente apostado (suma de stakes redondeados). */
  totalStaked: number;
  /** Retorno del PEOR resultado (el que menos paga). */
  worstCasePayout: number;
  /** Beneficio garantizado real = worstCasePayout - totalStaked. */
  guaranteedProfit: number;
  /** Margen garantizado real = guaranteedProfit / totalStaked. */
  guaranteedMargin: number;
}

/**
 * Como `stakePlan`, pero redondea los stakes a un incremento apostable
 * (`roundTo`) y calcula la garantía REAL con esos stakes ya redondeados.
 *
 * El redondeo puede erosionar levemente la garantía teórica; en vez de
 * ocultarlo, se expone `worstCasePayout`/`guaranteedProfit` para saber el
 * beneficio realmente asegurado (el del peor resultado).
 */
export function stakeSummary(
  surebet: Surebet,
  totalStake: number,
  roundTo = 0.01,
): StakeSummary {
  const step = roundTo > 0 ? roundTo : 0.01;
  const legs: StakeLeg[] = surebet.outcomes.map((o) => {
    const stake = round2(Math.round((totalStake * o.stakeFraction) / step) * step);
    return {
      label: o.label,
      bookmaker: o.bookmaker,
      odds: o.bestOdds,
      grossOdds: o.grossOdds,
      stake,
      payout: round2(stake * o.bestOdds),
    };
  });
  const totalStaked = round2(legs.reduce((a, l) => a + l.stake, 0));
  const worstCasePayout = round2(Math.min(...legs.map((l) => l.payout)));
  const guaranteedProfit = round2(worstCasePayout - totalStaked);
  const guaranteedMargin = totalStaked > 0 ? guaranteedProfit / totalStaked : 0;
  return { legs, totalStaked, worstCasePayout, guaranteedProfit, guaranteedMargin };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
