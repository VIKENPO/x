import { describe, expect, it } from "vitest";
import { buildChartData, type RawSeries } from "./buildChartData.js";

const FIXED_NOW = () => new Date("2026-09-02T08:00:00.000Z");

function bars(n: number, startClose = 100): { time: string; close: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    time: new Date(2026, 0, i + 1).toISOString(),
    close: startClose + i,
  }));
}

describe("buildChartData", () => {
  it("convierte todas las series a EUR con la tasa dada", () => {
    const raw: RawSeries = { intraday: bars(2, 100), hourly: [], daily: [], monthly: [] };
    const result = buildChartData("AAPL", raw, 0.9, FIXED_NOW);
    expect(result.series["1D"]).toEqual([
      { time: raw.intraday[0].time, close: 90 },
      { time: raw.intraday[1].time, close: 90.9 },
    ]);
    expect(result.eurRate).toBe(0.9);
    expect(result.symbol).toBe("AAPL");
    expect(result.updatedAt).toBe(FIXED_NOW().toISOString());
  });

  it("recorta la serie diaria a los últimos ~22 puntos para 1M", () => {
    const raw: RawSeries = { intraday: [], hourly: [], daily: bars(40), monthly: [] };
    const result = buildChartData("AAPL", raw, 1, FIXED_NOW);
    expect(result.series["1M"]).toHaveLength(22);
    expect(result.series["1M"][0]).toEqual(bars(40)[18]); // los últimos 22 de 40
  });

  it("usa toda la serie diaria disponible si hay menos de 260 puntos para 1Y", () => {
    const raw: RawSeries = { intraday: [], hourly: [], daily: bars(10), monthly: [] };
    const result = buildChartData("AAPL", raw, 1, FIXED_NOW);
    expect(result.series["1Y"]).toHaveLength(10);
  });

  it("series vacías se quedan vacías, no rompen nada", () => {
    const raw: RawSeries = { intraday: [], hourly: [], daily: [], monthly: [] };
    const result = buildChartData("AAPL", raw, 0.9, FIXED_NOW);
    expect(result.series).toEqual({ "1D": [], "1W": [], "1M": [], "1Y": [], MAX: [] });
  });
});
