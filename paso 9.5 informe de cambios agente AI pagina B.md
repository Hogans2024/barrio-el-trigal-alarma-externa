# Paso 9.5: Informe de Cambios del Agente AI — Página B (Alarma Externa)

**Proyecto:** `barrio-el-trigal-alarma-externa` (Página B)  
**Fecha:** 24 de agosto de 2026  
**Commit de Despliegue:** `a0f6d10`  
**Mensaje de Commit:** `fix(voz): buffer de reordenamiento por numero de secuencia antes de entregar fragmentos a MediaSource, corrige transmision intermitente`

---

## 1. Contexto del Problema y Causa Raíz

En la **Fase 6** (Mensaje de Voz en Tiempo Real / Walkie-Talkie), Página A captura audio vía `MediaRecorder` emitiendo fragmentos (Blobs) cada 250 ms y los publica al canal de Ably (`barrio-trigal:alarma`). Página B los recibe para reproducirlos en vivo.

### Problema Reportado:
La voz llegaba de forma intermitente: a veces sonaba bien y otras veces se cortaba, saltaba o enmudecía por completo.

### Causa Raíz:
1. **Conversión Asíncrona (`Blob.arrayBuffer()` en Página A):** Al generarse fragmentos seguidos, no había garantía de que las promesas de conversión resolvieran en orden estricto de captura.
2. **Peticiones HTTP Independientes (`Ably.Rest.publish`):** Cada chunk viaja como petición HTTP separada, sin garantía de orden de llegada a nivel de red/servidor.
3. **Reproducción Estricta en Página B (`MediaSource` en modo `sequence`):** Si los fragmentos llegan en desorden (ej. chunk 2 antes que chunk 1), el stream de audio se corrompe o se detiene.

---

## 2. Solución Diseñada e Implementada

Se implementó un protocolo de **Framing Binario y Búfer de Reordenamiento**:

1. **Framing Binario (Página A):**
   * Se asigna un número de secuencia entero (`seq`: 0, 1, 2, 3...) de forma **síncrona** en `ondataavailable`.
   * Se empaqueta en los primeros 4 bytes del payload como `Uint32` en formato **Big-Endian** (`DataView.setUint32(0, seq, false)`).
   * Los bytes restantes contienen el audio crudo.

2. **Reordenamiento y Desempaquetado (Página B — `src/voicePlayer.ts`):**
   * Se extrae el `seq` de los primeros 4 bytes mediante `view.getUint32(0, false)`.
   * Se extrae el audio con `raw.slice(4)`.
   * Se mantiene un puntero `siguienteSeqEsperado` (iniciado en 0).
   * **Lógica de gestión por paquete:**
     * `seq < siguienteSeqEsperado`: Se descarta como paquete tardío/duplicado.
     * `seq === siguienteSeqEsperado`: Se envía inmediatamente a `MediaSource`, se incrementa `siguienteSeqEsperado += 1` y se intenta vaciar el búfer de espera.
     * `seq > siguienteSeqEsperado`: Llegó adelantado; se guarda en `bufferReordenamiento` (`Map<number, ArrayBuffer>`) y se inicia un temporizador de margen (`ESPERA_MAX_REORDENAMIENTO_MS = 400ms`).
   * **Temporizador de Recuperación (`programarEsperaReordenamiento`):** Si un fragmento intermedio se pierde por completo en la red, tras 400 ms el reproductor salta al menor `seq` disponible para no congelar el audio.
   * **Limpieza y Cierre (`reiniciarColaVoz`):** Se resetean `siguienteSeqEsperado = 0`, `bufferReordenamiento.clear()` y se limpian los timers al recibir `voz_inicio` o `voz_fin`.

---

## 3. Detalle de Archivos y Cambios en Página B

### Archivo Modificado: `src/voicePlayer.ts`
* **Nuevas estructuras de estado interno:**
  * `let siguienteSeqEsperado = 0;`
  * `let bufferReordenamiento: Map<number, ArrayBuffer> = new Map();`
  * `let timerEsperaReordenamiento: ReturnType<typeof setTimeout> | null = null;`
  * `const ESPERA_MAX_REORDENAMIENTO_MS = 400;`
* **Funciones internas añadidas/refactorizadas:**
  * `parsearChunkVoz(raw: ArrayBuffer)`: Desempaqueta `seq` (4 bytes Uint32 big-endian) y `audio`.
  * `agregarChunkOrdenado(arrayBuffer: ArrayBuffer)`: Envía el audio validado en orden al flujo `MediaSource`.
  * `intentarVaciarBufferReordenamiento()`: Vacía fragmentos contiguos en memoria e incrementa `siguienteSeqEsperado`.
  * `programarEsperaReordenamiento()`: Controla el timeout para evitar bloqueos por pérdida de paquetes.
  * `limpiarTimerReordenamiento()`: Cancela temporizadores pendientes.
* **Funciones públicas exportadas:**
  * `reproducirChunkVoz(arrayBufferCrudo: ArrayBuffer)`: Punto de entrada que recibe el chunk de Ably y aplica el reordenamiento.
  * `reiniciarColaVoz()`: Resetea contadores, mapas y stream de reproducción.
  * `setMimeTypeVoz(mimeType: string)` y `desbloquearAudioVoz()`.

### Archivo Mantenido Intacto: `src/ablySubscriber.ts`
* Mantiene su escucha en el canal `barrio-trigal:alarma`.
* Pasa el `ArrayBuffer` crudo recibido en el evento `voz_chunk` directamente a `reproducirChunkVoz(data)`.

---

## 4. Pruebas y Verificaciones Realizadas

1. **Autoverificación Estática de Código:**
   * Big-Endian confirmado (`false` en `getUint32`).
   * Descarte, entrega y almacenamiento en búfer verificados.
   * Incremento `siguienteSeqEsperado += 1` verificado dentro del bucle `while`.
   * Reset completo al recibir nueva transmisión.
2. **Typecheck (`tsc --noEmit`):** 0 errores.
3. **Build de Producción (`npm run build`):** Generado exitosamente en `dist/` (Vite v6.4.3).
4. **Git Sync & Push:** Confirmado y subido a la rama `main` en `https://github.com/Hogans2024/barrio-el-trigal-alarma-externa`.

---

## 5. Próximos Pasos

Esperar la finalización en verde del workflow de GitHub Actions en ambos repositorios (`barrio-el-trigal` y `barrio-el-trigal-alarma-externa`) para realizar la prueba integral de transmisión y recepción de voz en tiempo real.
