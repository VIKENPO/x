import { useEffect, useState } from "react";
import type { ChartData, Snapshot, TickerScore } from "@ss/core";
import { PriceChart } from "./PriceChart.js";
import { TradingClock } from "./TradingClock.js";

const REFRESH_MS = 60_000;

/** Dominio de cada empresa, para pedir su favicon real (servicio público y gratuito de Google). */
const TICKER_DOMAINS: Record<string, string> = {
  META: "meta.com",
  AMZN: "amazon.com",
  AAPL: "apple.com",
  GOOGL: "abc.xyz",
  MSFT: "microsoft.com",
  NVDA: "nvidia.com",
  TSLA: "tesla.com",
};

const madridTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso));

function bias(p: number): { label: string; className: string; arrow: string } {
  if (p >= 60) return { label: "sesgo alcista", className: "bias-up", arrow: "▲" };
  if (p <= 40) return { label: "sesgo bajista", className: "bias-down", arrow: "▼" };
  return { label: "sesgo neutral", className: "bias-flat", arrow: "＝" };
}

function CompanyLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const domain = TICKER_DOMAINS[symbol];
  if (!domain || failed) return <div className="logo-fallback">{symbol.charAt(0)}</div>;
  return (
    <img
      className="logo"
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt=""
      onError={() => setFailed(true)}
    />
  );
}

function TickerCard({ score, chart }: { score: TickerScore; chart: ChartData | undefined }) {
  const b = bias(score.bullishProbability);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { quote, news } = score.breakdown;

  return (
    <article className="card">
      <header className="card-header">
        <CompanyLogo symbol={score.symbol} />
        <div>
          <h2>{score.symbol}</h2>
          <p className="name">{score.name}</p>
        </div>
      </header>

      <div className={`signal ${b.className}`}>
        <span className="signal-value">
          {b.arrow} {score.bullishProbability}%
        </span>
        <span className="signal-label">probabilidad estimada de {b.label} en la apertura</span>
      </div>

      <PriceChart series={chart?.series} />

      <button className="details-toggle" onClick={() => setDetailsOpen((v) => !v)}>
        {detailsOpen ? "Ocultar detalles ▲" : "Ver de dónde sale este número ▼"}
      </button>
      {detailsOpen && (
        <dl className="breakdown">
          <div>
            <dt>Movimiento pre-mercado</dt>
            <dd>{quote ? `${(quote.changeRatio * 100).toFixed(2)}% vs. cierre anterior` : "sin dato todavía"}</dd>
          </div>
          <div>
            <dt>Sentimiento de noticias{news?.aiSummary ? " (IA)" : ""}</dt>
            <dd>
              {news && news.sampleSize > 0
                ? `${news.averageSentiment > 0 ? "positivo" : news.averageSentiment < 0 ? "negativo" : "neutro"} (${news.sampleSize} titulares analizados)`
                : "sin dato todavía"}
            </dd>
            {news?.aiSummary && <p className="ai-summary">"{news.aiSummary}"</p>}
          </div>
        </dl>
      )}
    </article>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [charts, setCharts] = useState<Record<string, ChartData>>({});
  const [error, setError] = useState<string | null>(null);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/data/latest.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (cancelled) return;
        setSnapshot(data);
        setError(null);

        const entries = await Promise.all(
          data.scores.map(async (s) => {
            try {
              const r = await fetch(`/data/charts/${s.symbol}.json?t=${Date.now()}`, { cache: "no-store" });
              if (!r.ok) return null;
              return [s.symbol, (await r.json()) as ChartData] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!cancelled) {
          setCharts(Object.fromEntries(entries.filter((e): e is [string, ChartData] => e !== null)));
        }
      } catch (err) {
        if (!cancelled) setError("No se ha podido cargar el snapshot de datos.");
        console.error(err);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const sorted = snapshot ? [...snapshot.scores].sort((a, b) => b.bullishProbability - a.bullishProbability) : [];

  return (
    <div className="app">
      <TradingClock />

      <header className="app-header">
        <img src="/icons/icon.svg" alt="" className="app-logo" />
        <div>
          <h1>SURE Statistics</h1>
          <p className="subtitle">Sesgo estimado de apertura para las principales tecnológicas de EE. UU.</p>
        </div>
      </header>

      <button className="disclaimer-compact" onClick={() => setDisclaimerOpen((v) => !v)}>
        ⓘ Estimación informativa, no es asesoramiento financiero
      </button>
      {disclaimerOpen && (
        <div className="disclaimer">
          Esto es una estimación heurística con fines informativos y educativos,
          <strong> no es asesoramiento financiero</strong>. No garantiza el
          comportamiento del mercado. Cualquier decisión de inversión debe
          revisarla cada uno bajo su propio criterio o con un profesional cualificado.
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {snapshot && (
        <p className="meta">
          Próxima apertura de Wall Street: <strong>{madridTime(snapshot.nextMarketOpenMadrid)}</strong> (hora de Madrid) ·
          Última actualización: {madridTime(snapshot.generatedAt)}
        </p>
      )}

      <main className="grid">
        {sorted.map((score) => (
          <TickerCard key={score.symbol} score={score} chart={charts[score.symbol]} />
        ))}
      </main>
    </div>
  );
}
