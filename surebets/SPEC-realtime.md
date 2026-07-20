# Spec — Tiempo real BYOK + control de gasto + TOP/live (Opción A)

> Estado: **IMPLEMENTADO** (2026-07-16). Backend WS BYOK por conexión + presupuesto;
> frontend con pantalla de key, slider de presupuesto, barra de gasto, columnas
> TOP | EN VIVO e indicador ▲/▼ de cambio de %. Requisitos originales del usuario abajo.

## Modelo de datos/claves
- **BYOK (Bring Your Own Key)**: cada usuario introduce **su propia** `ODDS_API_KEY` al entrar
  (se guarda en `localStorage`, por navegador/persona). Cada uno consume **su propia cuota**.
- **NADA de pooling ni rotación de keys entre cuentas** para exceder cuota (descartado por ToS).
- **Opción A (tiempo real)**: WebSocket con un **monitor por usuario/conexión** que sondea con la key de ese usuario.

## Requisitos funcionales
1. **Control de gasto por usuario (barra/slider)**
   - El usuario fija la **cantidad de peticiones (cuota) que quiere gastar** (presupuesto de requests).
   - El sondeo se **detiene al alcanzar el límite**; mostrar **consumido / restante**.
   - Coste por sondeo = `regions.length × markets.length` (modelo de The Odds API) → contarlo.
   - Al agotar el presupuesto, avisar al cliente ("límite alcanzado / cuota agotada").
2. **Ordenación por beneficio**: las surebets con **mayor % de beneficio ARRIBA** (orden descendente).
3. **Layout dividido en dos lados**
   - **Lado A — TOP**: ranking de las surebets con **mayor beneficio** (el "top").
   - **Lado B — EN VIVO**: feed donde las cuotas se van **actualizando** continuamente.
4. **Actualización en vivo + cambios de %**
   - Toda surebet se refresca en vivo.
   - Si su **% de beneficio varía**, **indicarlo** (flecha ↑/↓ y valor anterior → nuevo).

## Notas de implementación (para ejecutar)
- **Backend**
  - Aceptar la key por conexión WS (p. ej. `x-odds-api-key` o primer mensaje del cliente).
  - Un `SurebetMonitor` **por conexión**, instanciado con la key de ese usuario; **parar al desconectar** y al **alcanzar el presupuesto**.
  - **Contador de peticiones por conexión** (cost = regions×markets por tick); cortar sondeo al llegar al límite y emitir evento "budget-reached".
  - El monitor ya emite `new` / `changed` / `resolved`; `changed` trae `previousMargin` → sirve para el indicador de cambio de %.
- **Frontend**
  - Pantalla/campo para introducir la **API key** (localStorage) al entrar.
  - **Slider** de presupuesto de peticiones + indicador de consumo/restante.
  - **Dos columnas**: TOP (mayor beneficio) y LIVE (actualización continua).
  - Indicador por surebet cuando cambia el % (↑/↓, anterior→nuevo).
  - Reusar `stakeSummary` (beneficio garantizado real) y `findSurebets` (ya ordena desc por margen).

## Legítimo vs descartado
- ✅ Cada usuario su key y su gasto (BYOK) + límite de peticiones autoimpuesto.
- ❌ Pool/rotación de muchas keys gratuitas para superar la cuota por cuenta (ToS).
