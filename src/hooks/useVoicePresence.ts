import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/claryData'

export type VoicePresenceMember = Pick<Profile, 'id' | 'username' | 'display_name' | 'avatar_path'>

export function useVoicePresence(roomIds: string[], userId: string | undefined, activeRoomId: string | null) {
  const [membersByRoom, setMembersByRoom] = useState<Record<string, VoicePresenceMember[]>>({})
  const roomKey = roomIds.filter((roomId) => roomId !== activeRoomId).join('|')

  useEffect(() => {
    const client = supabase
    if (!client || !userId || !roomKey) {
      return
    }

    const activeRooms = new Set(roomKey.split('|'))
    const channels = [...activeRooms].map((roomId) => {
      const channel = client.channel(`voice:${roomId}`, {
        config: { private: true, presence: { key: userId }, broadcast: { self: false } },
      })
      const refresh = () => {
        const state = channel.presenceState() as Record<string, Array<Partial<VoicePresenceMember> & { userId?: string; displayName?: string; avatarPath?: string | null }>>
        const members = Object.entries(state).flatMap(([presenceId, entries]) => {
          const entry = entries[0]
          if (!entry || presenceId === userId) return []
          return [{
            id: entry.id ?? entry.userId ?? presenceId,
            username: entry.username ?? 'usuario',
            display_name: entry.display_name ?? entry.displayName ?? 'Usuario',
            avatar_path: entry.avatar_path ?? entry.avatarPath ?? null,
          }]
        })
        setMembersByRoom((current) => ({ ...current, [roomId]: members }))
      }
      channel.on('presence', { event: 'sync' }, refresh)
      channel.on('presence', { event: 'join' }, refresh)
      channel.on('presence', { event: 'leave' }, refresh)
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh()
      })
      return channel
    })

    return () => {
      channels.forEach((channel) => { void client.removeChannel(channel) })
      setMembersByRoom((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !activeRooms.has(id))))
    }
  }, [roomKey, userId, activeRoomId])

  return membersByRoom
}