import { describe, expect, it } from "vitest";
import { nextMarketOpenUtc } from "./nextMarketOpen.js";

describe("nextMarketOpenUtc", () => {
  it("un lunes de invierno a las 06:00 UTC -> abre ese mismo día a las 14:30 UTC (EST, UTC-5)", () => {
    const now = new Date("2026-01-05T06:00:00Z"); // lunes
    const open = nextMarketOpenUtc(now);
    expect(open.toISOString()).toBe("2026-01-05T14:30:00.000Z");
  });

  it("un lunes de verano a las 06:00 UTC -> abre ese mismo día a las 13:30 UTC (EDT, UTC-4)", () => {
    const now = new Date("2026-07-06T06:00:00Z"); // lunes
    const open = nextMarketOpenUtc(now);
    expect(open.toISOString()).toBe("2026-07-06T13:30:00.000Z");
  });

  it("si ya pasó la apertura de hoy, salta al día siguiente", () => {
    const now = new Date("2026-01-05T20:00:00Z"); // lunes por la tarde (mercado ya abierto)
    const open = nextMarketOpenUtc(now);
    expect(open.toISOString()).toBe("2026-01-06T14:30:00.000Z");
  });

  it("en fin de semana salta al lunes", () => {
    const now = new Date("2026-01-03T12:00:00Z"); // sábado
    const open = nextMarketOpenUtc(now);
    expect(open.toISOString()).toBe("2026-01-05T14:30:00.000Z");
  });
});
