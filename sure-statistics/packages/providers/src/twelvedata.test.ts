import { describe, expect, it, vi } from "vitest";
import { fetchTimeSeries, mapTwelveDataSeries } from "./twelvedata.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body } as Response;
}

describe("mapTwelveDataSeries", () => {
  it("ordena ascendente por fecha y convierte close a número", () => {
    const raw = {
      status: "ok",
      values: [
        { datetime: "2026-09-02", close: "230.5" },
        { datetime: "2026-08-31", close: "225.0" },
      ],
    };
    const bars = mapTwelveDataSeries(raw);
    expect(bars).toEqual([
      { time: new Date("2026-08-31").toISOString(), close: 225 },
      { time: new Date("2026-09-02").toISOString(), close: 230.5 },
    ]);
  });

  it("devuelve [] si status no es ok", () => {
    expect(mapTwelveDataSeries({ status: "error" })).toEqual([]);
  });

  it("devuelve [] sin values", () => {
    expect(mapTwelveDataSeries({ status: "ok" })).toEqual([]);
  });
});

describe("fetchTimeSeries", () => {
  it("devuelve [] sin apiKey (sin llamar a fetch)", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchTimeSeries("AAPL", "1day", 30, { fetchImpl });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mapea la respuesta cuando hay apiKey", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "ok", values: [{ datetime: "2026-09-02", close: "100" }] }),
    );
    const result = await fetchTimeSeries("AAPL", "1day", 30, { apiKey: "k", fetchImpl });
    expect(result).toEqual([{ time: new Date("2026-09-02").toISOString(), close: 100 }]);
  });

  it("devuelve [] si la API responde error (rate limit, etc.)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ status: "error", message: "limit" }));
    const result = await fetchTimeSeries("AAPL", "1day", 30, { apiKey: "k", fetchImpl });
    expect(result).toEqual([]);
  });
});
