import { useEffect, useState } from "react";
import type { Snapshot, TickerScore } from "@ss/core";

const REFRESH_MS = 60_000;

const madridTime = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(new Date(iso));

function biasLabel(p: number): { label: string; className: string } {
  if (p >= 60) return { label: "Alcista", className: "bias-up" };
  if (p <= 40) return { label: "Bajista", className: "bias-down" };
  return { label: "Neutral", className: "bias-flat" };
}

function TickerCard({ score }: { score: TickerScore }) {
  const bias = biasLabel(score.bullishProbability);
  const { quote, news, reddit } = score.breakdown;
  return (
    <article className="card">
      <header className="card-header">
        <div>
          <h2>{score.symbol}</h2>
          <p className="name">{score.name}</p>
        </div>
        <span className={`bias-pill ${bias.className}`}>{bias.label}</span>
      </header>

      <div className="prob-row">
        <div className="prob-bar-track">
          <div className="prob-bar-fill" style={{ width: `${score.bullishProbability}%` }} />
        </div>
        <span className="prob-value">{score.bullishProbability}%</span>
      </div>
      <p className="confidence">Confianza del modelo: {score.confidence}%</p>

      <dl className="breakdown">
        <div>
          <dt>Pre-market</dt>
          <dd>{quote ? `${(quote.changeRatio * 100).toFixed(2)}%` : "sin dato"}</dd>
        </div>
        <div>
          <dt>Noticias</dt>
          <dd>{news && news.sampleSize > 0 ? `${news.averageSentiment.toFixed(2)} (${news.sampleSize})` : "sin dato"}</dd>
        </div>
        <div>
          <dt>Reddit</dt>
          <dd>{reddit && reddit.sampleSize > 0 ? `${reddit.averageSentiment.toFixed(2)} (${reddit.sampleSize})` : "sin dato"}</dd>
        </div>
      </dl>
    </article>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/data/latest.json?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
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
      <header className="app-header">
        <h1>SURE Statistics</h1>
        <p className="subtitle">Sesgo estimado de apertura para las principales tecnológicas de EE. UU.</p>
      </header>

      <div className="disclaimer">
        ⚠️ Esto es una estimación heurística con fines informativos y educativos,
        <strong> no es asesoramiento financiero</strong>. No garantiza el
        comportamiento del mercado. Cualquier decisión de inversión debe
        revisarla cada uno bajo su propio criterio o con un profesional cualificado.
      </div>

      {error && <p className="error">{error}</p>}

      {snapshot && (
        <p className="meta">
          Próxima apertura de Wall Street: <strong>{madridTime(snapshot.nextMarketOpenMadrid)}</strong> (hora de Madrid) ·
          Última actualización: {madridTime(snapshot.generatedAt)}
        </p>
      )}

      <main className="grid">
        {sorted.map((score) => (
          <TickerCard key={score.symbol} score={score} />
        ))}
      </main>
    </div>
  );
}
