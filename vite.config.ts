import { defineConfig } from 'vite';

// Configuración para GitHub Pages: el sitio vive bajo la ruta del repo,
// no en la raíz del dominio. Sin esto, los assets se resolverían mal.
export default defineConfig({
  base: '/barrio-el-trigal-alarma-externa/',
});