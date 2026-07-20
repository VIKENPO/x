import { describe, it, expect, vi } from "vitest";
import { SurebetMonitor, type Alert } from "./monitor.js";
import type { ProviderQuote } from "@x/core";

const START = "2026-08-01T19:00:00Z";

/** Cuotas 1x2 de dos casas para el mismo evento. */
function quotes(
  homeA: number, drawA: number, awayA: number,
  homeB: number, drawB: number, awayB: number,
): ProviderQuote[] {
  return [
    {
      eventId: "e", eventName: "Real Madrid vs Barcelona", sport: "football",
      marketKey: "1x2", startsAt: START, bookmaker: "A",
      outcomes: [{ label: "home", odds: homeA }, { label: "draw", odds: drawA }, { label: "away", odds: awayA }],
    },
    {
      eventId: "e", eventName: "Real Madrid vs Barcelona", sport: "football",
      marketKey: "1x2", startsAt: START, bookmaker: "B",
      outcomes: [{ label: "home", odds: homeB }, { label: "draw", odds: drawB }, { label: "away", odds: awayB }],
    },
  ];
}

// Cuotas con arbitraje (mejores: 3.0 / 3.6 / 3.9 -> Σ 0.867 < 1).
const ARB = () => quotes(3.0, 3.2, 3.9, 2.7, 3.6, 3.4);
// Cuotas sin arbitraje (margen de la casa).
const NO_ARB = () => quotes(2.0, 3.3, 3.5, 1.95, 3.4, 3.6);

function monitorReturning(sequence: ProviderQuote[][]) {
  let i = 0;
  return new SurebetMonitor({
    collect: async () => sequence[Math.min(i++, sequence.length - 1)],
    minProfitMargin: 0,
    marginChangeThreshold: 0.005,
  });
}

describe("SurebetMonitor.tick", () => {
  it("emite 'new' la primera vez que aparece una surebet", async () => {
    const m = monitorReturning([ARB()]);
    const alerts = await m.tick();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("new");
    expect(m.current()).toHaveLength(1);
  });

  it("no repite alerta si la surebet sigue igual", async () => {
    const m = monitorReturning([ARB(), ARB()]);
    await m.tick();
    const alerts = await m.tick();
    expect(alerts).toHaveLength(0);
  });

  it("emite 'resolved' cuando la surebet desaparece", async () => {
    const m = monitorReturning([ARB(), NO_ARB()]);
    await m.tick();
    const alerts = await m.tick();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("resolved");
    expect(m.current()).toHaveLength(0);
  });

  it("emite 'changed' cuando el margen varía por encima del umbral", async () => {
    // Segundo tick: away sube de 3.9 a 4.6 -> margen sube claramente.
    const m = monitorReturning([
      quotes(3.0, 3.2, 3.9, 2.7, 3.6, 3.4),
      quotes(3.0, 3.2, 4.6, 2.7, 3.6, 3.4),
    ]);
    await m.tick();
    const alerts = await m.tick();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("changed");
    expect(alerts[0].previousMargin).toBeDefined();
    expect(alerts[0].profitMargin).toBeGreaterThan(alerts[0].previousMargin!);
  });

  it("emite el evento 'update' con la lista completa en cada tick", async () => {
    const m = monitorReturning([ARB()]);
    const received: unknown[] = [];
    m.on("update", (s) => received.push(s));
    await m.tick();
    expect(received).toHaveLength(1);
    expect((received[0] as unknown[]).length).toBe(1);
  });

  it("emite el evento 'alerts' solo cuando hay novedades", async () => {
    const m = monitorReturning([ARB(), ARB()]);
    const batches: Alert[][] = [];
    m.on("alerts", (a) => batches.push(a));
    await m.tick(); // new
    await m.tick(); // sin cambios -> no emite
    expect(batches).toHaveLength(1);
    expect(batches[0][0].type).toBe("new");
  });
});

describe("SurebetMonitor presupuesto (BYOK)", () => {
  it("se detiene al agotar el presupuesto de peticiones", async () => {
    const m = new SurebetMonitor({
      collect: async () => [],
      intervalMs: 1000,
      requestBudget: 2,
      requestCostPerTick: 1,
    });
    const reached: Array<{ used: number; budget: number }> = [];
    m.on("budget-reached", (b) => reached.push(b as { used: number; budget: number }));

    vi.useFakeTimers();
    try {
      m.start();                                  // sondeo #1 -> used 1
      await vi.advanceTimersByTimeAsync(1000);    // sondeo #2 -> used 2
      await vi.advanceTimersByTimeAsync(1000);    // #3: 2+1>2 -> stop + budget-reached
      await vi.advanceTimersByTimeAsync(2000);    // no debe seguir sondeando
    } finally {
      vi.useRealTimers();
    }

    expect(m.requestsUsed()).toBe(2);
    expect(m.requestsRemaining()).toBe(0);
    expect(reached).toHaveLength(1);
    expect(reached[0]).toMatchObject({ used: 2, budget: 2 });
  });
});
