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
import { reproducirChunkVoz, reiniciarColaVoz } from './voicePlayer';

const ABLY_SUBSCRIBE_KEY = import.meta.env.VITE_ABLY_SUBSCRIBE_KEY as string | undefined;
const ALARMA_CHANNEL_NAME = 'barrio-trigal:alarma';

/**
 * Ventana de frescura para retomar estado desde el historial (Punto 5, Fase 5).
 *
 * La alarma en Página A se auto-desactiva a los 90 segundos
 * (AUTO_DEACTIVATE_SECONDS = 90 en ActiveAlarmModal.tsx). Si al reconectar el
 * último evento del canal es un `activar_alarma` más reciente que esta ventana,
 * la alarma seguía activa del lado de Página A y se retoma la sirena. Un evento
 * más viejo se descarta para evitar "sonido fantasma" (ej. reabrir la página
 * mucho después de que la alarma ya terminó y el desactivar no llegó a publicarse).
 */
const MAX_EDAD_ALARMA_MS = 120_000;

/** Estado de conexión expuesto a la UI (conjunto reducido que usa main.ts). */
export type EstadoConexionAbly = 'connected' | 'disconnected' | 'connecting' | 'suspended';

let alarmaActivaSirenId: string | null = null;

/**
 * Retoma el estado de la alarma consultando el historial del canal
 * (Punto 5, Fase 5). Se invoca en cada `connected`: si el último evento fue
 * un `activar_alarma` reciente (dentro de MAX_EDAD_ALARMA_MS) la sirena se
 * arranca, cubriendo el hueco que deja el evento en vivo que no se recibió
 * mientras la página estaba desconectada/cerrada.
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
    const { sirenId, timestamp } = msg.data as { sirenId?: string; timestamp?: number };
    if (!sirenId) return;
    if (typeof timestamp !== 'number') return;
    // Filtro por frescura: descartar eventos demasiado viejos (sonido fantasma).
    if (Date.now() - timestamp > MAX_EDAD_ALARMA_MS) return;
    // Idempotencia: no reiniciar la sirena si la MISMA alarma ya está sonando.
    if (alarmaActivaSirenId === sirenId) return;
    console.info('[Ably] Estado actual recuperado del historial: alarma activa (%s).', sirenId);
    alarmaActivaSirenId = sirenId;
    startSiren();
    onEstadoCambia(true);
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
    const { sirenId } = msg.data as { sirenId?: string };
    if (!sirenId) return;
    // Idempotencia: si ya está sonando la MISMA alarma (mismo sirenId,
    // posible reenvío tras reconexión), no reiniciar el sonido desde cero.
    if (alarmaActivaSirenId === sirenId) return;
    alarmaActivaSirenId = sirenId;
    startSiren();
    onEstadoCambia(true);
  });

  channel.subscribe('desactivar_alarma', (msg) => {
    const { sirenId } = msg.data as { sirenId?: string };
    if (!sirenId) return;
    if (alarmaActivaSirenId !== sirenId) return; // evento de una sesión distinta/vieja, ignorar
    alarmaActivaSirenId = null;
    stopSiren();
    onEstadoCambia(false);
  });

  // ---- Fase 6: voz en tiempo real (mismo canal, eventos de voz) ----
  // Página A publica los chunks de voz en el canal de la alarma con el evento
  // 'voz_chunk' (payload binario) y 'voz_fin' al soltar el botón. Aquí solo se
  // reproduce la voz; la sirena NUNCA se dispara por eventos de voz.
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