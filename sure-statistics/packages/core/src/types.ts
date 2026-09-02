/** Un valor trackeado (de momento acciones US de gran capitalización). */
export interface Ticker {
  symbol: string; // p. ej. "AAPL"
  name: string; // p. ej. "Apple Inc."
}

/** Cotización pre-market/actual de un ticker, normalizada entre providers. */
export interface QuoteSignal {
  symbol: string;
  price: number;
  previousClose: number;
  /** (price - previousClose) / previousClose, en tanto por uno. */
  changeRatio: number;
  /** Fuente del dato (para trazabilidad en el JSON publicado). */
  source: string;
  asOf: string; // ISO
}

/** Un titular o post con su sentimiento ya puntuado. */
export interface ScoredItem {
  text: string;
  url?: string;
  /** Puntuación de sentimiento en [-1, 1] (negativo -> positivo). */
  sentiment: number;
  publishedAt?: string; // ISO
}

/** Sentimiento agregado de una fuente (noticias o Reddit) para un ticker. */
export interface SentimentSignal {
  source: "news" | "reddit";
  symbol: string;
  /** Media de sentimiento en [-1, 1] de los items considerados. */
  averageSentiment: number;
  /** Nº de items considerados (a más items, más confianza). */
  sampleSize: number;
  items: ScoredItem[];
  /** Si `averageSentiment` viene de una evaluación por IA (Claude), motivo en una línea. */
  aiSummary?: string;
}

/** Desglose de las señales que entraron en el score final (para mostrar "por qué"). */
export interface ScoreBreakdown {
  quote?: QuoteSignal;
  marketProxy?: QuoteSignal; // señal de mercado amplio (SPY/QQQ) del mismo ciclo
  news?: SentimentSignal;
  reddit?: SentimentSignal;
}

/** Resultado final para un ticker: probabilidad de que abra/siga al alza. */
export interface TickerScore {
  symbol: string;
  name: string;
  /** Probabilidad estimada de sesgo alcista, en % (0-100). 50 = neutral/sin datos. */
  bullishProbability: number;
  /** Confianza del propio modelo, en % (0-100), según cuántas señales había disponibles. */
  confidence: number;
  breakdown: ScoreBreakdown;
  computedAt: string; // ISO
}

/** Snapshot completo publicado como data/latest.json para el frontend. */
export interface Snapshot {
  generatedAt: string; // ISO
  /** Próxima apertura de Wall Street en hora española (Europe/Madrid), ISO. */
  nextMarketOpenMadrid: string;
  scores: TickerScore[];
}

/** Un punto del gráfico de precio, ya convertido a EUR. */
export interface PriceBar {
  time: string; // ISO
  close: number; // en EUR
}

export type ChartRange = "1D" | "1W" | "1M" | "1Y" | "MAX";

/** Serie de precio (en EUR) de un ticker, publicada en data/charts/<SYMBOL>.json. */
export interface ChartData {
  symbol: string;
  /** Tipo de cambio USD->EUR usado para convertir esta serie. */
  eurRate: number;
  updatedAt: string; // ISO
  series: Record<ChartRange, PriceBar[]>;
}
