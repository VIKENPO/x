/**
 * Tipos de dominio compartidos por todo el sistema.
 *
 * Todas las cuotas son DECIMALES (formato europeo): 2.0 = pagar el doble.
 * La probabilidad implícita de una cuota decimal es 1 / cuota.
 */

/** Un resultado posible de un mercado con su cuota decimal. */
export interface Outcome {
  /** Identificador NORMALIZADO del resultado.
   *  Para 1x2: "home" | "draw" | "away".
   *  Para h2h de tenis: nombre normalizado del jugador. */
  label: string;
  /** Cuota decimal (> 1). */
  odds: number;
}

/**
 * Cuotas de UNA casa para UN mercado de UN evento.
 * Es lo que devuelve cada provider (una casa = un provider, normalmente).
 */
export interface ProviderQuote {
  /** ID normalizado del evento; debe coincidir entre casas para poder cruzar. */
  eventId: string;
  /** Nombre legible del evento, p. ej. "Real Madrid vs Barcelona". */
  eventName: string;
  /** Deporte, p. ej. "football", "tennis". */
  sport: string;
  /** Clave normalizada del mercado, p. ej. "1x2", "h2h". */
  marketKey: string;
  /** Inicio del evento en ISO-8601. */
  startsAt: string;
  /** Nombre de la casa de apuestas. */
  bookmaker: string;
  /** Cuotas de esta casa para cada resultado del mercado. */
  outcomes: Outcome[];
}

/** Cuotas de una casa concreta dentro de un mercado ya agrupado. */
export interface BookmakerOdds {
  bookmaker: string;
  outcomes: Outcome[];
}

/**
 * Un mercado de un evento con las cuotas de TODAS las casas ya agrupadas.
 * Resultado de fusionar los ProviderQuote de las distintas fuentes.
 */
export interface MarketQuote {
  eventId: string;
  eventName: string;
  sport: string;
  marketKey: string;
  startsAt: string;
  books: BookmakerOdds[];
}

/** Interfaz que implementa cada fuente de cuotas (API o scraper). */
export interface OddsProvider {
  /** Nombre único de la fuente. */
  readonly name: string;
  /** Devuelve las cuotas actuales de esta fuente. */
  fetchQuotes(): Promise<ProviderQuote[]>;
}
