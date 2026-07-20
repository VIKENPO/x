import type { ProviderQuote } from "./types.js";

/**
 * Capa de NORMALIZACIÓN y MATCHING de eventos.
 *
 * El problema: cada casa nombra a los participantes de forma distinta
 * ("Real Madrid" vs "R. Madrid" vs "Real Madrid CF"; "C. Alcaraz" vs "Alcaraz").
 * Para poder cruzar cuotas necesitamos reducir todas esas variantes a un mismo
 * identificador canónico de evento (eventId).
 *
 * Estrategia por capas (de más fiable a más heurística):
 *   1. Canonicalización: minúsculas, sin acentos, sin puntuación, sin ruido.
 *   2. Tabla de alias: variantes conocidas -> nombre canónico.
 *   3. Reglas por deporte: en tenis se descartan las iniciales ("C. Alcaraz").
 *   4. Fallback difuso: similitud de bigramas para variantes no catalogadas.
 */

/** Quita acentos/diacríticos. */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Sufijos/prefijos de club de fútbol que no aportan a la identidad. */
const NOISE_TOKENS = new Set([
  "fc", "cf", "cd", "sc", "ac", "afc", "ud", "rc", "ca", "sd", "cp", "ssc", "as",
]);

/**
 * Variantes conocidas -> forma canónica. Se aplica DESPUÉS de limpiar el nombre.
 * Es el punto donde se resuelven los casos que las reglas automáticas no pillan.
 */
const ALIASES: Record<string, string> = {
  "r madrid": "real madrid",
  "atleti": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "barca": "barcelona",
  "man city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "spurs": "tottenham",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "inter": "inter milan",
  "bayern": "bayern munich",
};

/**
 * Reduce el nombre de un participante a su forma canónica.
 * @param name  nombre crudo tal cual lo da la casa
 * @param sport deporte (afecta a las reglas: p. ej. iniciales en tenis)
 */
export function canonicalizeEntity(name: string, sport = ""): string {
  let base = stripAccents(name.toLowerCase());
  base = base.replace(/[.\-_'/]/g, " ").replace(/[^a-z0-9 ]/g, " ");
  let tokens = base.split(/\s+/).filter(Boolean);

  if (sport === "tennis") {
    // "C. Alcaraz" / "J. Sinner" -> se quitan las iniciales de una sola letra.
    tokens = tokens.filter((t) => t.length > 1);
  } else {
    // Fútbol y similares: se quitan los sufijos de club (FC, CF, ...).
    tokens = tokens.filter((t) => !NOISE_TOKENS.has(t));
  }

  const joined = tokens.join(" ").trim();
  return ALIASES[joined] ?? joined;
}

/** Separa "A vs B" (o "A - B", "A @ B") en sus participantes. */
export function parseParticipants(eventName: string): string[] {
  return eventName
    .split(/\s+(?:vs\.?|v\.?|@|-|—)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deriva un identificador canónico de evento a partir del nombre, deporte y fecha.
 * Dos casas que nombren distinto a los mismos equipos producen el MISMO id.
 */
export function deriveEventKey(
  sport: string,
  eventName: string,
  startsAt: string,
): string {
  const participants = parseParticipants(eventName)
    .map((p) => canonicalizeEntity(p, sport))
    .filter(Boolean)
    .sort();
  const day = startsAt.slice(0, 10); // granularidad de día
  return `${sport}:${day}:${participants.join("|")}`;
}

// --------------------------------------------------------------------------
// Fallback difuso: similitud de bigramas (coeficiente de Sørensen–Dice).
// Sirve para unir variantes no catalogadas ("Juventus" vs "Juventus FC" ya lo
// resuelven las reglas; esto pilla erratas o pequeñas divergencias).
// --------------------------------------------------------------------------

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const clean = s.replace(/\s+/g, "");
  for (let i = 0; i < clean.length - 1; i++) {
    const bg = clean.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/** Similitud 0-1 entre dos cadenas (1 = idénticas). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let overlap = 0;
  for (const [bg, countA] of A) {
    const countB = B.get(bg) ?? 0;
    overlap += Math.min(countA, countB);
  }
  return (2 * overlap) / (A.size + B.size);
}

/** Umbral de similitud para considerar dos participantes "el mismo". */
export const FUZZY_THRESHOLD = 0.82;

/**
 * ¿Los participantes de dos eventos (cadenas "a|b" ya canónicas) son los mismos?
 * Exige igual número y que CADA participante de uno case (igual o similar ≥ umbral)
 * con uno DISTINTO del otro. Así se unen erratas ("leverkusen"/"leverkussen") pero
 * NO dos partidos distintos que comparten un equipo ("barca|sevilla" vs "barca|betis").
 */
export function participantsMatch(a: string, b: string): boolean {
  const pa = a.split("|");
  const pb = b.split("|");
  if (pa.length !== pb.length) return false;
  const used = new Array(pb.length).fill(false);
  for (const x of pa) {
    let matched = false;
    for (let j = 0; j < pb.length; j++) {
      if (!used[j] && (x === pb[j] || similarity(x, pb[j]) >= FUZZY_THRESHOLD)) {
        used[j] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

/**
 * Normaliza un lote de cuotas crudas:
 *   - reescribe eventId con la clave canónica derivada del nombre,
 *   - canonicaliza las etiquetas de resultado (para que "C. Alcaraz" y
 *     "Alcaraz" sean el mismo outcome),
 *   - fusiona claves distintas pero muy parecidas (fallback difuso).
 *
 * Devuelve las mismas cuotas con eventId/outcomes normalizados y listas para
 * `mergeQuotes`.
 */
export function normalizeQuotes(quotes: ProviderQuote[]): ProviderQuote[] {
  // 1. Derivar clave canónica y normalizar etiquetas de resultado.
  const normalized = quotes.map((q) => ({
    ...q,
    eventId: deriveEventKey(q.sport, q.eventName, q.startsAt),
    outcomes: q.outcomes.map((o) => ({
      ...o,
      label: canonicalizeEntity(o.label, q.sport) || o.label,
    })),
  }));

  // 2. Fallback difuso con UNION-FIND (DSU): une claves del mismo deporte y día
  //    cuyos participantes son muy parecidos.
  //
  //    Dos mejoras respecto a la versión ingenua:
  //    a) DSU con compresión de camino => la unión es TRANSITIVA: si A~B y B~C,
  //       A, B y C acaban en el mismo grupo (antes podían quedar sueltos y se
  //       perdían cruces de cuotas => surebets no detectadas).
  //    b) La similitud se mide SOLO sobre la parte de participantes, no sobre la
  //       clave entera: el prefijo común "sport:day:" inflaba la similitud y
  //       provocaba falsos merges (=> surebets falsas). Además solo se unen
  //       claves con el MISMO número de participantes.
  const keys = [...new Set(normalized.map((q) => q.eventId))];

  const parent = new Map<string, string>();
  for (const key of keys) parent.set(key, key);

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // Unificamos hacia la raíz menor (determinista).
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };

  // Participantes = lo que hay tras "sport:day:" (canonicalizeEntity ya elimina
  // los ":" de los nombres, así que el último ":" separa día de participantes).
  const partsOf = (key: string): string => key.slice(key.lastIndexOf(":") + 1);

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      // Solo comparamos si comparten deporte y día (prefijo "sport:day").
      if (a.slice(0, a.lastIndexOf(":")) !== b.slice(0, b.lastIndexOf(":"))) continue;
      // Fusionar solo si CADA participante casa con uno distinto del otro evento.
      // (Comparar la cadena entera uniría "barca|sevilla" con "barca|betis".)
      if (participantsMatch(partsOf(a), partsOf(b))) union(a, b);
    }
  }

  return normalized.map((q) => ({
    ...q,
    eventId: find(q.eventId),
  }));
}
