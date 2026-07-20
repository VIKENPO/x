# Surebets — comparador de cuotas de apuestas

Aplicación web que recoge cuotas de varias casas de apuestas, las compara y
detecta **oportunidades de arbitraje** (*surebets*): situaciones en las que,
apostando a todos los resultados de un evento en las casas adecuadas, se
garantiza beneficio pase lo que pase (cuando Σ 1/cuota < 1).

> ⚠️ **Aviso**: este proyecto es orientativo desde el punto de vista técnico.
> Las apuestas y el arbitraje están regulados de forma distinta según el país,
> y el uso automatizado de las webs de las casas suele ir **contra sus Términos
> de Servicio**. Revisa la legalidad en tu jurisdicción con un profesional
> cualificado antes de usarlo con datos reales.

## Arquitectura

```
providers (casas)  ->  merge/normalización  ->  motor de arbitraje  ->  API REST  ->  frontend
```

Monorepo con workspaces de npm:

| Paquete            | Rol                                                              |
|--------------------|------------------------------------------------------------------|
| `@x/core`          | Tipos, fusión de cuotas y **motor de detección de surebets**.    |
| `@x/providers`     | Adaptadores de fuentes. Cada casa implementa la misma interfaz.  |
| `@x/backend`       | API REST (Express) que ejecuta el pipeline.                      |
| `@x/frontend`      | Interfaz web (React + Vite) con la tabla de oportunidades.       |

### Patrón de providers

Cada fuente de cuotas (una API o un scraper de una casa) implementa la interfaz
`OddsProvider` y devuelve `ProviderQuote[]` normalizados. Añadir una casa nueva
**no requiere tocar** el resto del sistema: basta con crear el provider y
registrarlo en `activeProviders()`.

- `TheOddsApiProvider`: **provider real** (The Odds API, fuente con licencia).
  Una sola llamada masiva trae varias casas por evento (bet365, Winamax, Betfair,
  Pinnacle…). Soporta:
  - **Mercados destacados** (`/odds`): `h2h` (1x2/moneyline), `totals` (over/under
    de goles), `spreads` (hándicap .5).
  - **Mercados adicionales por-evento** (`/events/{id}/odds`, opt-in): `draw_no_bet`
    (ganador sin empate), `btts` (ambos marcan) y cualquier over/under (córners,
    tiros a puerta, tarjetas…). Limitado por `ODDS_API_MAX_EVENTS` para controlar cuota.
  - **Regiones** múltiples (`eu,uk,us`), **caché** con TTL y **reintentos** ante 429/5xx.
  - Se activa automáticamente si existe `ODDS_API_KEY`.
- `FixtureBookA` / `FixtureBookB`: datos de ejemplo con una surebet real. Se usan
  cuando no hay `ODDS_API_KEY` (útil para la demo).

> Nota: **no se hace scraping** de las webs de las casas (va contra sus ToS y su
> anti-bot). Los datos vienen de una API con licencia.

### Datos reales (The Odds API)

```bash
cp .env.example .env      # y pon tu ODDS_API_KEY (gratis en the-odds-api.com)
npm run dev:backend
```

Con `ODDS_API_KEY` presente, `activeProviders()` cambia de los fixtures al
provider real automáticamente. Sin key, sigue con los datos de ejemplo.

## Puesta en marcha

```bash
npm install

# Motor de arbitraje (tests)
npm test

# Backend  ->  http://localhost:4000/api/opportunities
npm run dev:backend

# Frontend ->  http://localhost:5173  (proxy /api al backend)
npm run dev:frontend
```

## Tiempo real, BYOK y presupuesto

El tiempo real es **BYOK (Bring Your Own Key)**: cada usuario introduce su propia
`ODDS_API_KEY` y consume **su propia cuota** (no hay pooling ni rotación de keys).
Por cada conexión **WebSocket** (`ws://localhost:4000/ws`) el backend arranca un
**monitor** dedicado con la key de ese usuario y su **presupuesto de peticiones**:

1. El cliente envía `{ apiKey, budget, minProfit }` al conectar.
2. El monitor sondea cada `POLL_INTERVAL_MS`, descontando el coste por sondeo
   (`sports×regions×markets` + adicionales por-evento) del `budget`.
3. Al agotar el presupuesto, **para** y avisa (`budget-reached`) → protege la cuota.

Cada ciclo compara con el anterior y emite **alertas** (`new` / `changed` /
`resolved`). El frontend muestra dos lados — **TOP** (ranking por beneficio) y
**EN VIVO** (todas, con indicador ▲/▼ del cambio de %) — banca configurable con
beneficio garantizado real, filtros y notificaciones del navegador.

**Endpoints REST** (aceptan la key BYOK por cabecera `x-odds-api-key`):
- `GET /api/opportunities?minProfit=&stake=` — surebets; con `stake`, cada una
  incluye `plan` (reparto + beneficio garantizado real).
- `GET /api/quotes` — todos los mercados cruzados.
- `GET /api/history?limit=` — histórico de alertas (persistible en JSONL).

### Fiabilidad
- **Comisión de exchanges**: las cuotas de Betfair/Smarkets/etc. se ajustan a su
  valor **neto** antes de calcular, para no reportar surebets falsas.
- **Tope de margen** (`MAX_PROFIT_MARGIN`): descarta márgenes irreales (datos malos).
- **Filtro temporal** (`MIN_LEAD_MS`): descarta eventos ya empezados.
- **Matching** de eventos con union-find y comparación por participantes.

**Demo sin API real:** arranca con `FIXTURE_JITTER=1` para que las cuotas de
ejemplo varíen entre ciclos y veas las alertas dispararse:

```bash
FIXTURE_JITTER=1 POLL_INTERVAL_MS=2000 npm run dev:backend
npm run dev:frontend   # y abre http://localhost:5173
```

## El motor de arbitraje (`@x/core`)

- Probabilidad implícita de una cuota decimal = `1 / cuota`.
- Se toma la **mejor cuota** de cada resultado entre todas las casas.
- Se usa la **mejor cuota NETA** (tras comisión de exchange) de cada resultado.
- `S = Σ (1 / mejor_cuota)`. Si `S < 1` → **surebet**.
- Beneficio garantizado sobre el capital = `(1 / S) - 1`.
- Reparto óptimo: `stake_i = (1 / mejor_cuota_i) / S`.
- `stakeSummary` calcula la **garantía real** tras redondear los stakes a céntimos.

## Roadmap

1. ✅ **Esqueleto + motor de arbitraje** con datos de ejemplo.
2. ✅ **Provider real** (The Odds API) con multi-región, caché y reintentos.
3. ✅ **Normalización y *matching*** de eventos entre casas (union-find).
4. ✅ **Múltiples mercados**: h2h, totals, spreads, draw_no_bet, btts y over/under
   genérico (córners/tiros/tarjetas) vía endpoint por-evento.
5. ✅ **Tiempo real BYOK + presupuesto** (WebSocket por conexión, diffing, alertas).
6. ✅ **Fiabilidad**: comisión de exchanges, tope de margen, filtro temporal.
7. ⬜ Scrapers de casas — **descartado** (contra ToS/anti-bot; se usa API con licencia).
