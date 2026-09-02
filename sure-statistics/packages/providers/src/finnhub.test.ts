import { describe, expect, it, vi } from "vitest";
import { fetchCompanyHeadlines, fetchQuote, mapFinnhubNews, mapFinnhubQuote } from "./finnhub.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

describe("mapFinnhubQuote", () => {
  it("normaliza una cotización válida", () => {
    const q = mapFinnhubQuote("AAPL", { c: 220, pc: 200, t: 1735808400 });
    expect(q).toEqual({
      symbol: "AAPL",
      price: 220,
      previousClose: 200,
      changeRatio: 0.1,
      source: "finnhub",
      asOf: new Date(1735808400 * 1000).toISOString(),
    });
  });

  it("devuelve null si el símbolo no existe (c=0, pc=0)", () => {
    expect(mapFinnhubQuote("XXXX", { c: 0, pc: 0, t: 0 })).toBeNull();
  });
});

describe("mapFinnhubNews", () => {
  it("ordena por fecha descendente y respeta el límite", () => {
    const raw = [
      { headline: "old", datetime: 100, url: "" },
      { headline: "new", datetime: 300, url: "" },
      { headline: "mid", datetime: 200, url: "" },
    ];
    expect(mapFinnhubNews(raw, 2)).toEqual(["new", "mid"]);
  });
});

describe("fetchQuote", () => {
  it("devuelve null sin apiKey (sin llamar a fetch)", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchQuote("AAPL", { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("mapea la respuesta cuando hay apiKey", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ c: 220, pc: 200, t: 1735808400 }));
    const result = await fetchQuote("AAPL", { apiKey: "k", fetchImpl });
    expect(result?.changeRatio).toBeCloseTo(0.1);
  });
});

describe("fetchCompanyHeadlines", () => {
  it("devuelve [] sin apiKey", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchCompanyHeadlines("AAPL", 2, { fetchImpl });
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
