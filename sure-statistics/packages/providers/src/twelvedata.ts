/**
 * Histórico de precio vía Twelve Data (https://twelvedata.com), API oficial
 * con tier gratuito (800 créditos/día, 8/min). Ni Finnhub gratis ni ninguna
 * fuente ya usada en este proyecto da velas históricas gratis, así que se
 * añade este segundo provider solo para el gráfico de precio.
 *
 * Config por variable de entorno: TWELVEDATA_API_KEY (gratis en twelvedata.com).
 * Sin key, devuelve `[]` (el gráfico de esa serie no se muestra, igual que
 * el resto de señales opcionales del proyecto).
 */

export interface TwelveDataConfig {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Barra cruda en USD (moneda nativa de Twelve Data para tickers de EE. UU.). */
export interface RawBar {
  time: string; // ISO
  close: number; // en USD
}

interface TwelveDataValue {
  datetime: string;
  close: string;
}

interface TwelveDataResponse {
  status?: string;
  values?: TwelveDataValue[];
}

function resolveConfig(config: TwelveDataConfig) {
  return {
    apiKey: config.apiKey ?? process.env.TWELVEDATA_API_KEY,
    baseUrl: config.baseUrl ?? "https://api.twelvedata.com",
    fetchImpl: config.fetchImpl ?? fetch,
  };
}

/** Convierte la respuesta cruda de /time_series en RawBar[] ascendente por fecha. Pura. */
export function mapTwelveDataSeries(raw: TwelveDataResponse): RawBar[] {
  if (raw?.status !== "ok" || !raw.values) return [];
  return raw.values
    .map((v) => ({ time: new Date(v.datetime).toISOString(), close: Number(v.close) }))
    .filter((b) => Number.isFinite(b.close))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** `interval`: "5min" | "1h" | "1day" | "1month" (los que usa el pipeline). */
export async function fetchTimeSeries(
  symbol: string,
  interval: string,
  outputsize: number,
  config: TwelveDataConfig = {},
): Promise<RawBar[]> {
  const { apiKey, baseUrl, fetchImpl } = resolveConfig(config);
  if (!apiKey) {
    console.warn(`[twelvedata] sin TWELVEDATA_API_KEY: no se consulta histórico de ${symbol}.`);
    return [];
  }
  const url =
    `${baseUrl}/time_series?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}&outputsize=${outputsize}` +
    `&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`[twelvedata] time_series ${symbol}/${interval}: HTTP ${res.status} ${res.statusText}`);
  const raw = (await res.json()) as TwelveDataResponse;
  if (raw.status && raw.status !== "ok") {
    console.warn(`[twelvedata] ${symbol}/${interval}: respuesta no-ok (${JSON.stringify(raw).slice(0, 200)})`);
    return [];
  }
  return mapTwelveDataSeries(raw);
}
