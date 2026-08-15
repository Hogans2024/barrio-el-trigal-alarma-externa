/**
 * Reproducción de voz en tiempo real (Fase 6) para Página B.
 *
 * Buffer de reproducción con "jitter buffer" programado sobre el reloj
 * interno del AudioContext: cada chunk recibido se agenda para reproducirse
 * cuando termina el anterior (proximoInicio), en vez de audio.play() directo
 * que produce cortes/gaps por la irregularidad de la red.
 */
let audioCtx: AudioContext | null = null;
let proximoInicio = 0;

export const desbloquearAudioVoz = () => {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') audioCtx.resume();
};

export async function reproducirChunkVoz(arrayBuffer: ArrayBuffer): Promise<void> {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    const ahora = audioCtx.currentTime;
    // Si la cola se vació (silencio de red), reiniciar desde "ahora + pequeño
    // margen" en vez de intentar alcanzar el pasado.
    const inicio = Math.max(proximoInicio, ahora + 0.05);
    source.start(inicio);
    proximoInicio = inicio + audioBuffer.duration;
  } catch (err) {
    console.warn('[Voz] No se pudo decodificar/reproducir chunk de voz:', err);
  }
}

/** Vacía la cola de reproducción (llamar al recibir 'voz_fin' o nueva transmisión). */
export function reiniciarColaVoz(): void {
  proximoInicio = 0;
}