import { useEffect, useState } from "react";

/**
 * Horario de Trade Republic (vía LS Exchange), hora de Madrid, L-V:
 * https://support.traderepublic.com/es-es/576 — acciones/ETFs 07:30-23:00.
 * Apertura oficial de Wall Street (NYSE, 9:30 ET) dentro de esa ventana: 15:30.
 * Cierre oficial de NYSE (16:00 ET): 22:00. Limitación conocida (igual que
 * `nextMarketOpenUtc`): no descarta festivos de mercado, solo fines de semana.
 */
const TR_OPEN = 7.5;
const MARKET_OPEN = 15.5;
const MARKET_CLOSE = 22;
const TR_CLOSE = 23;

type Phase = "closed" | "pre" | "open" | "post";

const PHASE_LABEL: Record<Phase, string> = {
  closed: "Trade Republic cerrado",
  pre: "Pre-mercado (LS Exchange)",
  open: "Mercado NYSE abierto",
  post: "Post-mercado (LS Exchange)",
};

function madridHourDecimal(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

function madridWeekday(now: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

function getPhase(hour: number, weekday: number): Phase {
  if (weekday === 0 || weekday === 6) return "closed";
  if (hour < TR_OPEN || hour >= TR_CLOSE) return "closed";
  if (hour < MARKET_OPEN) return "pre";
  if (hour < MARKET_CLOSE) return "open";
  return "post";
}

const pct = (v: number) => Math.max(0, Math.min(100, ((v - TR_OPEN) / (TR_CLOSE - TR_OPEN)) * 100));

export function TradingClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const hour = madridHourDecimal(now);
  const weekday = madridWeekday(now);
  const phase = getPhase(hour, weekday);
  const timeLabel = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(now);

  const openMarkerPct = pct(MARKET_OPEN);
  const closeMarkerPct = pct(MARKET_CLOSE);
  const nowPct = pct(Math.max(TR_OPEN, Math.min(TR_CLOSE, hour)));
  const showNow = phase !== "closed";

  return (
    <div className="trading-clock">
      <div className="trading-clock-header">
        <span className={`trading-clock-phase phase-${phase}`}>● {PHASE_LABEL[phase]}</span>
        <span className="trading-clock-time">{timeLabel} (Madrid)</span>
      </div>
      <div className="trading-clock-track">
        <div className="tc-segment tc-pre" style={{ width: `${openMarkerPct}%` }} />
        <div className="tc-segment tc-open" style={{ width: `${closeMarkerPct - openMarkerPct}%` }} />
        <div className="tc-segment tc-post" style={{ width: `${100 - closeMarkerPct}%` }} />
        <div className="tc-open-marker" style={{ left: `${openMarkerPct}%` }} title="Apertura NYSE, 15:30" />
        {showNow && <div className="tc-now" style={{ left: `${nowPct}%` }} />}
      </div>
      <div className="trading-clock-open-label" style={{ left: `${openMarkerPct}%` }}>
        15:30 apertura NYSE
      </div>

      <div className="trading-clock-legend">
        <span className="tc-legend-item">
          <i className="tc-dot tc-pre" /> Pre-mercado 07:30–15:30
        </span>
        <span className="tc-legend-item">
          <i className="tc-dot tc-open" /> Mercado abierto 15:30–22:00
        </span>
        <span className="tc-legend-item">
          <i className="tc-dot tc-post" /> Post-mercado 22:00–23:00
        </span>
      </div>
    </div>
  );
}
