/**
 * Evaluación del impacto de titulares de noticias vía la API de Claude
 * (Anthropic), para capturar matices que un diccionario de palabras clave
 * se pierde (p. ej. "beats estimates but cuts guidance" es mixto/bajista,
 * no simplemente "positivo" por la palabra "beats").
 *
 * A diferencia del resto de fuentes de este proyecto, **esto NO es gratis**:
 * cada llamada tiene un coste pequeño (se usa el modelo más barato, Haiku).
 * Por eso es estrictamente opcional: sin `ANTHROPIC_API_KEY`, el pipeline
 * sigue con el diccionario léxico gratuito (`@ss/core/sentiment.ts`) sin
 * ningún cambio de comportamiento.
 */

export interface ClaudeSentimentConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface ClaudeSentimentResult {
  /** Sesgo estimado en [-1, 1] (negativo = bajista, positivo = alcista). */
  score: number;
  /** Motivo principal, en una frase corta, para mostrar en la UI. */
  summary: string;
}

const SYSTEM_PROMPT =
  "Eres un analista financiero neutral. Te dan un ticker bursátil y titulares " +
  "de noticias recientes en inglés. Evalúa el sesgo direccional que sugieren " +
  "esos titulares para el precio de la acción a corto plazo (no resumas lo " +
  "que ya pasó: valora su impacto esperado). Responde SOLO con JSON válido, " +
  'sin markdown ni texto adicional: {"score": number entre -1 y 1, "summary": ' +
  'string en español, máximo 15 palabras}. score=0 si no hay señal clara.';

function resolveConfig(config: ClaudeSentimentConfig) {
  return {
    apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
    model: config.model ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    baseUrl: config.baseUrl ?? "https://api.anthropic.com/v1/messages",
    fetchImpl: config.fetchImpl ?? fetch,
  };
}

/** Extrae y valida el JSON de la respuesta del modelo. Pura (testable con fixtures). */
export function parseClaudeSentimentText(text: string): ClaudeSentimentResult | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { score, summary } = parsed as Record<string, unknown>;
  if (typeof score !== "number" || !Number.isFinite(score) || typeof summary !== "string") return null;
  return { score: Math.max(-1, Math.min(1, score)), summary: summary.slice(0, 200) };
}

/** `null` si no hay clave, la llamada falla o la respuesta no se puede interpretar. */
export async function scoreHeadlinesWithClaude(
  symbol: string,
  headlines: string[],
  config: ClaudeSentimentConfig = {},
): Promise<ClaudeSentimentResult | null> {
  if (headlines.length === 0) return null;
  const { apiKey, model, baseUrl, fetchImpl } = resolveConfig(config);
  if (!apiKey) {
    console.warn("[claude-sentiment] sin ANTHROPIC_API_KEY: se usa el diccionario léxico gratuito.");
    return null;
  }

  const userMessage = `Ticker: ${symbol}\nTitulares:\n${headlines.map((h) => `- ${h}`).join("\n")}`;

  const res = await fetchImpl(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    console.error(`[claude-sentiment] ${symbol}: HTTP ${res.status} ${res.statusText}`);
    return null;
  }

  const raw = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = raw.content?.find((c) => c.type === "text")?.text;
  if (!text) return null;
  return parseClaudeSentimentText(text);
}
