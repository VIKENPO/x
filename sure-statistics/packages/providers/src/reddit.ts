/**
 * Menciones de un ticker en Reddit vía la **API oficial OAuth2** (no scraping):
 * https://www.reddit.com/dev/api. Requiere una app gratuita tipo "script"
 * (https://www.reddit.com/prefs/apps) — uso de solo lectura y bajo volumen,
 * dentro del tier gratuito de Reddit.
 *
 * Config por variables de entorno:
 *   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
 * Sin credenciales, devuelve `[]` (el pipeline sigue con el resto de señales).
 */

export interface RedditConfig {
  clientId?: string;
  clientSecret?: string;
  userAgent?: string;
  subreddits?: string; // p. ej. "stocks+wallstreetbets+investing"
  fetchImpl?: typeof fetch;
}

interface RedditListing {
  data: { children: { data: { title: string; created_utc: number } }[] };
}

function resolveConfig(config: RedditConfig) {
  return {
    clientId: config.clientId ?? process.env.REDDIT_CLIENT_ID,
    clientSecret: config.clientSecret ?? process.env.REDDIT_CLIENT_SECRET,
    userAgent: config.userAgent ?? process.env.REDDIT_USER_AGENT ?? "sure-statistics/0.1 (personal, non-commercial)",
    subreddits: config.subreddits ?? process.env.REDDIT_SUBREDDITS ?? "stocks+wallstreetbets+investing",
    fetchImpl: config.fetchImpl ?? fetch,
  };
}

/** Extrae los títulos de posts de una respuesta cruda de /search. Pura (testable con fixtures). */
export function mapRedditListing(raw: RedditListing, limit = 25): string[] {
  return (raw?.data?.children ?? [])
    .map((c) => c.data.title)
    .filter(Boolean)
    .slice(0, limit);
}

async function getAccessToken(config: ReturnType<typeof resolveConfig>): Promise<string | null> {
  const { clientId, clientSecret, userAgent, fetchImpl } = config;
  if (!clientId || !clientSecret) return null;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchImpl("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`[reddit] access_token: HTTP ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/** Títulos de posts recientes (últimas 24h) que mencionan `symbol` en los subreddits configurados. */
export async function fetchTickerMentions(symbol: string, config: RedditConfig = {}): Promise<string[]> {
  const resolved = resolveConfig(config);
  const token = await getAccessToken(resolved);
  if (!token) {
    console.warn("[reddit] sin REDDIT_CLIENT_ID/SECRET: no se consultan menciones reales.");
    return [];
  }
  const url =
    `https://oauth.reddit.com/r/${resolved.subreddits}/search` +
    `?q=${encodeURIComponent(symbol)}&restrict_sr=1&sort=new&limit=25&t=day`;
  const res = await resolved.fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": resolved.userAgent },
  });
  if (!res.ok) throw new Error(`[reddit] search ${symbol}: HTTP ${res.status} ${res.statusText}`);
  const raw = (await res.json()) as RedditListing;
  return mapRedditListing(raw);
}
