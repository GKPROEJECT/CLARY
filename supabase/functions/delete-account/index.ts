import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, 'Método no permitido.')

  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !url || !anonKey || !serviceRoleKey) return jsonResponse(401, 'No se pudo validar la sesión.')

  const sessionClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) return jsonResponse(401, 'La sesión ya no es válida.')

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: messages, error: messagesError } = await admin.from('room_messages')
    .select('id,content,attachment_path').eq('author_id', user.id)
  if (messagesError) return jsonResponse(500, 'No se pudieron preparar los datos de la cuenta.')

  const avatarPaths = await listFiles(admin, 'avatars', user.id)
  if (!avatarPaths) return jsonResponse(500, 'No se pudieron preparar los archivos del perfil.')
  const messagePaths = (messages ?? []).flatMap((message) => message.attachment_path ? [message.attachment_path] : [])
  if (avatarPaths.length) {
    const { error: fileError } = await admin.storage.from('avatars').remove(avatarPaths)
    if (fileError) return jsonResponse(500, 'No se pudieron eliminar las imágenes del perfil.')
  }
  if (messagePaths.length) {
    const { error: attachmentError } = await admin.storage.from('chat-files').remove(messagePaths)
    if (attachmentError) return jsonResponse(500, 'No se pudieron eliminar los archivos adjuntos.')
  }

  const authoredMessages = messages ?? []
  for (const message of authoredMessages) {
    const update = {
      author_id: null,
      attachment_path: null,
      attachment_name: null,
      attachment_mime: null,
      attachment_size: null,
      ...(message.content ? {} : { deleted_at: new Date().toISOString() }),
    }
    const { error } = await admin.from('room_messages').update(update).eq('id', message.id)
    if (error) return jsonResponse(500, 'No se pudieron anonimizar los mensajes de la cuenta.')
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return jsonResponse(500, 'Supabase no pudo eliminar la cuenta.')
  return jsonResponse(200, 'La cuenta y sus archivos se han eliminado.')
})

async function listFiles(client: ReturnType<typeof createClient>, bucket: string, prefix: string): Promise<string[] | null> {
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) return null
  const files: string[] = []
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`
    if (entry.id) files.push(path)
    else {
      const nested = await listFiles(client, bucket, path)
      if (!nested) return null
      files.push(...nested)
    }
  }
  return files
}