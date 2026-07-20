import { useEffect, useRef, useState } from "react";
import { stakeSummary, type Surebet } from "@x/core";

const LS_KEY = "surebets.apiKey";
const LS_INTERVAL = "surebets.intervalMs";

/** Modos de sondeo (velocidad). Menor intervalo = caza surebets fugaces pero gasta más cuota. */
const MODES: { key: string; label: string; intervalMs: number; hint: string }[] = [
  { key: "fast", label: "Rápido", intervalMs: 15000, hint: "caza fugaces, gasta rápido" },
  { key: "mid", label: "Medio", intervalMs: 30000, hint: "equilibrio" },
  { key: "eco", label: "Ahorro", intervalMs: 60000, hint: "dura más, puede perder fugaces" },
  { key: "slow", label: "Lento", intervalMs: 300000, hint: "vigilancia larga y barata" },
];

type AlertType = "new" | "changed" | "resolved";
interface Alert {
  type: AlertType;
  key: string;
  surebet: Surebet;
  profitMargin: number;
  previousMargin?: number;
}
interface FeedItem extends Alert { id: number; at: string; }

type ServerMessage =
  | { type: "ready"; real: boolean; requestCost: number; pollIntervalMs: number }
  | { type: "update"; surebets: Surebet[] }
  | { type: "alert"; alerts: Alert[] }
  | { type: "budget"; used: number; budget: number | null; remaining: number | null }
  | { type: "budget-reached"; used: number; budget: number }
  | { type: "error"; message: string };

const keyOf = (s: Surebet) => `${s.eventId}::${s.marketKey}`;

export function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS_KEY) ?? "");
  const [intervalMs, setIntervalMs] = useState(() => Number(localStorage.getItem(LS_INTERVAL) ?? 30000));
  const [healthCost, setHealthCost] = useState(0); // coste/sondeo estimado (de /api/health)
  const [started, setStarted] = useState(false);

  const [surebets, setSurebets] = useState<Surebet[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [status, setStatus] = useState<"conectando" | "en vivo" | "desconectado" | "límite">("conectando");
  const [info, setInfo] = useState<{ used: number; budget: number | null; remaining: number | null; cost: number; real: boolean }>({
    used: 0, budget: null, remaining: null, cost: 0, real: false,
  });
  const [errorMsg, setErrorMsg] = useState("");

  const [bankroll, setBankroll] = useState("100"); // texto libre (se convierte al usar)
  const [minMargin, setMinMargin] = useState("0");
  const [sport, setSport] = useState("all");

  const [validating, setValidating] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [, setNowTick] = useState(0); // fuerza re-render para la barra de cuenta atrás

  const feedId = useRef(0);
  const prevMargins = useRef<Map<string, number>>(new Map());
  const deltas = useRef<Map<string, number>>(new Map());
  const lastPollRef = useRef(Date.now());

  // Coste por sondeo (para estimar cr/min y duración por modo en la pantalla inicial).
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => { if (typeof d?.requestCost === "number") setHealthCost(d.requestCost); })
      .catch(() => {});
  }, []);

  // Cuenta atrás visual al siguiente sondeo: re-render cada 250ms mientras hay sesión.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [started]);

  // Validación de la API key (bloquea el acceso si no es válida o está agotada).
  async function startWithValidation() {
    setErrorMsg("");
    // Sin key: no se valida (se usan datos de ejemplo o la key del servidor).
    if (!apiKey.trim()) {
      localStorage.setItem(LS_KEY, "");
      localStorage.setItem(LS_INTERVAL, String(intervalMs));
      setStarted(true);
      return;
    }
    setValidating(true);
    try {
      const r = await fetch("/api/validate", { headers: { "x-odds-api-key": apiKey } });
      const d = await r.json();
      if (!d.valid) {
        setErrorMsg(
          d.reason === "exhausted" ? "Esta API key no tiene créditos disponibles. Prueba con otra."
          : d.reason === "invalid" ? "API key no válida."
          : d.reason === "missing" ? "Introduce una API key."
          : "No se pudo validar la key (error de red).",
        );
        return;
      }
      if (typeof d.remaining === "number") setRemaining(d.remaining);
      localStorage.setItem(LS_KEY, apiKey);
      localStorage.setItem(LS_INTERVAL, String(intervalMs));
      setStarted(true);
    } catch {
      setErrorMsg("Error de red al validar la key.");
    } finally {
      setValidating(false);
    }
  }

  useEffect(() => {
    if (!started) return;
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        setStatus("en vivo");
        setErrorMsg("");
        // minProfit 0: el servidor manda todo y el filtro fino se hace en cliente.
        ws.send(JSON.stringify({ apiKey, intervalMs, minProfit: 0 }));
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus("desconectado");
        retry = setTimeout(connect, 2000);
      };
      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return; // frame malformado: ignorar
        }
        if (msg.type === "update") {
          lastPollRef.current = Date.now(); // reinicia la cuenta atrás
          // Se reconstruyen los mapas SOLO con las surebets actuales: así se podan
          // las flechas ▲/▼ obsoletas y no crecen sin límite en sesiones largas.
          const nextPrev = new Map<string, number>();
          const nextDeltas = new Map<string, number>();
          for (const s of msg.surebets) {
            const k = keyOf(s);
            const prev = prevMargins.current.get(k);
            if (prev !== undefined && Math.abs(prev - s.profitMargin) > 1e-9) {
              nextDeltas.set(k, s.profitMargin - prev);
            }
            nextPrev.set(k, s.profitMargin);
          }
          prevMargins.current = nextPrev;
          deltas.current = nextDeltas;
          setSurebets(msg.surebets);
        } else if (msg.type === "alert") {
          const now = new Date().toLocaleTimeString();
          setFeed((prev) => [
            ...msg.alerts.map((a) => ({ ...a, id: feedId.current++, at: now })),
            ...prev,
          ].slice(0, 40));
          for (const a of msg.alerts) {
            if (a.type === "new" && Notification.permission === "granted") {
              new Notification("🟢 Nueva surebet", {
                body: `${a.surebet.eventName} · +${(a.profitMargin * 100).toFixed(2)}%`,
              });
            }
          }
        } else if (msg.type === "ready") {
          lastPollRef.current = Date.now();
          setInfo((i) => ({ ...i, cost: msg.requestCost, real: msg.real }));
        } else if (msg.type === "budget") {
          setInfo((i) => ({ ...i, used: msg.used, budget: msg.budget, remaining: msg.remaining }));
        } else if (msg.type === "budget-reached") {
          setStatus("límite");
          setInfo((i) => ({ ...i, used: msg.used, budget: msg.budget, remaining: 0 }));
        } else if (msg.type === "error") {
          // Si la key se agotó / dejó de valer, se vuelve a la pantalla inicial.
          if (/\b(401|429)\b|out_of_usage|quota|credit|api key/i.test(msg.message)) {
            closed = true;
            ws.close();
            setStarted(false);
            setRemaining(0);
            setErrorMsg("Tu API key se ha agotado o no es válida. Introduce otra para continuar.");
          } else {
            setErrorMsg(msg.message);
          }
        }
      };
    }

    connect();
    return () => { closed = true; clearTimeout(retry); ws?.close(); };
  }, [started, apiKey, intervalMs]);

  // ---- Pantalla de entrada (BYOK) ----
  if (!started) {
    return (
      <main style={styles.main}>
        <h1 style={{ marginBottom: 4 }}>⚽ Surebets · en vivo</h1>
        <p style={styles.subtitle}>Introduce tu propia API key de The Odds API (BYOK). Consumes tu propia cuota.</p>
        <div style={styles.entryCard}>
          <label style={styles.control}>
            API key (The Odds API)
            <input
              type="password" value={apiKey} placeholder="tu_api_key"
              style={styles.input}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <div style={styles.control}>
            <span>Modo de sondeo (velocidad)</span>
            <div style={styles.modeList}>
              {MODES.map((m) => {
                const crMin = healthCost > 0 ? Math.round((healthCost * 60000) / m.intervalMs) : null;
                const dur = crMin ? Math.round(500 / crMin) : null;
                const selected = intervalMs === m.intervalMs;
                return (
                  <button
                    key={m.key} type="button"
                    style={{ ...styles.modeBtn, ...(selected ? styles.modeBtnSel : {}) }}
                    onClick={() => setIntervalMs(m.intervalMs)}
                  >
                    <strong>{m.label}</strong> · cada {m.intervalMs / 1000}s
                    <div style={styles.muted}>
                      {crMin ? `≈ ${crMin} cr/min · 500 cr ≈ ${dur} min` : m.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          {errorMsg && <span style={{ color: "#dc2626", fontSize: 13 }}>{errorMsg}</span>}
          <button
            style={{ ...styles.primaryBtn, ...(validating ? { opacity: 0.6, cursor: "default" } : {}) }}
            disabled={validating}
            onClick={startWithValidation}
          >
            {validating ? "Validando…" : "Empezar"}
          </button>
          <span style={styles.muted}>
            Se valida tu API key antes de entrar (bloquea si es inválida o está agotada).
            Sin key se usa la del servidor o datos de ejemplo.
          </span>
        </div>
      </main>
    );
  }

  // ---- Vista principal ----
  const bankrollNum = Math.max(0, Number(bankroll) || 0);
  const minMarginNum = Math.max(0, Number(minMargin) || 0);
  const sports = ["all", ...new Set(surebets.map((s) => s.sport))];
  const filtered = surebets
    .filter((s) => s.profitMargin * 100 >= minMarginNum)
    .filter((s) => sport === "all" || s.sport === sport)
    .sort((a, b) => b.profitMargin - a.profitMargin);
  const top = filtered.slice(0, 5);

  const crMin = info.cost > 0 ? Math.round((info.cost * 60000) / intervalMs) : 0;
  const sinceLast = Date.now() - lastPollRef.current;
  const pollPct = Math.min(100, (sinceLast / intervalMs) * 100);
  const nextInSec = Math.max(0, Math.ceil((intervalMs - sinceLast) / 1000));
  const remainingLive = remaining != null ? Math.max(0, remaining - info.used) : null;

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={{ margin: 0 }}>⚽ Surebets · en vivo</h1>
        <StatusPill status={status} />
      </header>

      {/* Barra de estado: modo, ritmo, créditos y cuenta atrás al siguiente sondeo */}
      <section style={styles.budgetBar}>
        <div style={styles.budgetRow}>
          <span>
            Modo <strong>cada {intervalMs / 1000}s</strong> · coste/sondeo <strong>{info.cost}</strong>
            {crMin > 0 && <> · <strong>{crMin} cr/min</strong></>}
            {remainingLive != null && <> · créditos ≈ <strong>{remainingLive}</strong></>}
            {" · gastadas "}<strong>{info.used}</strong>
            {!info.real && <span style={styles.muted}> · (datos de ejemplo)</span>}
          </span>
          <button style={styles.linkBtn} onClick={() => setStarted(false)}>cambiar key/modo</button>
        </div>
        {/* Cuenta atrás visual al siguiente sondeo */}
        <div style={styles.progressOuter}>
          <div style={{ ...styles.progressInner, width: `${pollPct}%`, background: "#2563eb" }} />
        </div>
        <div style={styles.muted}>Próxima actualización en ~{nextInSec}s</div>
        {errorMsg && <p style={{ color: "#dc2626", fontSize: 13, margin: "4px 0 0" }}>Error: {errorMsg}</p>}
      </section>

      {/* Controles */}
      <div style={styles.controls}>
        <label style={styles.control}>Banca (€)
          <input type="number" min={0} value={bankroll} style={styles.input}
            onChange={(e) => setBankroll(e.target.value)} />
        </label>
        <label style={styles.control}>Margen mín. (%)
          <input type="number" min={0} step={0.1} value={minMargin} style={styles.input}
            onChange={(e) => setMinMargin(e.target.value)} />
        </label>
        <label style={styles.control}>Deporte
          <select value={sport} style={styles.input} onChange={(e) => setSport(e.target.value)}>
            {sports.map((s) => <option key={s} value={s}>{s === "all" ? "todos" : s}</option>)}
          </select>
        </label>
        <button style={styles.linkBtn} onClick={() => Notification.requestPermission()}>Activar notificaciones</button>
      </div>

      {/* Dos lados: TOP | EN VIVO */}
      <div style={styles.layout}>
        <section style={{ flex: 1 }}>
          <h2 style={styles.h2}>🏆 Top beneficio</h2>
          {top.length === 0 && <p style={styles.muted}>Sin oportunidades.</p>}
          {top.map((sb, i) => (
            <div key={keyOf(sb)} style={styles.topRow}>
              <span style={styles.rank}>#{i + 1}</span>
              <div style={{ flex: 1 }}>
                <strong>{sb.eventName}</strong>
                <div style={styles.muted}>{sb.sport} · {sb.marketKey}</div>
              </div>
              <span style={styles.badge}>+{(sb.profitMargin * 100).toFixed(2)}%</span>
            </div>
          ))}
        </section>

        <section style={{ flex: 1.4 }}>
          <h2 style={styles.h2}>🔴 En vivo ({filtered.length})</h2>
          {filtered.length === 0 && <p style={styles.muted}>Esperando datos…</p>}
          {filtered.map((sb) => (
            <SurebetCard key={keyOf(sb)} surebet={sb} bankroll={bankrollNum} delta={deltas.current.get(keyOf(sb))} />
          ))}
        </section>
      </div>

      {/* Feed de alertas */}
      <section>
        <h2 style={styles.h2}>Alertas</h2>
        {feed.length === 0 && <p style={styles.muted}>Sin eventos aún…</p>}
        {feed.slice(0, 12).map((f) => (
          <div key={f.id} style={styles.feedItem}>
            {badge(f.type)} <strong>{f.surebet.eventName}</strong>
            <span style={styles.muted}>
              {" "}+{(f.profitMargin * 100).toFixed(2)}%
              {f.type === "changed" && f.previousMargin != null && ` (antes +${(f.previousMargin * 100).toFixed(2)}%)`}
              {" · "}{f.at}
            </span>
          </div>
        ))}
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "en vivo" ? "#16a34a" : status === "conectando" ? "#d97706" : status === "límite" ? "#dc2626" : "#dc2626";
  return <span style={{ ...styles.pill, background: color }}>● {status}</span>;
}

function badge(type: AlertType): string {
  return type === "new" ? "🟢 nueva" : type === "changed" ? "🟡 cambio" : "⚪ resuelta";
}

function SurebetCard({ surebet, bankroll, delta }: { surebet: Surebet; bankroll: number; delta?: number }) {
  const pct = (surebet.profitMargin * 100).toFixed(2);
  const plan = stakeSummary(surebet, bankroll > 0 ? bankroll : 100);
  const changed = delta != null && Math.abs(delta) > 1e-9;
  return (
    <section style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <strong>{surebet.eventName}</strong>{" "}
          <span style={styles.muted}>· {surebet.sport} · {surebet.marketKey}</span>
        </div>
        <span style={styles.badge}>
          +{pct}%
          {changed && (
            <span style={{ marginLeft: 6, color: delta! > 0 ? "#16a34a" : "#dc2626" }}>
              {delta! > 0 ? "▲" : "▼"} {(Math.abs(delta!) * 100).toFixed(2)}%
            </span>
          )}
        </span>
      </div>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Resultado</th><th style={styles.th}>Cuota</th>
            <th style={styles.th}>Casa</th><th style={styles.th}>Apuesta</th><th style={styles.th}>Retorno</th>
          </tr>
        </thead>
        <tbody>
          {plan.legs.map((l) => (
            <tr key={l.label}>
              <td style={styles.td}>{l.label}</td>
              <td style={styles.td}>
                {l.grossOdds.toFixed(2)}
                {Math.abs(l.grossOdds - l.odds) > 1e-9 && (
                  <span style={styles.muted}> (neta {l.odds.toFixed(2)})</span>
                )}
              </td>
              <td style={styles.td}>{l.bookmaker}</td>
              <td style={styles.td}>{l.stake.toFixed(2)} €</td>
              <td style={styles.td}>{l.payout.toFixed(2)} €</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={styles.guarantee}>
        Apostando <strong>{plan.totalStaked.toFixed(2)} €</strong> · garantizado{" "}
        <strong style={{ color: "#166534" }}>{plan.guaranteedProfit.toFixed(2)} € (+{(plan.guaranteedMargin * 100).toFixed(2)}%)</strong>
      </div>
      {surebet.marketKey === "dnb" && (
        <div style={styles.muted}>
          ⚠️ Ganador sin empate: si hay empate se reembolsa (sin pérdida; el beneficio solo se logra si no hay empate).
        </div>
      )}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: { fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem", color: "#1a1a1a" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  subtitle: { color: "#555", fontSize: 14 },
  entryCard: { border: "1px solid #e5e7eb", borderRadius: 12, padding: "1.5rem", maxWidth: 460, display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" },
  primaryBtn: { background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "0.6rem 1rem", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  modeList: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  modeBtn: { textAlign: "left", border: "1px solid #d1d5db", background: "#fff", borderRadius: 8, padding: "0.5rem 0.7rem", cursor: "pointer", fontSize: 14, color: "#1a1a1a" },
  modeBtnSel: { borderColor: "#2563eb", background: "#eff6ff", boxShadow: "0 0 0 1px #2563eb inset" },
  budgetBar: { border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.6rem 0.9rem", margin: "0.75rem 0" },
  budgetRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, flexWrap: "wrap", gap: 8 },
  progressOuter: { background: "#eef2f7", borderRadius: 999, height: 8, marginTop: 6, overflow: "hidden" },
  progressInner: { height: 8, borderRadius: 999, transition: "width .3s" },
  controls: { display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end", margin: "0.25rem 0 1rem" },
  control: { display: "flex", flexDirection: "column", fontSize: 12, color: "#555", gap: 4 },
  input: { padding: "0.35rem 0.45rem", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, minWidth: 120 },
  layout: { display: "flex", gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" },
  h2: { fontSize: 16, borderBottom: "2px solid #eee", paddingBottom: 4 },
  muted: { color: "#888", fontSize: 13 },
  pill: { color: "white", padding: "0.25rem 0.7rem", borderRadius: 999, fontSize: 13, fontWeight: 600 },
  linkBtn: { border: "none", background: "none", color: "#2563eb", cursor: "pointer", textDecoration: "underline", fontSize: 14, padding: 0 },
  topRow: { display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #f0f0f0", padding: "0.5rem 0" },
  rank: { fontWeight: 700, color: "#94a3b8", width: 28 },
  card: { border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.9rem", marginBottom: "0.9rem" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem", gap: 8 },
  badge: { background: "#dcfce7", color: "#166534", padding: "0.25rem 0.6rem", borderRadius: 999, fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" },
  guarantee: { marginTop: "0.5rem", fontSize: 13, color: "#555" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", borderBottom: "2px solid #e5e7eb", padding: "0.35rem 0.4rem", color: "#555" },
  td: { borderBottom: "1px solid #f0f0f0", padding: "0.35rem 0.4rem" },
  feedItem: { borderBottom: "1px solid #f0f0f0", padding: "0.4rem 0", fontSize: 14 },
};
