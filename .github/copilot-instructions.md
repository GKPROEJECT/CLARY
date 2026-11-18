# Instrucciones del proyecto CLARY

- CLARY es una aplicación de escritorio Linux basada en Electron, Vite, React y TypeScript.
- Mantén la interfaz y el contenido visible en español.
- El proceso principal está en `electron/main.cjs`; el preload debe exponer solo APIs pequeñas y necesarias.
- Conserva `contextIsolation` y `sandbox` activados, y `nodeIntegration` desactivado.
- La autenticación actual es una demo local. No guardes contraseñas ni la presentes como autenticación de producción.
- Usa `npm run dev:desktop` para desarrollo, `npm run build` para validar y `npm run dist:linux` para generar paquetes Linux.