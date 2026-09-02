import { describe, expect, it } from "vitest";
import { averageSentiment, scoreSentiment } from "./sentiment.js";

describe("scoreSentiment", () => {
  it("puntúa positivo un titular alcista", () => {
    expect(scoreSentiment("Apple beats earnings expectations, stock surges")).toBeGreaterThan(0);
  });

  it("puntúa negativo un titular bajista", () => {
    expect(scoreSentiment("Meta plunges after weak guidance and layoffs")).toBeLessThan(0);
  });

  it("invierte el signo tras un negador", () => {
    const negated = scoreSentiment("results were not profitable this quarter");
    const plain = scoreSentiment("results were profitable this quarter");
    expect(negated).toBeLessThan(0);
    expect(plain).toBeGreaterThan(0);
  });

  it("devuelve 0 para texto sin palabras del diccionario", () => {
    expect(scoreSentiment("the company held its annual meeting today")).toBe(0);
  });

  it("se mantiene en [-1, 1]", () => {
    const s = scoreSentiment("crash crash crash fraud bankruptcy scandal");
    expect(s).toBeGreaterThanOrEqual(-1);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("averageSentiment", () => {
  it("devuelve 0 con lista vacía", () => {
    expect(averageSentiment([])).toBe(0);
  });

  it("promedia varios titulares", () => {
    const avg = averageSentiment([
      "stock surges on strong demand",
      "analysts warn of a slowdown",
    ]);
    expect(avg).toBeCloseTo((scoreSentiment("stock surges on strong demand") + scoreSentiment("analysts warn of a slowdown")) / 2);
  });
});
