/**
 * Suscripción a Ably para Página B (Barrio El Trigal).
 *
 * A diferencia de Página A (que usa Ably.Rest para publicar), aquí se usa
 * Ably.Realtime porque Página B debe mantener la conexión abierta para
 * recibir el evento apenas ocurra. La sirena suena localmente con la misma
 * síntesis que Página A (src/audioSiren.ts).
 *
 * Seguridad (ver sección 3 del PROMPT_INTEGRACION_ABLY_ALARMA_VOZ.md):
 * la key es subscribe-only restringida al canal barrio-trigal:alarma.
 * En un frontend 100% estático la key viaja en el bundle; riesgo conocido.
 *
 * Punto 5 de la Fase 5 (retomar estado al reconectar): además de subscribe,
 * la key necesita la capability `history` para poder consultar
 * channel.history(). Sigue SIN Publish: un atacante que extraiga la key del
 * bundle podría leer el historial, pero NUNCA disparar falsas alarmas.
 */
import Ably from 'ably';
import { startSiren, stopSiren } from './audioSiren';
import { establecerLinterna } from './kodularBridge';
import { reproducirChunkVoz, reiniciarColaVoz, setMimeTypeVoz } from './voicePlayer';

const ABLY_SUBSCRIBE_KEY = import.meta.env.VITE_ABLY_SUBSCRIBE_KEY as string | undefined;
const ALARMA_CHANNEL_NAME = 'barrio-trigal:alarma';


/** Estado de conexión expuesto a la UI (conjunto reducido que usa main.ts). */
export type EstadoConexionAbly = 'connected' | 'disconnected' | 'connecting' | 'suspended';

let alarmaActivaSirenId: string | null = null;
let temporizadorAutoApagado: ReturnType<typeof setTimeout> | null = null;

function limpiarTemporizadorAutoApagado(): void {
  if (temporizadorAutoApagado !== null) {
    clearTimeout(temporizadorAutoApagado);
    temporizadorAutoApagado = null;
  }
}

/**
 * Retoma el estado de la alarma consultando el historial del canal
 * (Punto 5, Fase 5). Se invoca en cada `connected`: si el último evento fue
 * un `activar_alarma` reciente (dentro de la duración configurada) la sirena se
 * arranca por el tiempo restante, cubriendo el hueco que deja el evento en vivo
 * que no se recibió mientras la página estaba desconectada/cerrada.
 */
async function recuperarEstadoActual(
  channel: Ably.RealtimeChannel,
  onEstadoCambia: (activa: boolean) => void,
): Promise<void> {
  try {
    const page = await channel.history({ limit: 1, direction: 'backwards' });
    const msg = page.items[0];
    if (!msg) return;
    if (msg.name !== 'activar_alarma') return;
    const { sirenId, timestamp, duracionSegundos } = msg.data as {
      sirenId?: string;
      timestamp?: number;
      duracionSegundos?: number;
    };
    if (!sirenId) return;
    if (typeof timestamp !== 'number') return;
    const duracion = typeof duracionSegundos === 'number' && duracionSegundos > 0 ? duracionSegundos : 90;
    const transcurridoSegundos = (Date.now() - timestamp) / 1000;
    // Si ya venció la duración configurada, descartar (sonido fantasma).
    if (transcurridoSegundos >= duracion) return;
    // Idempotencia: no reiniciar la sirena si la MISMA alarma ya está sonando.
    if (alarmaActivaSirenId === sirenId) return;
    const restanteMs = (duracion - transcurridoSegundos) * 1000;
    console.info(
      '[Ably] Estado actual recuperado del historial: alarma activa (%s), tiempo restante: %ss.',
      sirenId,
      Math.round(restanteMs / 1000),
    );
    limpiarTemporizadorAutoApagado();
    alarmaActivaSirenId = sirenId;
    startSiren();
    establecerLinterna(true);
    onEstadoCambia(true);
    temporizadorAutoApagado = setTimeout(() => {
      console.info(`[Ably] Auto-apagado cumplido tras reconexión (sirenId: ${sirenId}).`);
      alarmaActivaSirenId = null;
      temporizadorAutoApagado = null;
      stopSiren();
      establecerLinterna(false);
      onEstadoCambia(false);
    }, restanteMs);
  } catch (err) {
    // Fallo benigno: la escucha en vivo sigue funcionando aunque no se pueda
    // leer el historial (ej. key sin capability history o red caída).
    console.warn('[Ably] No se pudo recuperar el estado actual del canal:', err);
  }
}

/**
 * Inicia la escucha en tiempo real de la alarma vecinal.
 *
 * @param onEstadoCambia   Callback: (activa: boolean) — true al activar, false al desactivar.
 * @param onEstadoConexion Callback: (estado: EstadoConexionAbly) — para el indicador de conexión.
 */
export function iniciarEscuchaAlarma(
  onEstadoCambia: (activa: boolean) => void,
  onEstadoConexion: (estado: EstadoConexionAbly) => void,
): void {
  if (!ABLY_SUBSCRIBE_KEY) {
    console.warn('[Ably] VITE_ABLY_SUBSCRIBE_KEY no configurada — no se puede escuchar la alarma.');
    return;
  }

  const client = new Ably.Realtime({ key: ABLY_SUBSCRIBE_KEY });
  const channel = client.channels.get(ALARMA_CHANNEL_NAME);

  client.connection.on('connected', () => {
    console.info('[Ably] Conectado, esperando eventos de alarma.');
    onEstadoConexion('connected');
    recuperarEstadoActual(channel, onEstadoCambia);
  });
  client.connection.on('disconnected', () => {
    console.warn('[Ably] Desconectado, intentando reconectar...');
    onEstadoConexion('disconnected');
  });
  client.connection.on('connecting', () => {
    onEstadoConexion('connecting');
  });
  client.connection.on('suspended', () => {
    console.warn('[Ably] Conexión suspendida, reintentando...');
    onEstadoConexion('suspended');
  });

  channel.subscribe('activar_alarma', (msg) => {
    const { sirenId, duracionSegundos } = msg.data as { sirenId?: string; duracionSegundos?: number };
    if (!sirenId) return;
    // Idempotencia: si ya está sonando la MISMA alarma (mismo sirenId,
    // posible reenvío tras reconexión), no reiniciar el sonido desde cero.
    if (alarmaActivaSirenId === sirenId) return;
    limpiarTemporizadorAutoApagado();
    alarmaActivaSirenId = sirenId;
    startSiren();
    establecerLinterna(true);
    onEstadoCambia(true);

    const duracion = typeof duracionSegundos === 'number' && duracionSegundos > 0 ? duracionSegundos : 90;
    temporizadorAutoApagado = setTimeout(() => {
      console.info(`[Ably] Auto-apagado cumplido tras ${duracion}s (sirenId: ${sirenId}).`);
      alarmaActivaSirenId = null;
      temporizadorAutoApagado = null;
      stopSiren();
      establecerLinterna(false);
      onEstadoCambia(false);
    }, duracion * 1000);
  });

  channel.subscribe('desactivar_alarma', (msg) => {
    const { sirenId } = msg.data as { sirenId?: string };
    if (!sirenId) return;
    if (alarmaActivaSirenId !== sirenId) return; // evento de una sesión distinta/vieja, ignorar
    limpiarTemporizadorAutoApagado();
    alarmaActivaSirenId = null;
    stopSiren();
    establecerLinterna(false);
    onEstadoCambia(false);
  });

  // ---- Fase 6: voz en tiempo real (mismo canal, eventos de voz) ----
  // Página A publica los chunks de voz en el canal de la alarma con el evento
  // 'voz_chunk' (payload binario) y 'voz_fin' al soltar el botón. Aquí solo se
  // reproduce la voz; la sirena NUNCA se dispara por eventos de voz.
  channel.subscribe('voz_inicio', (msg) => {
    const { mimeType } = msg.data as { mimeType?: string };
    if (mimeType) setMimeTypeVoz(mimeType);
    // Nueva transmisión: limpiar SIEMPRE el estado previo. Si la transmisión
    // anterior terminó mal (chunk final que llegó después del 'voz_fin',
    // quedando un MediaSource "huérfano" con transmisionActiva=true), este
    // reset evita que la voz nueva se pierda en silencio.
    reiniciarColaVoz();
  });

  channel.subscribe('voz_chunk', (msg) => {
    const data = msg.data;
    if (data instanceof ArrayBuffer) {
      reproducirChunkVoz(data);
    } else if (ArrayBuffer.isView(data)) {
      // Algunos clientes entregan el binario como vista (Uint8Array/DataView).
      const view = data as ArrayBufferView;
      reproducirChunkVoz(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    } else {
      console.warn('[Voz] Chunk de voz en formato inesperado:', typeof data);
    }
  });

  channel.subscribe('voz_fin', () => {
    reiniciarColaVoz();
  });
}