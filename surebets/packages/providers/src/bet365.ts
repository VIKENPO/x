import type { OddsProvider, ProviderQuote } from "@x/core";

/**
 * STUB del provider de bet365.
 *
 * ⚠️ bet365 es de las casas MÁS difíciles de integrar:
 *   - Anti-bot muy agresivo (detección de navegador, huella, retos JS).
 *   - Las cuotas llegan por WebSocket con un protocolo propio y ofuscado.
 *   - Scrapearla va contra sus Términos de Servicio y puede provocar bloqueos.
 *
 * Estrategia recomendada cuando toque implementarlo:
 *   1. Navegador real con Playwright (stealth) para levantar la sesión.
 *   2. Capturar/decodificar el feed WebSocket de cuotas.
 *   3. Mapear IDs de bet365 -> eventId normalizado (capa de matching).
 *
 * De momento devuelve [] para no romper el pipeline.
 */
export class Bet365Provider implements OddsProvider {
  readonly name = "bet365";

  async fetchQuotes(): Promise<ProviderQuote[]> {
    // TODO(fase 4): implementar captura real de cuotas.
    return [];
  }
}
