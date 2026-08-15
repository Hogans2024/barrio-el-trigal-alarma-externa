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
 */
import Ably from 'ably';
import { startSiren, stopSiren } from './audioSiren';

const ABLY_SUBSCRIBE_KEY = import.meta.env.VITE_ABLY_SUBSCRIBE_KEY as string | undefined;
const ALARMA_CHANNEL_NAME = 'barrio-trigal:alarma';

/** Estado de conexión expuesto a la UI (conjunto reducido que usa main.ts). */
export type EstadoConexionAbly = 'connected' | 'disconnected' | 'connecting' | 'suspended';

let alarmaActivaSirenId: string | null = null;

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
}