/**
 * Página B — Alarma Externa Barrio El Trigal.
 *
 * Punto de entrada: construye la UI mínima (estado de alarma, indicador de
 * conexión, botón de habilitación de audio y silencio local) y conecta la
 * escucha de Ably. El botón "Habilitar Alarma Externa" es OBLIGATORIO: sin
 * una interacción previa del usuario, el navegador bloquea el AudioContext
 * (políticas de autoplay) y la sirena fallaría en silencio en producción.
 */
import { iniciarEscuchaAlarma, type EstadoConexionAbly } from './ablySubscriber';
import { startSiren, stopSiren } from './audioSiren';
import { desbloquearAudioVoz } from './voicePlayer';

const STATUS_ALARMA = document.getElementById('estado-alarma') as HTMLDivElement;
const STATUS_CONEXION = document.getElementById('estado-conexion') as HTMLDivElement;
const BTN_HABILITAR = document.getElementById('btn-habilitar') as HTMLButtonElement;
const BTN_SILENCIAR = document.getElementById('btn-silenciar') as HTMLButtonElement;

let escuchaIniciada = false;
let silencioLocalActivo = false;

function actualizarEstadoAlarma(activa: boolean): void {
  STATUS_ALARMA.textContent = activa ? '🚨 ALARMA ACTIVA' : 'En espera';
  STATUS_ALARMA.classList.toggle('alarma-activa', activa);
  STATUS_ALARMA.classList.toggle('alarma-espera', !activa);
}

function actualizarEstadoConexion(estado: EstadoConexionAbly): void {
  const texto: Record<EstadoConexionAbly, string> = {
    connected: 'Conectado',
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    suspended: 'Suspenso',
  };
  STATUS_CONEXION.textContent = `Conexión: ${texto[estado]}`;
  STATUS_CONEXION.classList.toggle('conexion-ok', estado === 'connected');
  STATUS_CONEXION.classList.toggle('conexion-bad', estado !== 'connected');
}

/**
 * Desbloquea el AudioContext real dentro del gesto de usuario (click).
 * En lugar de crear un contexto descartable y separado (que Safari/iOS
 * desbloquea y descarta, sin garantizar el estado del AudioContext interno
 * de audioSiren.ts), se dispara brevemente la propia sirena: esto fuerza
 * que `audioCtx` (la instancia privada del módulo, la misma que se
 * reutilizará con el evento real de Ably) se cree y quede desbloqueada
 * dentro del gesto genuino de clic. Se detiene a los 50ms.
 */
function desbloquearAudio(): void {
  startSiren();
  desbloquearAudioVoz();
  setTimeout(() => {
    stopSiren();
  }, 50);
}

BTN_HABILITAR.addEventListener('click', () => {
  desbloquearAudio();
  BTN_HABILITAR.disabled = true;
  BTN_HABILITAR.textContent = 'Audio habilitado';
  BTN_SILENCIAR.disabled = false;
  if (!escuchaIniciada) {
    escuchaIniciada = true;
    iniciarEscuchaAlarma(actualizarEstadoAlarma, actualizarEstadoConexion);
  }
});

BTN_SILENCIAR.addEventListener('click', () => {
  silencioLocalActivo = !silencioLocalActivo;
  if (silencioLocalActivo) {
    stopSiren();
    BTN_SILENCIAR.textContent = 'Sonido local silenciado';
  } else {
    BTN_SILENCIAR.textContent = 'Silenciar sonido local';
  }
});