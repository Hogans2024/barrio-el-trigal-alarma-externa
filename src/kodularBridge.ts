/**
 * Puente hacia la app Android (Kodular) cuando esta página corre dentro
 * de un componente Web Viewer. Fuera de ese contexto (navegador normal,
 * o cuando se prueba la página fuera de la .apk), window.Kodular no
 * existe y esta función simplemente no hace nada — no rompe la app.
 *
 * El texto exacto "ALARM_ON" / "ALARM_OFF" es leído del lado de Kodular
 * en el evento WebViewer1.WebViewStringChange (ver el plan de bloques
 * de Kodular en el documento del plan completo).
 */
export function establecerLinterna(activa: boolean): void {
  const kodular = (window as any).Kodular;
  if (kodular && typeof kodular.setWebViewString === 'function') {
    kodular.setWebViewString(activa ? 'ALARM_ON' : 'ALARM_OFF');
  }
}
