# SURE Statistics — probabilidad de sesgo de apertura en bolsa

PWA que estima, para un puñado de grandes tecnológicas de EE. UU. (Meta,
Amazon, Apple, Alphabet, Microsoft, NVIDIA, Tesla), la **probabilidad de que
el mercado abra/siga con sesgo alcista o bajista**, combinando el movimiento
**pre-market**, el mercado amplio (S&P 500), noticias y menciones en Reddit.

> ⚠️ **Aviso**: esto es un modelo **heurístico** (media ponderada de señales),
> no un modelo entrenado ni una predicción validada estadísticamente. Es
> orientativo, con fines informativos y educativos: **no es asesoramiento
> financiero**. El comportamiento pasado de estas señales no garantiza nada
> sobre la sesión que empieza. Cualquier decisión de inversión (en Trade
> Republic o cualquier bróker) debe revisarla cada uno bajo su propio
> criterio o con un profesional cualificado. Ver más detalle en `SPEC.md`.

## Por qué existe

El mercado de EE. UU. abre a las 15:30 hora de Madrid (9:30 hora de Nueva
York), pero desde bastante antes (pre-market, aprox. desde las 10:00-11:00
Madrid en invierno) las cotizaciones ya se mueven con las primeras noticias,
estimaciones y órdenes. Esta app centraliza esa ventana de pre-mercado en
una sola pantalla, para consultarla desde el móvil antes de que abra.

## Arquitectura — 100% gratuita, sin servidor propio

```
GitHub Actions (cron, gratis)  --calcula-->  data/latest.json (commit al repo)
                                                      |
                                                      v
                                   Vercel/Cloudflare Pages (gratis, auto-deploy)
                                                      |
                                                      v
                                        PWA (React) instalable en el móvil
```

No hay base de datos ni servidor de pago: el propio JSON commiteado al repo
**es** la "base de datos", y cada commit dispara un redeploy estático gratis.

| Paquete            | Rol                                                                 |
|--------------------|----------------------------------------------------------------------|
| `@ss/core`         | Tipos, léxico de sentimiento y el **modelo de score** (puro, testeado). |
| `@ss/providers`    | Adaptadores a APIs con licencia y tier gratuito (Finnhub, Reddit).    |
| `@ss/pipeline`     | Script que orquesta providers + core y escribe `data/latest.json`.   |
| `@ss/frontend`     | PWA (React + Vite + `vite-plugin-pwa`), instalable en el móvil.       |

### Fuentes de datos (todas gratuitas, todas oficiales — sin scraping)

- **Cotizaciones y noticias**: [Finnhub](https://finnhub.io) (tier gratuito:
  cotización en tiempo real + noticias por empresa). `FINNHUB_API_KEY` gratis
  registrándose.
- **Mercado amplio**: cotización del ETF **SPY** (S&P 500) vía Finnhub, como
  proxy de "cómo va el mercado en general".
- **Reddit**: API OAuth2 oficial (app tipo "script", gratis en
  reddit.com/prefs/apps), búsqueda de menciones del ticker en r/stocks,
  r/wallstreetbets y r/investing.
- Sin ninguna de las claves, esa fuente simplemente se omite (el resto de
  señales sigue funcionando) — mismo criterio BYOK/degradación elegante que
  `surebets`.

### El modelo de score (`@ss/core`)

Ver el detalle completo en [`SPEC.md`](./SPEC.md). Resumen: cada señal
(variación pre-market propia, variación de SPY, sentimiento de noticias,
sentimiento de Reddit) se normaliza a `[-1, 1]` y se combina en una media
ponderada; el resultado se mapea a una probabilidad entre **5% y 95%**
(nunca 0/100%, precisamente porque no es una certeza). Se acompaña de una
**confianza** (0-100%) que baja cuantas menos señales había disponibles ese
ciclo.

## Puesta en marcha (local)

```bash
cd sure-statistics
npm install
cp .env.example .env      # opcional: añade tus claves gratuitas

npm test                  # tests del modelo y de los providers (con fixtures)
npm run pipeline          # genera packages/frontend/public/data/latest.json
npm run dev:frontend      # -> http://localhost:5174
```

## Despliegue gratuito

1. **Datos**: el workflow `.github/workflows/sure-statistics-pipeline.yml`
   corre cada 30 min (L-V, ventana de pre-mercado/apertura) en GitHub Actions
   (gratis dentro de las 2000 min/mes del plan Free), ejecuta el pipeline y
   commitea `packages/frontend/public/data/`. Añade `FINNHUB_API_KEY`,
   `REDDIT_CLIENT_ID` y `REDDIT_CLIENT_SECRET` como **Secrets** del repo para
   que use datos reales (si no, corre igualmente mostrando "sin dato").
2. **PWA**: conecta el repo a [Vercel](https://vercel.com) (plan Hobby,
   gratuito, admite repos privados) o [Cloudflare Pages](https://pages.cloudflare.com),
   con *root directory* `sure-statistics/packages/frontend`, build command
   `npm run build` y output `dist`. Cada commit del bot de datos dispara un
   redeploy automático y gratuito.
   - GitHub Pages **no** vale aquí directamente porque el repo es privado (Pages
     público desde repo privado requiere GitHub Pro); Vercel/Cloudflare sí
     despliegan gratis desde un repo privado.
3. Desde el móvil, abre la URL desplegada y usa "Añadir a pantalla de inicio"
   (Android: menú del navegador; iOS Safari: compartir → Añadir a inicio).

## Roadmap

1. ✅ Modelo de score heurístico (`@ss/core`) con tests.
2. ✅ Providers gratuitos (Finnhub, Reddit) con degradación sin claves.
3. ✅ Pipeline programado (GitHub Actions) que escribe el snapshot + histórico.
4. ✅ PWA instalable con el desglose por ticker.
5. ⬜ Iconos PNG reales (192/512) para un icono nítido en iOS — de momento
   se usa un SVG placeholder.
6. ⬜ Añadir QQQ (Nasdaq 100) como segunda señal de mercado amplio.
7. ⬜ Tener en cuenta festivos de mercado en `nextMarketOpenUtc` (hoy solo
   descarta fines de semana).
8. ⬜ Gráfico de evolución intradía usando el histórico ya guardado en
   `data/history/`.
