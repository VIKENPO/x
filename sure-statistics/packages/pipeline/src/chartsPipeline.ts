import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChartData, Ticker } from "@ss/core";
import { fetchTimeSeries } from "@ss/providers";
import { buildChartData } from "./buildChartData.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "public", "data");
const CHARTS_DIR = join(DATA_DIR, "charts");
const META_PATH = join(CHARTS_DIR, "_meta.json");

// Twelve Data free tier: 8 créditos/min. Con margen, 1 llamada cada 8s.
const CALL_SPACING_MS = 8_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function readLastLongRangeFetch(): Promise<string | null> {
  const raw = await readFile(META_PATH, "utf-8").catch(() => null);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { lastLongRangeFetch?: string }).lastLongRangeFetch ?? null;
  } catch {
    return null;
  }
}

async function readExistingChart(symbol: string): Promise<ChartData | null> {
  const raw = await readFile(join(CHARTS_DIR, `${symbol}.json`), "utf-8").catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChartData;
  } catch {
    return null;
  }
}

/**
 * Rangos largos (1W/1M/1Y/MAX) solo cambian una vez al día (una vela nueva
 * por día/semana/mes como mucho), así que solo se refrescan en el primer
 * ciclo del día — el resto de ciclos reutiliza lo ya guardado. Esto mantiene
 * el consumo de créditos de Twelve Data muy por debajo del límite gratuito
 * (ver SPEC.md). El rango "1D" sí se refresca en cada ciclo.
 */
export async function runChartsPipeline(tickers: Ticker[], eurRate: number, now: () => Date = () => new Date()): Promise<void> {
  if (!process.env.TWELVEDATA_API_KEY) {
    console.warn("[pipeline] sin TWELVEDATA_API_KEY: se omiten los gráficos de precio.");
    return;
  }

  await mkdir(CHARTS_DIR, { recursive: true });
  const lastLongRangeFetch = await readLastLongRangeFetch();
  const fetchLongRangeToday = lastLongRangeFetch !== todayUtc(now());

  let first = true;
  for (const ticker of tickers) {
    if (!first) await sleep(CALL_SPACING_MS);
    first = false;

    try {
      const intraday = await fetchTimeSeries(ticker.symbol, "5min", 100);
      await sleep(CALL_SPACING_MS);

      if (!fetchLongRangeToday) {
        const existing = await readExistingChart(ticker.symbol);
        if (existing) {
          const merged: ChartData = {
            ...existing,
            eurRate,
            updatedAt: now().toISOString(),
            series: { ...existing.series, "1D": intraday.map((b) => ({ time: b.time, close: b.close * eurRate })) },
          };
          await writeFile(join(CHARTS_DIR, `${ticker.symbol}.json`), JSON.stringify(merged, null, 2));
          continue;
        }
      }

      const hourly = await fetchTimeSeries(ticker.symbol, "1h", 60);
      await sleep(CALL_SPACING_MS);
      const daily = await fetchTimeSeries(ticker.symbol, "1day", 260);
      await sleep(CALL_SPACING_MS);
      const monthly = await fetchTimeSeries(ticker.symbol, "1month", 240);

      const chart = buildChartData(ticker.symbol, { intraday, hourly, daily, monthly }, eurRate, now);
      await writeFile(join(CHARTS_DIR, `${ticker.symbol}.json`), JSON.stringify(chart, null, 2));
    } catch (err) {
      console.error(`[pipeline] gráfico ${ticker.symbol}:`, err);
    }
  }

  if (fetchLongRangeToday) {
    await writeFile(META_PATH, JSON.stringify({ lastLongRangeFetch: todayUtc(now()) }, null, 2));
  }
}
