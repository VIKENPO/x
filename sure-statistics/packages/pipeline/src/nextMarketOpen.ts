/**
 * Calcula la próxima apertura de Wall Street (NYSE/Nasdaq, 9:30 hora de Nueva
 * York) como instante UTC, sin depender de ninguna librería de zonas horarias
 * (usa `Intl` con timeZone "America/New_York", disponible en Node por defecto).
 *
 * Limitación conocida: no tiene en cuenta festivos de mercado (Acción de
 * Gracias, Navidad, etc.), solo fines de semana — así que en un festivo dará
 * una hora de apertura que ese día no se producirá. Suficiente para el MVP;
 * ver roadmap en el README.
 */

/** Offset de America/New_York respecto a UTC, en minutos (negativo), para el instante dado. */
function nyOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = tzPart.match(/GMT([+-]\d+)/);
  const hours = match ? parseInt(match[1], 10) : -5;
  return hours * 60;
}

/** Día de la semana (0=domingo) en America/New_York para el instante dado. */
function nyWeekday(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

/** Componentes de fecha (año/mes/día) en America/New_York para el instante dado. */
function nyDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Instante UTC que corresponde a `hh:mm` hora local de Nueva York en la fecha (y,m,d) dada. */
function nyLocalToUtc(year: number, month: number, day: number, hh: number, mm: number): Date {
  const approxUtc = Date.UTC(year, month - 1, day, hh, mm);
  const offsetMin = nyOffsetMinutes(new Date(approxUtc));
  return new Date(approxUtc - offsetMin * 60_000);
}

/** Próxima apertura de mercado (9:30 NY) estrictamente posterior a `now`, saltando fines de semana. */
export function nextMarketOpenUtc(now: Date = new Date()): Date {
  for (let addDays = 0; addDays < 8; addDays++) {
    const candidate = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
    if (nyWeekday(candidate) === 0 || nyWeekday(candidate) === 6) continue; // domingo/sábado
    const { year, month, day } = nyDateParts(candidate);
    const open = nyLocalToUtc(year, month, day, 9, 30);
    if (open.getTime() > now.getTime()) return open;
  }
  throw new Error("no se pudo calcular la próxima apertura de mercado");
}
