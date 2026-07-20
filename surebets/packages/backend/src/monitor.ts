import { EventEmitter } from "node:events";
import {
  buildMarkets,
  findSurebets,
  type ProviderQuote,
  type Surebet,
  type SurebetOptions,
} from "@x/core";

/**
 * Monitor en tiempo real de surebets.
 *
 * En cada "tick" recoge cuotas, calcula las surebets actuales y las compara con
 * las del tick anterior para emitir ALERTAS:
 *   - "new":      surebet que no existía antes,
 *   - "changed":  surebet cuyo margen cambió por encima de un umbral,
 *   - "resolved": surebet que ha desaparecido (ya no hay arbitraje).
 *
 * La lógica de diffing es independiente de los timers (método `tick()`), por lo
 * que se puede testear de forma determinista.
 *
 * Eventos emitidos:
 *   "update" (surebets: Surebet[])   -> lista completa tras cada tick
 *   "alerts" (alerts: Alert[])       -> solo si hay novedades
 *   "monitor-error" (err: unknown)   -> si un tick falla (el bucle continúa)
 */

export type AlertType = "new" | "changed" | "resolved";

export interface Alert {
  type: AlertType;
  key: string;
  surebet: Surebet;
  profitMargin: number;
  previousMargin?: number;
}

export interface MonitorOptions {
  /** Fuente de cuotas (normalmente agrega todos los providers activos). */
  collect: () => Promise<ProviderQuote[]>;
  /** Margen mínimo para considerar una surebet. */
  minProfitMargin?: number;
  /** Margen máximo plausible (fiabilidad): por encima se descarta. Sin tope si no se indica. */
  maxProfitMargin?: number;
  /** Antelación mínima al inicio (ms) para reportar. Si se indica, se filtran eventos empezados. */
  minLeadMs?: number;
  /** Reloj inyectable (para tests). Por defecto Date.now. */
  now?: () => number;
  /** Periodo de sondeo en ms. */
  intervalMs?: number;
  /** Variación de margen (en tanto por uno) para emitir "changed". */
  marginChangeThreshold?: number;
  /** Presupuesto total de peticiones a la API (BYOK). Sin límite si se omite. */
  requestBudget?: number;
  /** Coste en peticiones de cada sondeo (regions×markets×sports). Por defecto 1. */
  requestCostPerTick?: number;
  /** Comisiones por casa (exchanges) para ajustar cuotas y evitar falsos positivos. */
  commission?: Record<string, number>;
}

function keyOf(s: Surebet): string {
  return `${s.eventId}::${s.marketKey}`;
}

export class SurebetMonitor extends EventEmitter {
  private prev = new Map<string, Surebet>();
  private timer?: ReturnType<typeof setInterval>;

  private readonly collect: () => Promise<ProviderQuote[]>;
  private readonly minProfitMargin: number;
  private readonly maxProfitMargin?: number;
  private readonly minLeadMs?: number;
  private readonly now: () => number;
  private readonly intervalMs: number;
  private readonly marginChangeThreshold: number;
  private readonly requestBudget?: number;
  private readonly requestCostPerTick: number;
  private readonly commission?: Record<string, number>;
  private used = 0;
  private running = false;

  constructor(opts: MonitorOptions) {
    super();
    this.collect = opts.collect;
    this.minProfitMargin = opts.minProfitMargin ?? 0;
    this.maxProfitMargin = opts.maxProfitMargin;
    this.minLeadMs = opts.minLeadMs;
    this.now = opts.now ?? (() => Date.now());
    this.intervalMs = opts.intervalMs ?? 15_000;
    this.marginChangeThreshold = opts.marginChangeThreshold ?? 0.005;
    this.requestBudget = opts.requestBudget;
    this.requestCostPerTick = opts.requestCostPerTick ?? 1;
    this.commission = opts.commission;
  }

  /** Peticiones consumidas hasta ahora. */
  requestsUsed(): number {
    return this.used;
  }

  /** Presupuesto restante (null si no hay límite). */
  requestsRemaining(): number | null {
    return this.requestBudget == null ? null : Math.max(0, this.requestBudget - this.used);
  }

  /** Construye las opciones de detección para este monitor. */
  private surebetOptions(): SurebetOptions {
    const options: SurebetOptions = { minProfitMargin: this.minProfitMargin };
    if (this.maxProfitMargin !== undefined) options.maxProfitMargin = this.maxProfitMargin;
    if (this.minLeadMs !== undefined) {
      options.now = this.now();
      options.minLeadMs = this.minLeadMs;
    }
    if (this.commission) options.commission = this.commission;
    return options;
  }

  /** Surebets vigentes tras el último tick. */
  current(): Surebet[] {
    return [...this.prev.values()];
  }

  /** Ejecuta un ciclo: recoge, calcula, compara y emite. Devuelve las alertas. */
  async tick(): Promise<Alert[]> {
    const quotes = await this.collect();
    const surebets = findSurebets(buildMarkets(quotes), this.surebetOptions());
    const currentMap = new Map(surebets.map((s) => [keyOf(s), s]));
    const alerts: Alert[] = [];

    // Nuevas y modificadas.
    for (const [key, s] of currentMap) {
      const before = this.prev.get(key);
      if (!before) {
        alerts.push({ type: "new", key, surebet: s, profitMargin: s.profitMargin });
      } else if (
        Math.abs(s.profitMargin - before.profitMargin) >= this.marginChangeThreshold
      ) {
        alerts.push({
          type: "changed", key, surebet: s,
          profitMargin: s.profitMargin, previousMargin: before.profitMargin,
        });
      }
    }

    // Resueltas (ya no aparecen).
    for (const [key, s] of this.prev) {
      if (!currentMap.has(key)) {
        alerts.push({ type: "resolved", key, surebet: s, profitMargin: s.profitMargin });
      }
    }

    this.prev = currentMap;
    this.emit("update", surebets);
    if (alerts.length > 0) this.emit("alerts", alerts);
    return alerts;
  }

  /** Arranca el sondeo periódico (hace un tick inmediato). */
  start(): void {
    if (this.timer) return;
    const run = async () => {
      // Evita solapar ticks: si el sondeo anterior sigue en curso (red lenta),
      // se salta este disparo (no dobla el gasto ni corrompe el diffing).
      if (this.running) return;
      // Presupuesto de peticiones (BYOK): parar ANTES de gastar de más.
      if (this.requestBudget != null && this.used + this.requestCostPerTick > this.requestBudget) {
        this.stop();
        this.emit("budget-reached", { used: this.used, budget: this.requestBudget });
        return;
      }
      this.running = true;
      // Se contabiliza el gasto del sondeo (aunque falle: la llamada se hizo).
      this.used += this.requestCostPerTick;
      this.emit("budget", {
        used: this.used,
        budget: this.requestBudget ?? null,
        remaining: this.requestsRemaining(),
      });
      try {
        await this.tick();
      } catch (err) {
        this.emit("monitor-error", err);
      } finally {
        this.running = false;
      }
    };
    // El intervalo se crea ANTES del tick inmediato: así, si el presupuesto se
    // agota ya en el primer run, su stop() encuentra el timer y lo cancela
    // (evita que el intervalo siga disparando budget-reached).
    this.timer = setInterval(run, this.intervalMs);
    run();
  }

  /** Detiene el sondeo. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
