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
import { stopSiren } from './audioSiren';

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
 * Desbloquea el AudioContext dentro del gesto de usuario (click). Crea y
 * resuelve un contexto una sola vez; cualquier audio posterior (sirena,
 * chunks de voz) podrá reproducirse sin restricciones de autoplay.
 */
function desbloquearAudio(): void {
  const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const ctx = new AudioContextClass();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  // Se deja vivo el contexto para que la sirena lo reutilice sin volver a
  // suspenderse; si el navegador lo suspende solo, startSiren() lo reanuda.
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