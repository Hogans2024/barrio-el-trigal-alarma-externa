/**
 * Reproducción de voz en tiempo real (Fase 6) para Página B.
 *
 * FIX importante: se usa un elemento <audio> nativo en cola secuencial en
 * lugar de AudioContext.decodeAudioData(). El motivo: MediaRecorder produce
 * WebM/Opus (o MP4/AAC en Safari), formatos que decodeAudioData NO decodifica
 * de forma fiable en la mayoría de navegadores — por eso el audio llegaba a
 * Página B pero nunca sonaba. Un <audio> con objectURL reproduce estos
 * formatos nativamente en todos los navegadores modernos.
 *
 * Se mantiene una cola encadenada con el evento 'ended' para evitar
 * solapamientos (dos chunks sonando encima) y minimizar huecos perceptibles,
 * aceptando el lag inherente del diseño walkie-talkie.
 */
let colaAudio: HTMLAudioElement[] = [];
let reproduciendo = false;
let mimeTypeActual = 'audio/webm';

export const desbloquearAudioVoz = () => {
  // Sin AudioContext: el <audio> nativo se desbloquea con el gesto de usuario
  // del botón "Habilitar Alarma Externa" (mismo clic que desbloquea la sirena).
};

/** Registra el mimeType anunciado por Página A (evento voz_inicio). */
export function setMimeTypeVoz(mimeType: string): void {
  mimeTypeActual = mimeType;
}

function reproducirSiguiente(): void {
  if (reproduciendo || colaAudio.length === 0) return;
  reproduciendo = true;
  const audio = colaAudio.shift()!;
  audio.onended = () => {
    reproduciendo = false;
    // Limpiar la URL del blob ya reproducido para liberar memoria.
    URL.revokeObjectURL(audio.src);
    reproducirSiguiente();
  };
  audio.play().catch((err) => {
    console.warn('[Voz] Error al reproducir chunk:', err);
    reproduciendo = false;
    URL.revokeObjectURL(audio.src);
    reproducirSiguiente();
  });
}

export function reproducirChunkVoz(arrayBuffer: ArrayBuffer): void {
  const blob = new Blob([arrayBuffer], { type: mimeTypeActual });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  colaAudio.push(audio);
  reproducirSiguiente();
}

/** Vacía la cola de reproducción (llamar al recibir 'voz_fin' o nueva transmisión). */
export function reiniciarColaVoz(): void {
  colaAudio.forEach((audio) => {
    audio.pause();
    URL.revokeObjectURL(audio.src);
  });
  colaAudio = [];
  reproduciendo = false;
}