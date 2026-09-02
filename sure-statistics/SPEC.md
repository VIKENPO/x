# Spec — SURE Statistics (MVP)

> Estado: **MVP implementado** (2026-09-02). Decisiones tomadas con el
> usuario antes de construir: APIs 100% gratuitas, todas las fuentes de
> sentimiento disponibles gratis, entregable como PWA gratuita para móvil,
> universo fijo de 7 tickers. Requisitos y contexto originales abajo.

## Contexto / motivación (de la conversación original)

- El usuario opera con **Trade Republic** (ETFs). El mercado de EE. UU. abre
  a las **15:30 hora de Madrid** (9:30 ET), pero desde antes (pre-market,
  aprox. 10:00-11:00 Madrid en invierno en adelante) las cotizaciones ya se
  mueven — quiere saber, antes de la apertura, si el sesgo es alcista o
  bajista para los grandes valores tecnológicos.
- No busca asesoramiento financiero personalizado, sino una **señal
  agregada y transparente** (qué datos entraron y con qué peso) que él
  interprete con su propio criterio.

## Universo de valores

Fijo por ahora (roadmap: hacerlo configurable): `META, AMZN, AAPL, GOOGL,
MSFT, NVDA, TSLA` (`packages/pipeline/src/tickers.ts`).

## Señales y fuentes (todas gratuitas, todas oficiales)

| Señal            | Fuente                              | Qué mide                                             |
|------------------|--------------------------------------|-------------------------------------------------------|
| `quote`          | Finnhub `/quote`                     | Variación del propio ticker vs. cierre anterior.      |
| `marketProxy`    | Finnhub `/quote` sobre **SPY**       | Variación del mercado amplio (S&P 500).               |
| `news`           | Finnhub `/company-news`              | Sentimiento medio de titulares recientes (2 días).    |
| `reddit`         | Reddit OAuth2 `/r/.../search`        | Sentimiento medio de menciones recientes (24h).       |

Ninguna fuente hace scraping de HTML: todas son APIs oficiales con tier
gratuito (mismo criterio ético que `surebets`, ver su README). Sin las
claves correspondientes (`FINNHUB_API_KEY`, `REDDIT_CLIENT_ID/SECRET`), esa
señal se omite y el resto del pipeline sigue funcionando.

### Por qué no X

- **Twitter/X**: API oficial de pago (desde ~$100/mes) desde 2023 → descartada
  por el requisito "todo gratuito".
- **Futuros de índice (ES=F/NQ=F)**: no disponibles en el tier gratuito de
  Finnhub con símbolos de futuros; se usa el ETF **SPY** como proxy
  (sí soportado en el tier gratuito).
- **Scraping de webs financieras**: descartado por el mismo motivo que en
  `surebets` (contra ToS, fragil, no reproducible).

## El modelo de score (`@ss/core/src/score.ts`)

1. Cada señal disponible se normaliza a `[-1, 1]`:
   - `quote`/`marketProxy`: `changeRatio / 0.03`, recortado a `[-1,1]`
     (una variación de ±3% se considera "movimiento máximo típico" en
     pre-market para estas acciones).
   - `news`/`reddit`: la media de sentimiento léxico de los titulares/posts
     (ver `@ss/core/src/sentiment.ts`), ya en `[-1,1]`.
2. Media ponderada de las señales presentes (pesos en `WEIGHTS`):
   `quote=0.45, marketProxy=0.20, news=0.20, reddit=0.15`. El movimiento
   pre-market del propio valor pesa más porque es la señal más directa;
   el resto matiza. Si falta una señal, su peso simplemente no participa
   (no se rellena con 0 — así un ticker sin noticias no se penaliza).
3. La media combinada (`[-1,1]`) se mapea a **probabilidad de sesgo
   alcista** en `[5, 95]` (nunca 0/100: el modelo es heurístico, no una
   certeza). Sin ninguna señal disponible, es neutral (50%) con
   confianza 0.
4. **Confianza** = proporción del peso total que sí tenía señal disponible
   ese ciclo, en `[0,100]`.

### Análisis de sentimiento (`@ss/core/src/sentiment.ts`)

Léxico propio (no un diccionario de terceros con licencia dudosa, ni
llamada a un LLM: cero coste, cero red, 100% offline y testeable). Cada
palabra tiene un peso `[-5,5]`; un negador justo antes ("not", "no",
"never"...) invierte el signo. La media de las palabras encontradas se
normaliza a `[-1,1]`. Es una señal barata y transparente, **no** un modelo
de NLP entrenado — sus limitaciones (sarcasmo, negaciones complejas,
vocabulario no cubierto) son conocidas y aceptadas para este MVP.

## Cadencia y ventana horaria

- Cron de GitHub Actions: `*/30 7-16 * * 1-5` (UTC) → cada 30 min, L-V,
  cubre de sobra 08:00-18:00 hora de Madrid con margen para el cambio de
  hora CET/CEST.
- **Por qué 30 min y no menos**: GitHub Actions da 2000 min/mes gratis en
  repos privados. A 30 min de cadencia son ~390 runs/mes; a 15 min serían
  ~780 (el doble). Con `npm install` + pipeline por run (~1-1.5 min), 30 min
  deja margen holgado; bajar a 15 min es viable pero consume ~el doble del
  presupuesto gratuito — decisión a revisar si se quiere más frecuencia.
- `nextMarketOpenUtc` (`packages/pipeline/src/nextMarketOpen.ts`) calcula la
  próxima apertura (9:30 ET) sin librerías de zonas horarias, usando `Intl`
  con `timeZone: "America/New_York"`. Limitación conocida: no descarta
  festivos de mercado, solo fines de semana (roadmap).

## Persistencia: JSON commiteado, no base de datos

`packages/pipeline/src/writeSnapshot.ts` escribe:
- `packages/frontend/public/data/latest.json` — el snapshot actual (lo que
  lee la PWA).
- `packages/frontend/public/data/history/YYYY-MM-DD.json` — array con todos
  los snapshots del día (para un futuro gráfico intradía), podando ficheros
  de más de 30 días en cada ejecución.

Al ser parte del propio repo, cada commit del bot dispara un redeploy
automático y gratuito en Vercel/Cloudflare Pages — no hace falta una base de
datos ni un backend con servidor propio.

## Legítimo vs descartado

- ✅ APIs oficiales con tier gratuito (Finnhub, Reddit OAuth2), degradación
  elegante sin claves.
- ✅ Modelo transparente y heurístico, con disclaimer visible en la UI.
- ❌ Scraping de webs financieras o de redes sociales.
- ❌ Presentar el score como predicción certera o asesoramiento financiero.
