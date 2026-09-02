import { useEffect, useRef, useState } from "react";
import { ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { ChartRange, PriceBar } from "@ss/core";

const RANGES: ChartRange[] = ["1D", "1W", "1M", "1Y", "MAX"];
const RANGE_LABELS: Record<ChartRange, string> = { "1D": "1D", "1W": "1S", "1M": "1M", "1Y": "1A", MAX: "Máx" };

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

function toChartData(bars: PriceBar[]) {
  return bars.map((b) => ({ time: Math.floor(new Date(b.time).getTime() / 1000) as UTCTimestamp, value: b.close }));
}

export function PriceChart({ series }: { series: Record<ChartRange, PriceBar[]> | undefined }) {
  const [range, setRange] = useState<ChartRange>("1D");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const bars = series?.[range] ?? [];
  const positive = bars.length >= 2 ? bars[bars.length - 1].close >= bars[0].close : true;
  const accent = positive ? "#4ade80" : "#f87171";

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1e293b" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      height: 160,
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    const resize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (seriesRef.current) chart.removeSeries(seriesRef.current);
    const s = chart.addAreaSeries({
      lineColor: accent,
      topColor: `${accent}55`,
      bottomColor: `${accent}05`,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: bars.length > 0,
      priceFormat: { type: "custom", formatter: (p: number) => eur.format(p) },
    });
    s.setData(toChartData(bars));
    seriesRef.current = s;
    chart.timeScale().fitContent();
  }, [bars, accent]);

  const lastPrice = bars.length > 0 ? bars[bars.length - 1].close : null;

  return (
    <div className="chart-block">
      <div className="chart-toolbar">
        <span className="chart-price">{lastPrice != null ? eur.format(lastPrice) : "—"}</span>
        <div className="chart-ranges">
          {RANGES.map((r) => (
            <button key={r} className={r === range ? "chart-range active" : "chart-range"} onClick={() => setRange(r)}>
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} className="chart-canvas" />
      {bars.length === 0 && <p className="chart-empty">Sin histórico de precio todavía para este rango.</p>}
    </div>
  );
}
