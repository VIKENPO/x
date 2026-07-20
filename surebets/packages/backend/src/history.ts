import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Alert } from "./monitor.js";

/**
 * Histórico de alertas de surebets.
 *
 * Guarda un registro ligero (sin la surebet completa) de cada alerta emitida por
 * el monitor. Mantiene las últimas `maxItems` en memoria y, si se indica un
 * fichero, las persiste en formato JSONL (una entrada por línea) para que el
 * histórico sobreviva a reinicios. Sin fichero funciona solo en memoria.
 *
 * Es dependency-free (solo `node:fs`) y con reloj inyectable para tests.
 */

export interface HistoryEntry {
  /** Instante de registro (ms epoch). */
  at: number;
  type: Alert["type"];
  key: string;
  eventName: string;
  sport: string;
  marketKey: string;
  profitMargin: number;
  previousMargin?: number;
}

export interface HistoryStoreOptions {
  /** Ruta a un fichero JSONL para persistir. Si se omite, solo memoria. */
  file?: string;
  /** Máximo de entradas en memoria (por defecto 500). */
  maxItems?: number;
  /** Reloj inyectable (para tests). Por defecto Date.now. */
  now?: () => number;
}

export class HistoryStore {
  /** Entradas ordenadas de más antigua (inicio) a más reciente (final). */
  private items: HistoryEntry[] = [];
  private readonly file?: string;
  private readonly maxItems: number;
  private readonly now: () => number;

  constructor(opts: HistoryStoreOptions = {}) {
    this.file = opts.file;
    this.maxItems = opts.maxItems ?? 500;
    this.now = opts.now ?? (() => Date.now());
    if (this.file && existsSync(this.file)) this.load();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.file!, "utf8");
    } catch {
      this.items = []; // fichero ausente/ilegible
      return;
    }
    // Parseo línea a línea: una línea corrupta (p. ej. crash a mitad de escritura)
    // se salta, sin descartar el resto del histórico.
    const out: HistoryEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as HistoryEntry);
      } catch {
        // línea corrupta: ignorar
      }
    }
    this.items = out.slice(-this.maxItems);
  }

  /** Registra un lote de alertas y devuelve las entradas creadas. */
  record(alerts: Alert[]): HistoryEntry[] {
    const at = this.now();
    const entries: HistoryEntry[] = alerts.map((a) => ({
      at,
      type: a.type,
      key: a.key,
      eventName: a.surebet.eventName,
      sport: a.surebet.sport,
      marketKey: a.surebet.marketKey,
      profitMargin: a.profitMargin,
      ...(a.previousMargin != null ? { previousMargin: a.previousMargin } : {}),
    }));
    if (entries.length === 0) return entries;

    this.items.push(...entries);
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(-this.maxItems);
    }
    this.append(entries);
    return entries;
  }

  private append(entries: HistoryEntry[]): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    } catch {
      // No bloquear el monitor por un fallo de disco.
    }
  }

  /** Últimas `limit` entradas, de más reciente a más antigua. */
  recent(limit = 100): HistoryEntry[] {
    return this.items.slice(-limit).reverse();
  }

  size(): number {
    return this.items.length;
  }
}
