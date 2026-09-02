/**
 * Tipo de cambio USD -> EUR vía Frankfurter (https://frankfurter.app), API
 * gratuita, sin clave y sin límite de uso razonable, basada en datos
 * oficiales del Banco Central Europeo. Se usa para mostrar todos los precios
 * en euros, como pide el proyecto.
 */

export interface FrankfurterConfig {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface FrankfurterResponse {
  rates?: { EUR?: number };
}

/** Extrae la tasa EUR de la respuesta cruda. Pura. */
export function mapFrankfurterRate(raw: FrankfurterResponse): number | null {
  const rate = raw?.rates?.EUR;
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}

/** Cuántos EUR vale 1 USD ahora mismo. `null` si la fuente falla (el pipeline sigue en USD ese ciclo). */
export async function fetchUsdToEurRate(config: FrankfurterConfig = {}): Promise<number | null> {
  const baseUrl = config.baseUrl ?? "https://api.frankfurter.app";
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(`${baseUrl}/latest?from=USD&to=EUR`);
  if (!res.ok) throw new Error(`[frankfurter] latest: HTTP ${res.status} ${res.statusText}`);
  const raw = (await res.json()) as FrankfurterResponse;
  return mapFrankfurterRate(raw);
}
