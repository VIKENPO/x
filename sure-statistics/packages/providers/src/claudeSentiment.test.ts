import { describe, expect, it, vi } from "vitest";
import { parseClaudeSentimentText, scoreHeadlinesWithClaude } from "./claudeSentiment.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body } as Response;
}

describe("parseClaudeSentimentText", () => {
  it("parsea JSON limpio", () => {
    expect(parseClaudeSentimentText('{"score": 0.6, "summary": "Buenos resultados"}')).toEqual({
      score: 0.6,
      summary: "Buenos resultados",
    });
  });

  it("quita el fence de markdown si el modelo lo añade", () => {
    expect(parseClaudeSentimentText('```json\n{"score": -0.4, "summary": "Recorte de plantilla"}\n```')).toEqual({
      score: -0.4,
      summary: "Recorte de plantilla",
    });
  });

  it("recorta el score a [-1, 1]", () => {
    expect(parseClaudeSentimentText('{"score": 5, "summary": "x"}')?.score).toBe(1);
    expect(parseClaudeSentimentText('{"score": -5, "summary": "x"}')?.score).toBe(-1);
  });

  it("devuelve null si no es JSON válido", () => {
    expect(parseClaudeSentimentText("no es json")).toBeNull();
  });

  it("devuelve null si faltan campos", () => {
    expect(parseClaudeSentimentText('{"score": 0.5}')).toBeNull();
    expect(parseClaudeSentimentText('{"summary": "x"}')).toBeNull();
  });
});

describe("scoreHeadlinesWithClaude", () => {
  it("devuelve null sin apiKey (sin llamar a fetch)", async () => {
    const fetchImpl = vi.fn();
    const result = await scoreHeadlinesWithClaude("AAPL", ["titular"], { fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("devuelve null con lista vacía (sin llamar a fetch)", async () => {
    const fetchImpl = vi.fn();
    const result = await scoreHeadlinesWithClaude("AAPL", [], { apiKey: "k", fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parsea la respuesta real de la API cuando hay apiKey", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: [{ type: "text", text: '{"score": 0.7, "summary": "Sube por resultados"}' }] }),
    );
    const result = await scoreHeadlinesWithClaude("AAPL", ["Apple beats estimates"], { apiKey: "k", fetchImpl });
    expect(result).toEqual({ score: 0.7, summary: "Sube por resultados" });
  });

  it("devuelve null si la API falla (HTTP error)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const result = await scoreHeadlinesWithClaude("AAPL", ["x"], { apiKey: "k", fetchImpl });
    expect(result).toBeNull();
  });
});
