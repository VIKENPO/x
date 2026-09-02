# x

Monorepo personal. Contiene subproyectos independientes:

- **`surebets/`** — comparador de cuotas de apuestas que detecta oportunidades de
  arbitraje (*surebets*) en tiempo real. Lee datos de una API con licencia
  (The Odds API), no hace scraping ni coloca apuestas. Ver `surebets/README.md`.
- **`supercuotas/`** — *(pendiente de crear)*.
- **`sure-statistics/`** — PWA que estima la probabilidad de sesgo alcista/
  bajista en la apertura de Wall Street para grandes tecnológicas, a partir
  de pre-market, mercado amplio, noticias y Reddit (todo con APIs oficiales
  gratuitas). Ver `sure-statistics/README.md` y `sure-statistics/SPEC.md`.

> Los secretos (`.env`) quedan fuera del control de versiones (ver `.gitignore`).
