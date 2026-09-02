import { describe, expect, it, vi } from "vitest";
import { fetchUsdToEurRate, mapFrankfurterRate } from "./frankfurter.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body } as Response;
}

describe("mapFrankfurterRate", () => {
  it("extrae la tasa EUR", () => {
    expect(mapFrankfurterRate({ rates: { EUR: 0.92 } })).toBe(0.92);
  });

  it("devuelve null si falta EUR", () => {
    expect(mapFrankfurterRate({ rates: {} })).toBeNull();
    expect(mapFrankfurterRate({})).toBeNull();
  });
});

describe("fetchUsdToEurRate", () => {
  it("devuelve la tasa cuando la respuesta es válida", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ rates: { EUR: 0.9 } }));
    const rate = await fetchUsdToEurRate({ fetchImpl });
    expect(rate).toBe(0.9);
  });

  it("lanza si la respuesta HTTP falla", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    await expect(fetchUsdToEurRate({ fetchImpl })).rejects.toThrow();
  });
});
