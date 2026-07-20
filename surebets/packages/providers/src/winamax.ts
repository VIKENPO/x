import type { OddsProvider, ProviderQuote } from "@x/core";

/**
 * STUB del provider de Winamax.
 *
 * ⚠️ Winamax también protege sus datos, pero suele exponer las cuotas mediante
 * llamadas JSON internas (más abordable que bet365). Aun así, su uso
 * automatizado va contra sus Términos de Servicio; revisa la legalidad.
 *
 * Estrategia recomendada cuando toque implementarlo:
 *   1. Inspeccionar las peticiones XHR/JSON del sitio para localizar el feed.
 *   2. Replicar esas llamadas (con Playwright si hace falta sesión/anti-bot).
 *   3. Mapear IDs de Winamax -> eventId normalizado (capa de matching).
 *
 * De momento devuelve [] para no romper el pipeline.
 */
export class WinamaxProvider implements OddsProvider {
  readonly name = "winamax";

  async fetchQuotes(): Promise<ProviderQuote[]> {
    // TODO(fase 4): implementar captura real de cuotas.
    return [];
  }
}
