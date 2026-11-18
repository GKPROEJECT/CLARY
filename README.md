# CLARY

Cliente de escritorio para Linux con autenticación Supabase, espacios de trabajo, canales, mensajes directos y grupales, perfiles con foto, archivos adjuntos y mensajes en tiempo real.

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. En SQL Editor, ejecuta `supabase/migrations/20261102000100_clary_collaboration.sql`. Crea las tablas, políticas RLS, buckets y funciones necesarias.
3. En Authentication, añade `clary://auth/callback` a la lista de Redirect URLs para que los enlaces de confirmación vuelvan a la aplicación.
4. Copia `.env.example` a `.env.local` y reemplaza los valores por la Project URL y la clave pública `anon` o `publishable` del proyecto:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-publica
```

5. Reinicia CLARY después de guardar `.env.local`.

Si ya ejecutaste la migración inicial antes del arreglo de creación de workspaces, ejecuta también el SQL de `supabase/fixes/20261102000200_workspace_insert_rls.sql` en Supabase SQL Editor. No hace falta volver a ejecutar toda la migración inicial.

Para actualizar un proyecto existente y habilitar canales de voz, ejecuta además `supabase/fixes/20261102000300_voice_channels.sql`. No vuelvas a ejecutar la migración inicial.

Para habilitar los ajustes de nombre y descripción de los canales, ejecuta también `supabase/migrations/20261117000100_channel_settings.sql` en el SQL Editor de Supabase. Esta migración mantiene los canales existentes y limita la edición a su creador.

Para perfiles con banner y borrado definitivo de cuenta, ejecuta `supabase/migrations/20261117000200_profile_banner.sql` en el SQL Editor. Después despliega la función de servidor con `supabase functions deploy delete-account`. La función requiere los secretos estándar `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`; la clave `service_role` solo se configura como secreto del proyecto y nunca en la aplicación.

Para iconos de espacios e invitaciones, ejecuta `supabase/migrations/20261117000300_workspace_invites.sql` en el SQL Editor. Los enlaces duran siete días, son de un solo uso y solo los puede aceptar una cuenta autenticada. Si publicas también la versión web, define `VITE_APP_URL` con la URL HTTPS de esa web para generar enlaces que abran la página de invitación en cualquier equipo; los enlaces creados desde Electron sin esa variable usan `clary://invite` y requieren que CLARY esté instalada.

Para estados compartidos de usuario, ejecuta `supabase/migrations/20261117000400_user_presence.sql`. Añade el estado y la última actividad al perfil y habilita sus actualizaciones por Realtime.

Para poder eliminar canales desde sus ajustes, ejecuta `supabase/migrations/20261117000500_delete_channels.sql`. Solo el creador del canal puede borrarlo; se eliminan también sus mensajes, membresías y archivos adjuntos.

Si configuras `VITE_APP_URL`, añade también esa URL (y su ruta de callback) a Authentication > URL Configuration > Redirect URLs en Supabase.

No uses la clave `service_role` en la app de escritorio. Las contraseñas las gestiona Supabase Auth; los datos y archivos están protegidos por políticas RLS.

## Desarrollo y paquetes

```bash
npm install
npm run dev:desktop
```

```bash
npm run build
npm run dist:linux
```

El paquete AppImage se genera en `release/`. Para añadir DEB harán falta la URL pública del proyecto y los datos reales del mantenedor.

## Funciones

- Registro, inicio y cierre de sesión con correo y contraseña de Supabase Auth.
- Opción «Recordar mi correo»: guarda solo la dirección de correo; nunca almacena la contraseña. Supabase gestiona la sesión persistente.
- Confirmación por correo mediante el enlace `clary://` de Electron.
- Creación de workspaces y canales; el propietario puede invitar cuentas existentes por `@usuario`.
- El creador de un canal puede editar su nombre y descripción desde el engranaje de la barra lateral; los cambios se actualizan para los miembros en tiempo real.
- Mensajes directos y grupos identificados por nombre de usuario.
- Mensajes sincronizados en tiempo real, con nombre, usuario, avatar y hora local.
- Borrado del propio mensaje con clic derecho; RLS también impide borrar mensajes de otras cuentas.
- Cambio de nombre, nombre de usuario y foto de perfil. Las imágenes de perfil tienen un límite de 5 MB.
- Adjuntos privados de hasta 25 MB, visibles solo para miembros de la sala.
- Canales de voz y llamadas directas WebRTC; Electron solicita acceso a micrófono y webcam solo en la ventana principal de CLARY.
- En voz y llamadas se puede cambiar micrófono, salida de audio y webcam, y activar o desactivar el vídeo durante la llamada.
- Las tarjetas de la llamada muestran un borde iluminado mientras su participante habla; la actividad se calcula localmente y no se graba.
- Aviso sonoro al enviar un mensaje o recibir uno nuevo de otra persona, timbre de llamada y sonido al colgar. El timbre se detiene al aceptar o rechazar, y la llamada saliente termina tras 30 segundos sin respuesta.
- Ajuste de idioma con español, inglés, francés, alemán, italiano, portugués, catalán, euskera, gallego y neerlandés; se guarda localmente y se aplica al instante.

La voz conecta a los participantes directamente con señalización privada de Supabase Realtime y STUN. Está orientada a grupos pequeños; algunas redes corporativas, VPN o NAT estrictos necesitan un servidor TURN para establecer la conexión. El audio no se guarda en Supabase. Si tu base ya tenía la migración inicial, aplica `supabase/fixes/20261102000300_voice_channels.sql` para habilitar el tipo de sala de voz y sus políticas privadas.

Para llamar directamente, ambas personas deben tener CLARY abierto y una conversación directa entre ellas. El aviso sonoro de mensajes necesita que la aplicación esté abierta y que el equipo tenga sonido habilitado.

Para enviar correos de confirmación a usuarios reales, configura un proveedor SMTP en Supabase Auth. Sin `.env.local` la app muestra la pantalla de configuración y no usa cuentas de demostración.