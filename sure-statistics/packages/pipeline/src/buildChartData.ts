import type { ChartData, PriceBar } from "@ss/core";
import type { RawBar } from "@ss/providers";

/** Cuántas barras diarias tira cada rango hacia atrás (recorte simple sobre la serie diaria). */
const ONE_MONTH_DAYS = 22; // ~1 mes bursátil
const ONE_YEAR_DAYS = 260; // ~1 año bursátil

export interface RawSeries {
  /** Velas de 5min del día en curso -> rango "1D". */
  intraday: RawBar[];
  /** Velas horarias de la última semana -> rango "1W". */
  hourly: RawBar[];
  /** Velas diarias (>=1 año) -> se recortan para "1M" y "1Y". */
  daily: RawBar[];
  /** Velas mensuales (histórico largo) -> rango "MAX". */
  monthly: RawBar[];
}

function toEur(bars: RawBar[], eurRate: number): PriceBar[] {
  return bars.map((b) => ({ time: b.time, close: b.close * eurRate }));
}

/**
 * Combina las series crudas (en USD) en el ChartData publicado (en EUR).
 * Pura: no toca red ni disco, así que es fácil de testear con fixtures.
 */
export function buildChartData(symbol: string, raw: RawSeries, eurRate: number, now: () => Date = () => new Date()): ChartData {
  return {
    symbol,
    eurRate,
    updatedAt: now().toISOString(),
    series: {
      "1D": toEur(raw.intraday, eurRate),
      "1W": toEur(raw.hourly, eurRate),
      "1M": toEur(raw.daily.slice(-ONE_MONTH_DAYS), eurRate),
      "1Y": toEur(raw.daily.slice(-ONE_YEAR_DAYS), eurRate),
      MAX: toEur(raw.monthly, eurRate),
    },
  };
}
