import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Profile = {
  id: string
  username: string
  display_name: string
  avatar_path: string | null
  banner_path: string | null
  created_at: string
  presence_status: 'online' | 'away' | 'busy' | 'offline'
  last_seen_at: string | null
}

export type WorkspaceMember = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_path' | 'presence_status' | 'last_seen_at'>

export function resolvedPresenceStatus(member: Pick<WorkspaceMember, 'presence_status' | 'last_seen_at'>, now = Date.now()): Profile['presence_status'] {
  if (member.presence_status !== 'offline' && member.last_seen_at && now - new Date(member.last_seen_at).getTime() > 2 * 60 * 1000) return 'offline'
  return member.presence_status
}

export type Channel = { id: string; name: string; purpose: string; created_by: string | null }
export type Workspace = { id: string; name: string; initials: string; color: string; icon_path: string | null; channels: Channel[]; voiceChannels: Channel[] }
export type Conversation = {
  id: string
  title: string
  kind: 'direct' | 'group'
  purpose: string
  color: string
  profile?: Profile
}
export type ChatMessage = {
  id: string
  author_id: string | null
  author: Profile
  content: string
  created_at: string
  attachment_path: string | null
  attachment_name: string | null
  attachment_mime: string | null
  attachment_url: string | null
  deleted_at: string | null
}

type RoomRow = {
  id: string
  name: string
  created_by: string | null
  kind: 'channel' | 'voice' | 'direct' | 'group'
  purpose: string | null
  created_at: string
  room_members?: Array<{ user_id: string; profile: Profile | null }>
}

const workspaceColors = ['#742cf1', '#18c4ed', '#c647e8', '#2154ed', '#8b73ee']
let profileBannerSupported: boolean | null = null
let workspaceIconSupported: boolean | null = null
let profilePresenceSupported: boolean | null = null

function client() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

function missingBannerColumn(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42703' && 'message' in error && String(error.message).includes('banner_path'))
}

function missingPresenceColumn(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && ['42703', 'PGRST204'].includes(String(error.code)) && 'message' in error && String(error.message).includes('presence_status'))
}

function initials(value: string) {
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export async function fetchProfile(userId: string): Promise<Profile> {
  const db = client()
  let includeBanner = profileBannerSupported !== false
  let includePresence = profilePresenceSupported !== false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fields = ['id', 'username', 'display_name', 'avatar_path', ...(includeBanner ? ['banner_path'] : []), 'created_at', ...(includePresence ? ['presence_status', 'last_seen_at'] : [])].join(',')
    const result = await db.from('profiles').select(fields).eq('id', userId).single()
    if (!result.error) {
      const row = result.data as unknown as Record<string, unknown>
      return { ...row, banner_path: includeBanner ? row.banner_path : null, presence_status: includePresence ? row.presence_status : 'offline', last_seen_at: includePresence ? row.last_seen_at : null } as Profile
    }
    if (includeBanner && missingBannerColumn(result.error)) { includeBanner = false; profileBannerSupported = false; continue }
    if (includePresence && missingPresenceColumn(result.error)) { includePresence = false; profilePresenceSupported = false; continue }
    throw result.error
  }
  throw new Error('No se pudo cargar el perfil.')
}

export async function updateProfile(userId: string, changes: Partial<Pick<Profile, 'username' | 'display_name' | 'avatar_path' | 'banner_path'>>) {
  const db = client()
  let includeBanner = profileBannerSupported !== false
  let includePresence = profilePresenceSupported !== false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fields = ['id', 'username', 'display_name', 'avatar_path', ...(includeBanner ? ['banner_path'] : []), 'created_at', ...(includePresence ? ['presence_status', 'last_seen_at'] : [])].join(',')
    const result = await db.from('profiles').update(changes).eq('id', userId).select(fields).single()
    if (!result.error) {
      const row = result.data as unknown as Record<string, unknown>
      return { ...row, banner_path: includeBanner ? row.banner_path : null, presence_status: includePresence ? row.presence_status : 'offline', last_seen_at: includePresence ? row.last_seen_at : null } as Profile
    }
    if (includeBanner && missingBannerColumn(result.error)) {
      includeBanner = false; profileBannerSupported = false
      if ('banner_path' in changes) throw new Error('Ejecuta la migración 20261117000200_profile_banner.sql para habilitar el banner y eliminar la cuenta.')
      continue
    }
    if (includePresence && missingPresenceColumn(result.error)) { includePresence = false; profilePresenceSupported = false; continue }
    throw result.error
  }
  throw new Error('No se pudo actualizar el perfil.')
}

export async function fetchWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const db = client()
  let includePresence = profilePresenceSupported !== false
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const fields = `profile:profiles!workspace_members_user_id_fkey(id,username,display_name,avatar_path${includePresence ? ',presence_status,last_seen_at' : ''})`
    const { data, error } = await db.from('workspace_members').select(fields).eq('workspace_id', workspaceId)
    if (error) {
      if (includePresence && missingPresenceColumn(error)) { includePresence = false; profilePresenceSupported = false; continue }
      throw error
    }
    const rows = (data ?? []) as unknown as Array<{ profile: Omit<WorkspaceMember, 'presence_status' | 'last_seen_at'> & Partial<Pick<WorkspaceMember, 'presence_status' | 'last_seen_at'>> | null }>
    return rows.flatMap(({ profile }) => profile ? [{ ...profile, presence_status: resolvedPresenceStatus({ presence_status: profile.presence_status ?? 'offline', last_seen_at: profile.last_seen_at ?? null }), last_seen_at: profile.last_seen_at ?? null }] : [])
  }
  return []
}

export async function updateOwnPresence(userId: string, status: Profile['presence_status']) {
  const { error } = await client().from('profiles').update({
    presence_status: status,
    last_seen_at: new Date().toISOString(),
  }).eq('id', userId)
  if (error) {
    if (missingPresenceColumn(error)) {
      profilePresenceSupported = false
      throw new Error("Supabase aún no reconoce presence_status. En SQL Editor ejecuta NOTIFY pgrst, 'reload schema'; y vuelve a cargar CLARY.")
    }
    throw error
  }
  profilePresenceSupported = true
}

export function avatarUrl(path: string | null | undefined) {
  if (!path) return null
  return client().storage.from('avatars').getPublicUrl(path).data.publicUrl
}

export async function uploadAvatar(userId: string, file: File) {
  const path = `${userId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const { error } = await client().storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

export async function removeAvatar(path: string) {
  const { error } = await client().storage.from('avatars').remove([path])
  if (error) throw error
}

export async function fetchSidebar(userId: string) {
  const db = client()
  const iconColumn = workspaceIconSupported === false ? '' : ',icon_path'
  const workspaceQuery = await db
    .from('workspace_members')
    .select(`workspace:workspaces(id,name${iconColumn},rooms(id,name,kind,purpose,created_at,created_by))`)
    .eq('user_id', userId)
  let memberships = workspaceQuery.data
  let usedLegacyWorkspaceQuery = false
  if (workspaceQuery.error && workspaceIconSupported !== false) {
    const error = workspaceQuery.error
    if (error.code !== '42703' || !error.message.includes('icon_path')) throw error
    workspaceIconSupported = false
    usedLegacyWorkspaceQuery = true
    const legacy = await db.from('workspace_members')
      .select('workspace:workspaces(id,name,rooms(id,name,kind,purpose,created_at,created_by))')
      .eq('user_id', userId)
    if (legacy.error) throw legacy.error
    memberships = legacy.data as typeof memberships
  }
  if (workspaceQuery.error && !usedLegacyWorkspaceQuery) throw workspaceQuery.error

  const workspaceRows = (memberships ?? []) as unknown as Array<{
    workspace: { id: string; name: string; icon_path?: string | null; rooms: RoomRow[] } | null
  }>
  const workspaces: Workspace[] = workspaceRows.flatMap((row, index) => {
    if (!row.workspace) return []
    const workspaceRooms = row.workspace.rooms ?? []
    const mapRoom = (room: RoomRow): Channel => ({
      id: room.id,
      name: room.name,
      created_by: room.created_by,
      purpose: room.purpose ?? '',
    })
    return [{
      id: row.workspace.id,
      name: row.workspace.name,
      initials: initials(row.workspace.name),
      color: workspaceColors[index % workspaceColors.length],
      icon_path: row.workspace.icon_path ?? null,
      channels: workspaceRooms.filter((room) => room.kind === 'channel').map(mapRoom),
      voiceChannels: workspaceRooms.filter((room) => room.kind === 'voice').map(mapRoom),
    }]
  })

  const memberProfileFields = profileBannerSupported === false
    ? `id,username,display_name,avatar_path,created_at${profilePresenceSupported === false ? '' : ',presence_status,last_seen_at'}`
    : `id,username,display_name,avatar_path,banner_path,created_at${profilePresenceSupported === false ? '' : ',presence_status,last_seen_at'}`
  let roomQuery = await db
    .from('room_members')
    .select(`room:rooms!inner(id,name,kind,purpose,created_at,room_members(user_id,profile:profiles(${memberProfileFields})))`)
    .eq('user_id', userId)
  if (missingBannerColumn(roomQuery.error) || missingPresenceColumn(roomQuery.error)) {
    if (missingBannerColumn(roomQuery.error)) profileBannerSupported = false
    if (missingPresenceColumn(roomQuery.error)) profilePresenceSupported = false
    const fallbackProfileFields = `id,username,display_name,avatar_path${profileBannerSupported === false ? '' : ',banner_path'},created_at${profilePresenceSupported === false ? '' : ',presence_status,last_seen_at'}`
    roomQuery = await db.from('room_members')
      .select(`room:rooms!inner(id,name,kind,purpose,created_at,room_members(user_id,profile:profiles(${fallbackProfileFields})))`)
      .eq('user_id', userId)
  }
  if (roomQuery.error) throw roomQuery.error
  const roomMemberships = roomQuery.data

  const roomRows = (roomMemberships ?? []) as unknown as Array<{ room: RoomRow | null }>
  const conversations = new Map<string, Conversation>()
  for (const { room } of roomRows) {
    if (!room || room.kind === 'channel' || room.kind === 'voice' || conversations.has(room.id)) continue
    const otherMember = room.room_members?.find((member) => member.user_id !== userId)
    const profile = otherMember?.profile ?? undefined
    conversations.set(room.id, {
      id: room.id,
      title: room.kind === 'group' ? room.name : profile?.display_name ?? 'Conversación directa',
      kind: room.kind,
      purpose: room.kind === 'group' ? 'Conversación grupal' : profile ? `@${profile.username}` : 'Conversación directa',
      color: workspaceColors[conversations.size % workspaceColors.length],
      profile,
    })
  }

  return { workspaces, conversations: [...conversations.values()] }
}

export async function fetchMessages(roomId: string): Promise<ChatMessage[]> {
  const db = client()
  const messageProfileFields = profileBannerSupported === false
    ? `id,username,display_name,avatar_path,created_at${profilePresenceSupported === false ? '' : ',presence_status,last_seen_at'}`
    : `id,username,display_name,avatar_path,banner_path,created_at${profilePresenceSupported === false ? '' : ',presence_status,last_seen_at'}`
  let result = await db
    .from('room_messages')
    .select(`id,room_id,author_id,content,created_at,deleted_at,attachment_path,attachment_name,attachment_mime,author:profiles!room_messages_author_id_fkey(${messageProfileFields})`)
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
  let messageRows = result.data
  if (missingBannerColumn(result.error) || missingPresenceColumn(result.error)) {
    if (missingBannerColumn(result.error)) profileBannerSupported = false
    if (missingPresenceColumn(result.error)) profilePresenceSupported = false
    const fallbackProfileFields = `id,username,display_name,avatar_path${profileBannerSupported === false ? '' : ',banner_path'},created_at${profilePresenceSupported === false ? '' : ',presence_status,last_seen_at'}`
    const legacy = await db.from('room_messages')
      .select(`id,room_id,author_id,content,created_at,deleted_at,attachment_path,attachment_name,attachment_mime,author:profiles!room_messages_author_id_fkey(${fallbackProfileFields})`)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
    if (legacy.error) throw legacy.error
    messageRows = legacy.data as typeof result.data
  }
  if (result.error && !missingBannerColumn(result.error) && !missingPresenceColumn(result.error)) throw result.error

  const rows = (messageRows ?? []) as unknown as Array<Omit<ChatMessage, 'attachment_url'> & { author: Profile | null }>
  return Promise.all(rows.map(async (row) => {
    let attachmentUrl: string | null = null
    if (row.attachment_path) {
      const { data: signed } = await client().storage.from('chat-files').createSignedUrl(row.attachment_path, 3600)
      attachmentUrl = signed?.signedUrl ?? null
    }
    return { ...row, author: row.author ? { ...row.author, banner_path: row.author.banner_path ?? null, presence_status: resolvedPresenceStatus({ presence_status: row.author.presence_status ?? 'offline', last_seen_at: row.author.last_seen_at ?? null }), last_seen_at: row.author.last_seen_at ?? null } : { id: row.author_id ?? `deleted-${row.id}`, username: 'usuario', display_name: 'Usuario eliminado', avatar_path: null, banner_path: null, created_at: '', presence_status: 'offline', last_seen_at: null }, attachment_url: attachmentUrl }
  }))
}

export async function createWorkspace(name: string) {
  const { data, error } = await client().rpc('create_workspace', { workspace_name: name })
  if (error) throw error
  return data as string
}

export async function updateWorkspace(workspaceId: string, name: string, iconPath?: string | null) {
  const db = client()
  if (iconPath === undefined) {
    const result = await db.from('workspaces').update({ name }).eq('id', workspaceId).select('id,name').single()
    if (result.error) throw result.error
    return { ...result.data, icon_path: null } as { id: string; name: string; icon_path: string | null }
  }
  if (workspaceIconSupported === false) throw new Error('Aplica la migración 20261117000300_workspace_invites.sql para cambiar el icono del espacio.')
  const result = await db.from('workspaces').update({ name, icon_path: iconPath }).eq('id', workspaceId).select('id,name,icon_path').single()
  if (result.error) {
    if (result.error.code === '42703' && result.error.message.includes('icon_path')) {
      workspaceIconSupported = false
      throw new Error('Aplica la migración 20261117000300_workspace_invites.sql para cambiar el icono del espacio.')
    }
    throw result.error
  }
  workspaceIconSupported = true
  return result.data as { id: string; name: string; icon_path: string | null }
}

export async function createWorkspaceInvite(workspaceId: string) {
  const randomToken = new Uint8Array(32)
  crypto.getRandomValues(randomToken)
  const token = [...randomToken].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const { data, error } = await client().rpc('create_workspace_invite', {
    target_workspace_id: workspaceId,
    target_token_hash: tokenHash,
  })
  if (error) throw error
  const appUrl = import.meta.env.VITE_APP_URL?.trim()
  const url = appUrl ? new URL(appUrl) : new URL(window.location.href)
  if (appUrl || url.protocol === 'http:' || url.protocol === 'https:') {
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set('invite', token)
    return { link: url.toString(), expiresAt: data as string }
  }
  return { link: `clary://invite?token=${token}`, expiresAt: data as string }
}

export async function acceptWorkspaceInvite(token: string) {
  const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const { data, error } = await client().rpc('accept_workspace_invite', { target_token_hash: tokenHash })
  if (error) throw error
  return data as string
}

export async function addWorkspaceMember(workspaceId: string, username: string) {
  const { error } = await client().rpc('add_workspace_member', {
    target_workspace_id: workspaceId,
    target_username: username.trim().replace(/^@/, '').toLowerCase(),
  })
  if (error) throw error
}

export async function createChannel(workspaceId: string, name: string, userId: string) {
  const { data, error } = await client().from('rooms').insert({
    workspace_id: workspaceId, name, kind: 'channel', created_by: userId,
  }).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function createVoiceChannel(workspaceId: string, name: string, userId: string) {
  const { data, error } = await client().from('rooms').insert({
    workspace_id: workspaceId, name, kind: 'voice', created_by: userId,
  }).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function updateChannel(channelId: string, name: string, purpose: string) {
  const { data, error } = await client().from('rooms')
    .update({ name, purpose: purpose || null })
    .eq('id', channelId)
    .select('id,name,purpose,created_by')
    .single()
  if (error) throw error
  return data as { id: string; name: string; purpose: string | null; created_by: string }
}

export async function deleteChannel(channelId: string) {
  const db = client()
  const { data: messages, error: messagesError } = await db.from('room_messages')
    .select('attachment_path')
    .eq('room_id', channelId)
    .not('attachment_path', 'is', null)
  if (messagesError) throw messagesError
  const attachmentPaths = [...new Set((messages ?? []).flatMap((message) => message.attachment_path ? [message.attachment_path] : []))]
  if (attachmentPaths.length) {
    const { error: storageError } = await db.storage.from('chat-files').remove(attachmentPaths)
    if (storageError) throw storageError
  }
  const { error } = await db.rpc('delete_workspace_channel', { target_room_id: channelId })
  if (error) throw error
}

export function subscribeToChannelChanges(onChange: () => void): RealtimeChannel {
  return client().channel('clary-channel-updates')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms' }, onChange)
    .subscribe()
}

export async function createDirect(username: string) {
  const normalizedUsername = username.trim().replace(/^@/, '').toLowerCase()
  const { data: profile, error: profileError } = await client().from('profiles').select('id').eq('username', normalizedUsername).single()
  if (profileError) throw profileError
  const { data, error } = await client().rpc('create_direct_room', { other_user_id: profile.id })
  if (error) throw error
  return data as string
}

export async function createGroup(name: string, usernames: string[]) {
  const members = [...new Set(usernames.map((username) => username.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))]
  const { data, error } = await client().rpc('create_group_room', { group_name: name, member_usernames: members })
  if (error) throw error
  return data as string
}

export async function sendMessage(roomId: string, authorId: string, content: string) {
  const { error } = await client().from('room_messages').insert({ room_id: roomId, author_id: authorId, content })
  if (error) throw error
}

export async function uploadMessageFile(roomId: string, authorId: string, file: File, content: string) {
  const path = `${roomId}/${authorId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
  const db = client()
  const { error: uploadError } = await db.storage.from('chat-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadError) throw uploadError

  const { error: messageError } = await db.from('room_messages').insert({
    room_id: roomId,
    author_id: authorId,
    content,
    attachment_path: path,
    attachment_name: file.name,
    attachment_mime: file.type || 'application/octet-stream',
    attachment_size: file.size,
  })
  if (messageError) {
    await db.storage.from('chat-files').remove([path])
    throw messageError
  }
}

export async function deleteMessage(messageId: string, attachmentPath: string | null) {
  const db = client()
  const { error } = await db.from('room_messages').update({
    deleted_at: new Date().toISOString(),
    content: '',
    attachment_path: null,
    attachment_name: null,
    attachment_mime: null,
    attachment_size: null,
  }).eq('id', messageId).is('deleted_at', null)
  if (error) throw error
  if (attachmentPath) {
    const { error: fileError } = await db.storage.from('chat-files').remove([attachmentPath])
    if (fileError) console.error('No se pudo eliminar el archivo adjunto:', fileError.message)
  }
}

export function subscribeToRoom(roomId: string, onChange: () => void): RealtimeChannel {
  return client().channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` }, onChange)
    .subscribe()
}

export function subscribeToNewMessages(onMessage: (authorId: string, roomId: string) => void): RealtimeChannel {
  return client().channel('clary-message-notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages' }, (event) => {
      const authorId = event.new.author_id
      const roomId = event.new.room_id
      if (typeof authorId === 'string' && typeof roomId === 'string') onMessage(authorId, roomId)
    })
    .subscribe()
}

export function subscribeToProfiles(onChange: () => void, topic = 'profile-updates'): RealtimeChannel {
  return client().channel(topic)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, onChange)
    .subscribe()
}

export function unsubscribeFromRoom(channel: RealtimeChannel) {
  return client().removeChannel(channel)
}

function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'archivo'
}