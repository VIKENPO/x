import { describe, it, expect, beforeEach } from "vitest";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryStore } from "./history.js";
import type { Alert } from "./monitor.js";
import type { Surebet } from "@x/core";

function mkAlert(type: Alert["type"], eventName: string, margin: number, prev?: number): Alert {
  const surebet = {
    eventId: eventName,
    eventName,
    sport: "football",
    marketKey: "1x2",
    startsAt: "2026-08-01T00:00:00Z",
    outcomes: [],
    totalImpliedProbability: 1 - margin,
    profitMargin: margin,
  } as unknown as Surebet;
  return {
    type,
    key: `${eventName}::1x2`,
    surebet,
    profitMargin: margin,
    ...(prev != null ? { previousMargin: prev } : {}),
  };
}

describe("HistoryStore (memoria)", () => {
  it("registra y devuelve las más recientes primero", () => {
    let t = 1000;
    const store = new HistoryStore({ now: () => t });
    store.record([mkAlert("new", "A vs B", 0.05)]);
    t = 2000;
    store.record([mkAlert("changed", "C vs D", 0.03, 0.02)]);

    const recent = store.recent();
    expect(recent).toHaveLength(2);
    expect(recent[0].eventName).toBe("C vs D"); // más reciente primero
    expect(recent[0].at).toBe(2000);
    expect(recent[0].previousMargin).toBe(0.02);
    expect(recent[1].eventName).toBe("A vs B");
  });

  it("respeta maxItems (descarta las más antiguas)", () => {
    const store = new HistoryStore({ maxItems: 3, now: () => 1 });
    for (let i = 0; i < 10; i++) store.record([mkAlert("new", `E${i}`, 0.01)]);
    expect(store.size()).toBe(3);
    expect(store.recent().map((e) => e.eventName)).toEqual(["E9", "E8", "E7"]);
  });

  it("limita el número devuelto por recent(limit)", () => {
    const store = new HistoryStore({ now: () => 1 });
    for (let i = 0; i < 5; i++) store.record([mkAlert("new", `F${i}`, 0.01)]);
    expect(store.recent(2)).toHaveLength(2);
  });
});

describe("HistoryStore (persistencia JSONL)", () => {
  const file = join(tmpdir(), "surebets-history-test.jsonl");
  beforeEach(() => rmSync(file, { force: true }));

  it("persiste y recarga en una instancia nueva", () => {
    const s1 = new HistoryStore({ file, now: () => 1000 });
    s1.record([mkAlert("new", "Persisted vs Event", 0.07)]);

    const s2 = new HistoryStore({ file });
    const recent = s2.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0].eventName).toBe("Persisted vs Event");
    expect(recent[0].profitMargin).toBe(0.07);
    expect(recent[0].at).toBe(1000);
  });
});
