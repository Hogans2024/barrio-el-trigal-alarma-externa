# Página B — Alarma Externa Barrio El Trigal

Receptor de la **alarma vecinal en tiempo real** del Barrio El Trigal (Tarija, Bolivia).

Esta página es el "Página B" del sistema: escucha continuamente el canal de Ably
`barrio-trigal:alarma` y reproduce la sirena localmente cuando el vecindario activa
la alarma desde la Página A (la app principal del barrio).

## Cómo funciona

- La Página A (app del barrio) **publica** eventos `activar_alarma` / `desactivar_alarma`
  en Ably usando un cliente REST.
- Esta página (Página B) usa **Ably.Realtime** para mantener la conexión abierta y
  reaccionar al instante: suena la sirena al activar y se detiene al desactivar.
- La sirena usa la **misma síntesis de audio** (Web Audio API) que la Página A:
  el sonido es idéntico por diseño.

## Correr en local

1. `npm install`
2. Crea un archivo `.env.local` en la raíz con tu clave de suscripción:
   ```
   VITE_ABLY_SUBSCRIBE_KEY="tu-clave-de-suscripcion-aqui"
   ```
   (Clave de Ably con permiso únicamente `subscribe` sobre el canal `barrio-trigal:alarma`.)
3. `npm run dev`

## Deploy

El deploy a GitHub Pages es **automático vía GitHub Actions** al hacer `push` a `main`.
El workflow inyecta `VITE_ABLY_SUBSCRIBE_KEY` desde el secret del repositorio
`ABLY_SUBSCRIBE_KEY`.

> ⚠️ Requisitos manuales en la configuración del repo (no automatizables vía código):
> 1. Crear el secret `ABLY_SUBSCRIBE_KEY` (Settings → Secrets and variables → Actions).
> 2. Activar GitHub Pages con la fuente **"GitHub Actions"**
>    (Settings → Pages → Source → GitHub Actions).