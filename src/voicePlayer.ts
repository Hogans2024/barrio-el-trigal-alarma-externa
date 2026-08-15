/**
 * Reproducción de voz en tiempo real (Fase 6) para Página B.
 *
 * FIX 2 (definitivo): se usa MediaSource + SourceBuffer en lugar de <audio>
 * por chunk. Motivo: los chunks de MediaRecorder con timeslice NO son
 * archivos WebM completos (solo el primero lleva la cabecera de codec), así
 * que `new Audio(blob)` por chunk falla con NotSupportedError. MediaSource
 * concatena los chunks en un flujo de media continuo que el navegador
 * reproduce nativamente sin cortes ni solapamientos.
 */
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let audioElement: HTMLAudioElement | null = null;
let mediaSourceUrl: string | null = null;
let bufferCola: ArrayBuffer[] = [];
let appendEnCurso = false;
let transmisionActiva = false;
let mimeTypeActual = 'audio/webm;codecs=opus';

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

export function reproducirChunkVoz(arrayBuffer: ArrayBuffer): void {
  if (!transmisionActiva) {
    iniciarMediaSource();
  }
  bufferCola.push(arrayBuffer);
  procesarColaAppend();
}

/** Vacía la cola y cierra el flujo (llamar al recibir 'voz_fin' o nueva transmisión). */
export function reiniciarColaVoz(): void {
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