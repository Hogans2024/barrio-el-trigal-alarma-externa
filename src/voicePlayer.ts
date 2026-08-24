/**
 * Reproducción de voz en tiempo real (Fase 6) para Página B.
 *
 * FIX 2 (definitivo): se usa MediaSource + SourceBuffer en lugar de <audio>
 * por chunk. Motivo: los chunks de MediaRecorder con timeslice NO son
 * archivos WebM completos (solo el primero lleva la cabecera de codec), así
 * que `new Audio(blob)` por chunk falla con NotSupportedError. MediaSource
 * concatena los chunks en un flujo de media continuo que el navegador
 * reproduce nativamente sin cortes ni solapamientos.
 *
 * FIX 3 (reordenamiento): los fragmentos viajan con un número de secuencia
 * embebido en sus primeros 4 bytes (Uint32 big-endian, emitido por Página A).
 * Como la red y la conversión asíncrona de datos en Página A no garantizan
 * orden de llegada, aquí se reordenan antes de entregarlos a MediaSource.
 * Ver bloque "Reordenamiento de fragmentos de voz" más abajo.
 */
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let audioElement: HTMLAudioElement | null = null;
let mediaSourceUrl: string | null = null;
let bufferCola: ArrayBuffer[] = [];
let appendEnCurso = false;
let transmisionActiva = false;
let mimeTypeActual = 'audio/webm;codecs=opus';

// ---- Reordenamiento de fragmentos de voz (ver PROMPT de corrección) ----
// Página A numera cada fragmento con un "seq" embebido en sus primeros 4
// bytes (Uint32 big-endian). Como ni la red ni la conversión de datos en
// Página A garantizan que los fragmentos lleguen en orden, aquí se
// reordenan antes de entregarlos a MediaSource.
let siguienteSeqEsperado = 0;
let bufferReordenamiento: Map<number, ArrayBuffer> = new Map();
let timerEsperaReordenamiento: ReturnType<typeof setTimeout> | null = null;
// Margen máximo de espera por un fragmento que falta antes de saltarlo.
// Los fragmentos llegan cada ~250ms; 400ms da margen para un reordenamiento
// normal sin congelar el audio demasiado tiempo si de verdad se perdió uno.
const ESPERA_MAX_REORDENAMIENTO_MS = 400;

export const desbloquearAudioVoz = () => {
  // El <audio> de MediaSource se desbloquea con el gesto del botón
  // "Habilitar Alarma Externa" (autoplay permitido tras interacción).
};

/** Registra el mimeType anunciado por Página A (evento voz_inicio). */
export function setMimeTypeVoz(mimeType: string): void {
  mimeTypeActual = mimeType;
}

function procesarColaAppend(): void {
  if (!sourceBuffer || appendEnCurso || bufferCola.length === 0) return;
  if (mediaSource && mediaSource.readyState !== 'open') return;
  appendEnCurso = true;
  const chunk = bufferCola.shift()!;
  try {
    sourceBuffer.appendBuffer(chunk);
  } catch (err) {
    console.warn('[Voz] appendBuffer falló:', err);
    appendEnCurso = false;
  }
}

function iniciarMediaSource(): void {
  if (transmisionActiva) return;
  transmisionActiva = true;
  bufferCola = [];
  appendEnCurso = false;

  mediaSource = new MediaSource();
  mediaSourceUrl = URL.createObjectURL(mediaSource);
  audioElement = new Audio();
  audioElement.src = mediaSourceUrl;

  mediaSource.addEventListener('sourceopen', () => {
    try {
      if (!mediaSource) return;
      sourceBuffer = mediaSource.addSourceBuffer(mimeTypeActual);
      sourceBuffer.mode = 'sequence';
      sourceBuffer.addEventListener('updateend', () => {
        appendEnCurso = false;
        procesarColaAppend();
      });
      procesarColaAppend();
    } catch (err) {
      console.warn('[Voz] No se pudo crear SourceBuffer (%s):', mimeTypeActual, err);
    }
  });

  audioElement.play().catch((err) => {
    console.warn('[Voz] No se pudo iniciar reproducción:', err);
  });
}

/**
 * Entrega un fragmento YA CONFIRMADO EN ORDEN al MediaSource. No llamar
 * directamente desde fuera de este archivo — usar reproducirChunkVoz(),
 * que se encarga de reordenar primero.
 */
function agregarChunkOrdenado(arrayBuffer: ArrayBuffer): void {
  if (!transmisionActiva) {
    iniciarMediaSource();
  }
  bufferCola.push(arrayBuffer);
  procesarColaAppend();
}

/**
 * Separa un fragmento crudo recibido en (número de secuencia, audio real).
 * Devuelve null si el fragmento es demasiado pequeño para siquiera
 * contener el encabezado de 4 bytes (fragmento corrupto/inválido).
 */
function parsearChunkVoz(raw: ArrayBuffer): { seq: number; audio: ArrayBuffer } | null {
  if (raw.byteLength < 4) return null;
  const view = new DataView(raw);
  const seq = view.getUint32(0, false); // false = big-endian, debe coincidir con Página A
  const audio = raw.slice(4);
  return { seq, audio };
}

function limpiarTimerReordenamiento(): void {
  if (timerEsperaReordenamiento !== null) {
    clearTimeout(timerEsperaReordenamiento);
    timerEsperaReordenamiento = null;
  }
}

/** Entrega en orden todos los fragmentos consecutivos ya disponibles en el búfer. */
function intentarVaciarBufferReordenamiento(): void {
  while (bufferReordenamiento.has(siguienteSeqEsperado)) {
    const audio = bufferReordenamiento.get(siguienteSeqEsperado)!;
    bufferReordenamiento.delete(siguienteSeqEsperado);
    agregarChunkOrdenado(audio);
    siguienteSeqEsperado += 1;
  }
  limpiarTimerReordenamiento();
  if (bufferReordenamiento.size > 0) {
    // Todavía queda algo esperando un fragmento intermedio que falta.
    programarEsperaReordenamiento();
  }
}

/** Si el fragmento que falta no llega a tiempo, salta adelante para no congelar el audio. */
function programarEsperaReordenamiento(): void {
  limpiarTimerReordenamiento();
  timerEsperaReordenamiento = setTimeout(() => {
    if (bufferReordenamiento.size === 0) return;
    const seqsDisponibles = Array.from(bufferReordenamiento.keys()).sort((a, b) => a - b);
    console.warn(
      '[Voz] Fragmento %d no llegó a tiempo (%dms), saltando al %d disponible.',
      siguienteSeqEsperado,
      ESPERA_MAX_REORDENAMIENTO_MS,
      seqsDisponibles[0],
    );
    siguienteSeqEsperado = seqsDisponibles[0];
    intentarVaciarBufferReordenamiento();
  }, ESPERA_MAX_REORDENAMIENTO_MS);
}

/**
 * Punto de entrada público: recibe un fragmento CRUDO tal como llega de
 * Ably (con el número de secuencia embebido en los primeros 4 bytes),
 * lo reordena si hace falta, y entrega a MediaSource solo cuando el
 * orden está garantizado. Ver comentario de cabecera del archivo y el
 * bloque "Reordenamiento de fragmentos de voz" más arriba.
 */
export function reproducirChunkVoz(arrayBufferCrudo: ArrayBuffer): void {
  const parsed = parsearChunkVoz(arrayBufferCrudo);
  if (!parsed) {
    console.warn('[Voz] Fragmento recibido inválido (muy pequeño), descartado.');
    return;
  }
  const { seq, audio } = parsed;

  if (seq < siguienteSeqEsperado) {
    // Ya se procesó ese número (duplicado tardío o reenvío): descartar.
    console.warn('[Voz] Fragmento %d descartado (ya se procesó hasta %d).', seq, siguienteSeqEsperado);
    return;
  }
  if (seq === siguienteSeqEsperado) {
    agregarChunkOrdenado(audio);
    siguienteSeqEsperado += 1;
    intentarVaciarBufferReordenamiento(); // por si ya había fragmentos posteriores esperando
    return;
  }
  // seq > siguienteSeqEsperado: llegó adelantado, guardarlo y esperar el que falta.
  bufferReordenamiento.set(seq, audio);
  if (timerEsperaReordenamiento === null) {
    programarEsperaReordenamiento();
  }
}

/** Vacía la cola y cierra el flujo (llamar al recibir 'voz_fin' o nueva transmisión). */
export function reiniciarColaVoz(): void {
  siguienteSeqEsperado = 0;
  bufferReordenamiento.clear();
  limpiarTimerReordenamiento();

  transmisionActiva = false;
  bufferCola = [];
  appendEnCurso = false;

  if (mediaSource && mediaSource.readyState === 'open') {
    try {
      // endOfStream lanza InvalidStateError si hay un appendBuffer en curso.
      if (sourceBuffer && sourceBuffer.updating) {
        sourceBuffer.addEventListener('updateend', () => {
          try {
            mediaSource?.endOfStream();
          } catch {
            /* noop */
          }
        }, { once: true });
      } else {
        mediaSource.endOfStream();
      }
    } catch (err) {
      /* noop: flujo ya cerrado o sin datos suficientes */
    }
  }
  if (audioElement) {
    audioElement.pause();
    audioElement.src = '';
    audioElement = null;
  }
  if (mediaSourceUrl) {
    URL.revokeObjectURL(mediaSourceUrl);
    mediaSourceUrl = null;
  }
  mediaSource = null;
  sourceBuffer = null;
}