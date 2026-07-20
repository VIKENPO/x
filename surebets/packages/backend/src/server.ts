import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { WebSocketServer, type WebSocket } from "ws";
import {
  buildMarkets,
  findSurebets,
  stakeSummary,
  DEFAULT_EXCHANGE_COMMISSIONS,
  type ProviderQuote,
  type Surebet,
  type SurebetOptions,
} from "@x/core";
import { activeProviders, TheOddsApiProvider } from "@x/providers";
import { SurebetMonitor, type Alert } from "./monitor.js";
import { HistoryStore } from "./history.js";

// Carga el .env de la raíz del repo si existe (nativo de Node 20.12+).
// Sin .env / sin ODDS_API_KEY, el sistema usa los providers de ejemplo.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
try {
  process.loadEnvFile(path.join(repoRoot, ".env"));
} catch {
  // No hay .env: se continúa con los valores por defecto.
}

const PORT = Number(process.env.PORT ?? 4000);
const MIN_PROFIT = Number(process.env.MIN_PROFIT_MARGIN ?? 0);
// Tope de plausibilidad (fiabilidad): márgenes por encima suelen ser datos malos
// o eventos mal cruzados. Por defecto 0.5 (50%). Pon 0 para desactivarlo.
const MAX_PROFIT = Number(process.env.MAX_PROFIT_MARGIN ?? 0.5);
// Filtro temporal (accionabilidad): antelación mínima al inicio, en ms. Opcional:
// si no se define, no se filtra por tiempo (útil para la demo con fixtures).
const MIN_LEAD_MS = process.env.MIN_LEAD_MS !== undefined ? Number(process.env.MIN_LEAD_MS) : undefined;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15_000);

// Coste en peticiones de cada sondeo a The Odds API = sports × regions × markets.
// Sirve para descontar el presupuesto (BYOK) de cada usuario.
const OA_SPORTS = process.env.ODDS_API_SPORTS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["upcoming"];
const OA_REGIONS = (process.env.ODDS_API_REGIONS ?? "eu").split(",").map((s) => s.trim()).filter(Boolean);
const OA_MARKETS = process.env.ODDS_API_MARKETS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["h2h"];
const OA_EVENT_MARKETS = process.env.ODDS_API_EVENT_MARKETS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const OA_BOOKMAKERS = process.env.ODDS_API_BOOKMAKERS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const OA_MAX_EVENTS = Number(process.env.ODDS_API_MAX_EVENTS ?? 10);
// Con `bookmakers`, hasta 10 casas cuentan como 1 región; si no, cuenta cada región.
const REGION_EQUIV = OA_BOOKMAKERS.length > 0 ? Math.ceil(OA_BOOKMAKERS.length / 10) : OA_REGIONS.length;
// Coste máximo (cota superior): masiva (sports×regionEquiv×markets) + adicionales
// por-evento (sports×maxEventos×regionEquiv×eventMarkets). Conservador.
const REQUEST_COST = Math.max(
  1,
  OA_SPORTS.length * REGION_EQUIV * OA_MARKETS.length +
    (OA_EVENT_MARKETS.length > 0
      ? OA_SPORTS.length * Math.max(0, OA_MAX_EVENTS) * REGION_EQUIV * OA_EVENT_MARKETS.length
      : 0),
);

// Persistencia del histórico de alertas. Si se define, se guarda en ese fichero
// JSONL y sobrevive a reinicios; si no, el histórico es solo en memoria.
const HISTORY_FILE = process.env.HISTORY_FILE || undefined;
const HISTORY_MAX = Number(process.env.HISTORY_MAX ?? 1000);

// Histórico de alertas (memoria + JSONL opcional).
const history = new HistoryStore({
  file: HISTORY_FILE,
  maxItems: Number.isFinite(HISTORY_MAX) && HISTORY_MAX > 0 ? HISTORY_MAX : 1000,
});

/** Opciones de detección compartidas por el endpoint REST y el monitor. */
function surebetOptions(minProfitOverride?: number): SurebetOptions {
  const options: SurebetOptions = {
    minProfitMargin: minProfitOverride ?? MIN_PROFIT,
  };
  if (Number.isFinite(MAX_PROFIT) && MAX_PROFIT > 0) options.maxProfitMargin = MAX_PROFIT;
  if (MIN_LEAD_MS !== undefined && Number.isFinite(MIN_LEAD_MS)) {
    options.now = Date.now();
    options.minLeadMs = MIN_LEAD_MS;
  }
  options.commission = DEFAULT_EXCHANGE_COMMISSIONS;
  return options;
}

const app = express();
app.use(cors());
app.use(express.json());

/** Key BYOK que llega en la cabecera de la petición (o undefined). */
function clientKey(req: express.Request): string | undefined {
  const k = (req.header("x-odds-api-key") || "").trim();
  return k.length > 0 ? k : undefined;
}

/**
 * Ejecuta los providers y devuelve sus cuotas combinadas.
 * Si se pasa `apiKey` (BYOK), usa The Odds API con ESA key (cuota del usuario);
 * si no, usa los providers activos (key del servidor o fixtures).
 */
async function collectQuotes(apiKey?: string): Promise<ProviderQuote[]> {
  const providers = apiKey ? [new TheOddsApiProvider({ apiKey })] : activeProviders();
  const results = await Promise.allSettled(providers.map((p) => p.fetchQuotes()));
  const quotes: ProviderQuote[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      quotes.push(...r.value);
    } else {
      console.error(`[provider ${providers[i].name}] falló:`, r.reason);
    }
  });
  return quotes;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    providers: activeProviders().map((p) => p.name),
    requestCost: REQUEST_COST, // créditos por sondeo (para estimar ritmo en la UI)
    pollDefaultMs: POLL_INTERVAL_MS,
  });
});

/**
 * Valida una API key (cabecera x-odds-api-key, o la del servidor): hace una
 * petición mínima (1 crédito) y distingue válida / inválida / agotada.
 * Devuelve `remaining` (créditos restantes) si la cabecera está disponible.
 */
app.get("/api/validate", async (req, res) => {
  const key = clientKey(req) || process.env.ODDS_API_KEY;
  if (!key) {
    res.json({ valid: false, reason: "missing" });
    return;
  }
  const url =
    `https://api.the-odds-api.com/v4/sports/upcoming/odds` +
    `?apiKey=${encodeURIComponent(key)}&regions=us&markets=h2h&oddsFormat=decimal`;
  try {
    const r = await fetch(url);
    if (r.ok) {
      const rem = Number(r.headers.get("x-requests-remaining"));
      res.json({ valid: true, remaining: Number.isFinite(rem) ? rem : null });
      return;
    }
    const body = await r.text().catch(() => "");
    const exhausted = r.status === 429 || /usage|quota|credit/i.test(body);
    res.json({ valid: false, reason: exhausted ? "exhausted" : "invalid", status: r.status });
  } catch {
    res.json({ valid: false, reason: "network" });
  }
});

/** Cuotas crudas combinadas de todas las casas (para depurar). */
app.get("/api/quotes", async (req, res) => {
  const quotes = await collectQuotes(clientKey(req));
  res.json(buildMarkets(quotes));
});

/**
 * Oportunidades de arbitraje detectadas.
 * Query params:
 *   minProfit  margen mínimo (0.01 = 1%).
 *   stake      si se indica (> 0), cada surebet incluye `plan` con el reparto de
 *              capital y el beneficio GARANTIZADO real (stakeSummary) para esa banca.
 */
app.get("/api/opportunities", async (req, res) => {
  const minProfit = Number(req.query.minProfit ?? MIN_PROFIT);
  const stake = Number(req.query.stake);
  const hasStake = Number.isFinite(stake) && stake > 0;

  const quotes = await collectQuotes(clientKey(req));
  const markets = buildMarkets(quotes);
  const surebets = findSurebets(
    markets,
    surebetOptions(Number.isFinite(minProfit) ? minProfit : undefined),
  );

  const payload = hasStake
    ? surebets.map((sb) => ({ ...sb, plan: stakeSummary(sb, stake) }))
    : surebets;

  res.json({
    count: surebets.length,
    ...(hasStake ? { stake } : {}),
    surebets: payload,
  });
});

/** Histórico de alertas (más recientes primero). Query: limit (def. 100). */
app.get("/api/history", (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  const alerts = history.recent(Number.isFinite(limit) && limit > 0 ? limit : 100);
  res.json({ count: alerts.length, total: history.size(), alerts });
});

const server = app.listen(PORT, () => {
  console.log(`[backend] escuchando en http://localhost:${PORT}`);
  console.log(`[backend] REST  GET /api/opportunities`);
  console.log(`[backend] WS    ws://localhost:${PORT}/ws  (tiempo real)`);
});

// ---------------------------------------------------------------------------
// Tiempo real: WebSocket BYOK (un monitor POR conexión, con la key del usuario
// y su presupuesto de peticiones). Cada usuario gasta SU propia cuota.
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws: WebSocket, message: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

wss.on("connection", (ws: WebSocket) => {
  let monitor: SurebetMonitor | undefined;

  // El cliente debe enviar primero su config: { apiKey, budget, minProfit }.
  ws.on("message", (raw) => {
    if (monitor) return; // ya configurado en esta conexión

    let cfg: { apiKey?: string; budget?: number; minProfit?: number; intervalMs?: number } = {};
    try {
      cfg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Config JSON inválida" });
      return;
    }

    // BYOK: key del usuario; si no la manda, cae a la del servidor (o fixtures).
    const apiKey = (String(cfg.apiKey ?? "").trim() || process.env.ODDS_API_KEY || "").trim();
    const usingReal = apiKey.length > 0;

    // Presupuesto opcional (compat); el frontend ahora envía el MODO (intervalMs).
    const budgetNum = Number(cfg.budget);
    const requestBudget = usingReal && Number.isFinite(budgetNum) && budgetNum > 0 ? budgetNum : undefined;
    const minProfitNum = Number(cfg.minProfit);
    const minProfitMargin = Number.isFinite(minProfitNum) ? minProfitNum : MIN_PROFIT;
    // Modo de sondeo elegido por el usuario (mín. 5s para no abusar de la API).
    const intervalNum = Number(cfg.intervalMs);
    const intervalMs = Number.isFinite(intervalNum) && intervalNum >= 5000 ? intervalNum : POLL_INTERVAL_MS;

    // Provider creado UNA vez por conexión: así su caché TTL se reutiliza entre
    // ticks (recrearlo por tick vaciaba la caché y gastaba cuota de más).
    const provider = usingReal ? new TheOddsApiProvider({ apiKey }) : undefined;

    monitor = new SurebetMonitor({
      collect: async () => {
        // Se deja subir el error (p. ej. 401/agotada) al monitor -> "monitor-error"
        // -> el cliente recibe {type:"error"} y puede pedir una key nueva.
        if (provider) return provider.fetchQuotes();
        return collectQuotes(); // fixtures / key del servidor
      },
      minProfitMargin,
      maxProfitMargin: Number.isFinite(MAX_PROFIT) && MAX_PROFIT > 0 ? MAX_PROFIT : undefined,
      minLeadMs: MIN_LEAD_MS,
      intervalMs,
      requestBudget,
      requestCostPerTick: usingReal ? REQUEST_COST : 0,
      commission: DEFAULT_EXCHANGE_COMMISSIONS,
    });

    monitor.on("update", (surebets: Surebet[]) => send(ws, { type: "update", surebets }));
    monitor.on("alerts", (alerts: Alert[]) => {
      history.record(alerts);
      send(ws, { type: "alert", alerts });
    });
    monitor.on("budget", (b) => send(ws, { type: "budget", ...(b as object) }));
    monitor.on("budget-reached", (b) => send(ws, { type: "budget-reached", ...(b as object) }));
    monitor.on("monitor-error", (err: unknown) =>
      send(ws, { type: "error", message: String((err as Error)?.message ?? err) }),
    );

    send(ws, {
      type: "ready",
      real: usingReal,
      requestCost: usingReal ? REQUEST_COST : 0,
      pollIntervalMs: intervalMs,
    });
    monitor.start();
  });

  ws.on("close", () => monitor?.stop());
  ws.on("error", () => monitor?.stop());
});
