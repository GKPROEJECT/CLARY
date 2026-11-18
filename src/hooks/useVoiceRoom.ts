import { startTransition, useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/claryData'

export type VoiceParticipant = {
  id: string
  displayName: string
  username: string
  avatarPath: string | null
  stream?: MediaStream
}

export type VoiceDevice = {
  id: string
  label: string
}

type SignalMessage = {
  from: string
  to: string
  kind: 'offer' | 'answer' | 'ice'
  description?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

const MAX_PEERS = 7

export function useVoiceRoom(
  roomId: string | null,
  enabled: boolean,
  userId: string | undefined,
  profile: Profile | null,
  initialAudioDeviceId = '',
  initialCameraDeviceId = '',
) {
  const [participants, setParticipants] = useState<VoiceParticipant[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [error, setError] = useState('')
  const streamRef = useRef<MediaStream | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const peerConnections = useRef(new Map<string, RTCPeerConnection>())
  const audioSenders = useRef(new Map<string, RTCRtpSender>())
  const videoSenders = useRef(new Map<string, RTCRtpSender>())
  const pendingCandidates = useRef(new Map<string, RTCIceCandidateInit[]>())
  const mutedRef = useRef(false)
  const cameraEnabledRef = useRef(false)
  const audioDeviceIdRef = useRef(initialAudioDeviceId)
  const cameraDeviceIdRef = useRef(initialCameraDeviceId)

  const displayName = profile?.display_name ?? 'CLARY'
  const username = profile?.username ?? 'usuario'
  const avatarPath = profile?.avatar_path ?? null

  useEffect(() => {
    if (!enabled || !roomId || !userId || !supabase) return
    const supabaseClient = supabase
    let cancelled = false
    const connections = peerConnections.current
    const activeAudioSenders = audioSenders.current
    const activeVideoSenders = videoSenders.current
    const candidates = pendingCandidates.current
    startTransition(() => { setConnecting(true); setError('') })

    const sendSignal = (to: string, signal: Omit<SignalMessage, 'from' | 'to'>) => {
      const channel = channelRef.current
      if (!channel) return
      void channel.send({ type: 'broadcast', event: 'voice-signal', payload: { ...signal, from: userId, to } })
    }

    const createPeer = (peerId: string, initiator: boolean) => {
      const existing = connections.get(peerId)
      if (existing) return existing
      const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      if (initiator) {
        const audioTransceiver = peer.addTransceiver('audio', { direction: 'sendrecv' })
        const videoTransceiver = peer.addTransceiver('video', { direction: 'sendrecv' })
        const audioTrack = streamRef.current?.getAudioTracks()[0]
        const videoTrack = streamRef.current?.getVideoTracks()[0]
        if (audioTrack) void audioTransceiver.sender.replaceTrack(audioTrack)
        if (videoTrack) void videoTransceiver.sender.replaceTrack(videoTrack)
        activeAudioSenders.set(peerId, audioTransceiver.sender)
        activeVideoSenders.set(peerId, videoTransceiver.sender)
      }
      peer.onicecandidate = (event) => {
        if (event.candidate) sendSignal(peerId, { kind: 'ice', candidate: event.candidate.toJSON() })
      }
      peer.ontrack = (event) => {
        const signaledStream = event.streams[0]
        const presence = channelRef.current?.presenceState()[peerId]?.[0] as Partial<VoiceParticipant> | undefined
        setParticipants((current) => {
          const person = current.find((participant) => participant.id === peerId)
          const tracks = new Map<string, MediaStreamTrack>()
          for (const track of [...(person?.stream?.getTracks() ?? []), ...(signaledStream?.getTracks() ?? []), event.track]) {
            if (track.readyState !== 'ended') tracks.set(track.id, track)
          }
          const remoteStream = new MediaStream([...tracks.values()])
          return [
            ...current.filter((participant) => participant.id !== peerId),
            {
              id: peerId,
              displayName: presence?.displayName ?? person?.displayName ?? 'CLARY',
              username: presence?.username ?? person?.username ?? 'usuario',
              avatarPath: presence?.avatarPath ?? person?.avatarPath ?? null,
              stream: remoteStream,
            },
          ]
        })
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          peer.close()
          connections.delete(peerId)
          activeAudioSenders.delete(peerId)
          activeVideoSenders.delete(peerId)
          setParticipants((current) => current.filter((participant) => participant.id !== peerId))
        }
      }
      connections.set(peerId, peer)
      return peer
    }

    const syncPresence = async () => {
      const channel = channelRef.current
      if (!channel) return
      const state = channel.presenceState() as Record<string, Array<Partial<VoiceParticipant>>>
      const memberIds = Object.keys(state).filter((id) => id !== userId)
      const presentIds = new Set(memberIds)
      for (const [peerId, peer] of connections) {
        if (!presentIds.has(peerId)) {
          peer.close()
          connections.delete(peerId)
          activeAudioSenders.delete(peerId)
          activeVideoSenders.delete(peerId)
          candidates.delete(peerId)
        }
      }
      setParticipants((current) => {
        const currentById = new Map(current.map((participant) => [participant.id, participant]))
        const next = memberIds.map((id) => {
          const person = state[id]?.[0]
          const previous = currentById.get(id)
          return {
            id,
            displayName: person?.displayName ?? previous?.displayName ?? 'CLARY',
            username: person?.username ?? previous?.username ?? 'usuario',
            avatarPath: person?.avatarPath ?? previous?.avatarPath ?? null,
            stream: previous?.stream,
          }
        })
        return next
      })
      if (memberIds.length > MAX_PEERS) {
        setError('connectionError')
        return
      }
      for (const peerId of memberIds) {
        if (userId.localeCompare(peerId) < 0 && !connections.has(peerId)) {
          const peer = createPeer(peerId, true)
          const offer = await peer.createOffer()
          await peer.setLocalDescription(offer)
          sendSignal(peerId, { kind: 'offer', description: offer })
        }
      }
    }

    const handleSignal = async (signal: SignalMessage) => {
      if (signal.to !== userId || signal.from === userId) return
      try {
        if (signal.kind === 'ice' && signal.candidate && !connections.get(signal.from)?.remoteDescription) {
          candidates.set(signal.from, [...(candidates.get(signal.from) ?? []), signal.candidate])
          return
        }
        const peer = createPeer(signal.from, false)
        if (signal.kind === 'offer' && signal.description) {
          await peer.setRemoteDescription(signal.description)
          for (const transceiver of peer.getTransceivers()) {
            const kind = transceiver.receiver.track.kind
            const track = kind === 'audio' ? streamRef.current?.getAudioTracks()[0] : streamRef.current?.getVideoTracks()[0]
            transceiver.direction = 'sendrecv'
            if (track) await transceiver.sender.replaceTrack(track)
            if (kind === 'audio') activeAudioSenders.set(signal.from, transceiver.sender)
            if (kind === 'video') activeVideoSenders.set(signal.from, transceiver.sender)
          }
          for (const candidate of candidates.get(signal.from) ?? []) await peer.addIceCandidate(candidate)
          candidates.delete(signal.from)
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          sendSignal(signal.from, { kind: 'answer', description: answer })
        } else if (signal.kind === 'answer' && signal.description && !peer.remoteDescription) {
          await peer.setRemoteDescription(signal.description)
          for (const candidate of candidates.get(signal.from) ?? []) await peer.addIceCandidate(candidate)
          candidates.delete(signal.from)
        } else if (signal.kind === 'ice' && signal.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate)
          else candidates.set(signal.from, [...(candidates.get(signal.from) ?? []), signal.candidate])
        }
      } catch (signalError) {
        if (!cancelled) setError(signalError instanceof Error ? signalError.message : 'No se pudo establecer la conexión de voz.')
      }
    }

    const connect = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('voicePermissionError')
        const audioOptions = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { ...audioOptions, ...(audioDeviceIdRef.current ? { deviceId: { exact: audioDeviceIdRef.current } } : {}) },
            video: false,
          })
        } catch (deviceError) {
          const errorName = deviceError instanceof DOMException ? deviceError.name : ''
          if (!audioDeviceIdRef.current || !['NotFoundError', 'OverconstrainedError'].includes(errorName)) throw deviceError
          audioDeviceIdRef.current = ''
          stream = await navigator.mediaDevices.getUserMedia({ audio: audioOptions, video: false })
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        setLocalStream(stream)
        const voiceChannel = supabaseClient.channel(`voice:${roomId}`, {
          config: { private: true, presence: { key: userId }, broadcast: { self: false } },
        })
        channelRef.current = voiceChannel
        voiceChannel.on('broadcast', { event: 'voice-signal' }, ({ payload }) => { void handleSignal(payload as SignalMessage) })
        voiceChannel.on('presence', { event: 'sync' }, () => { void syncPresence() })
        voiceChannel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await voiceChannel.track({ userId, displayName, username, avatarPath })
            setConnecting(false)
            await syncPresence()
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setError('connectionError')
            setConnecting(false)
          }
        })
      } catch (connectError) {
        if (!cancelled) {
          const errorName = connectError instanceof DOMException ? connectError.name : ''
          setError(errorName === 'NotAllowedError' || errorName === 'NotFoundError'
            ? 'voicePermissionError'
            : connectError instanceof Error ? connectError.message : 'connectionError')
          setConnecting(false)
        }
      }
    }

    void connect()
    return () => {
      cancelled = true
      const activeChannel = channelRef.current
      channelRef.current = null
      if (activeChannel) void supabaseClient.removeChannel(activeChannel)
      connections.forEach((peer) => peer.close())
      connections.clear()
      activeAudioSenders.clear()
      activeVideoSenders.clear()
      candidates.clear()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setLocalStream(null)
      setParticipants([])
      setConnecting(false)
      setMuted(false)
      mutedRef.current = false
      setCameraEnabled(false)
      cameraEnabledRef.current = false
    }
  }, [enabled, roomId, userId, displayName, username, avatarPath])

  const toggleMute = useCallback(() => {
    const nextMuted = !muted
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted })
    mutedRef.current = nextMuted
    setMuted(nextMuted)
  }, [muted])

  const changeAudioInput = useCallback(async (deviceId: string) => {
    const currentStream = streamRef.current
    if (!currentStream) { audioDeviceIdRef.current = deviceId; return }
    const replacementStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
    const nextAudioTrack = replacementStream.getAudioTracks()[0]
    if (!nextAudioTrack) throw new Error('voicePermissionError')
    nextAudioTrack.enabled = !mutedRef.current
    await Promise.all([...audioSenders.current.values()].map((sender) => sender.replaceTrack(nextAudioTrack)))
    audioDeviceIdRef.current = deviceId
    const oldAudioTracks = currentStream.getAudioTracks()
    const nextStream = new MediaStream([...currentStream.getVideoTracks(), nextAudioTrack])
    streamRef.current = nextStream
    setLocalStream(nextStream)
    oldAudioTracks.forEach((track) => track.stop())
  }, [])

  const changeCameraDevice = useCallback(async (deviceId: string) => {
    if (!cameraEnabledRef.current) { cameraDeviceIdRef.current = deviceId; return }
    const currentStream = streamRef.current
    if (!currentStream) return
    const replacementStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    const nextVideoTrack = replacementStream.getVideoTracks()[0]
    if (!nextVideoTrack) throw new Error('voicePermissionError')
    await Promise.all([...videoSenders.current.values()].map((sender) => sender.replaceTrack(nextVideoTrack)))
    cameraDeviceIdRef.current = deviceId
    const oldVideoTracks = currentStream.getVideoTracks()
    const nextStream = new MediaStream([...currentStream.getAudioTracks(), nextVideoTrack])
    streamRef.current = nextStream
    setLocalStream(nextStream)
    oldVideoTracks.forEach((track) => track.stop())
  }, [])

  const toggleCamera = useCallback(async () => {
    const currentStream = streamRef.current
    if (!currentStream) return
    if (cameraEnabledRef.current) {
      await Promise.all([...videoSenders.current.values()].map((sender) => sender.replaceTrack(null)))
      const oldVideoTracks = currentStream.getVideoTracks()
      const nextStream = new MediaStream(currentStream.getAudioTracks())
      streamRef.current = nextStream
      setLocalStream(nextStream)
      oldVideoTracks.forEach((track) => track.stop())
      cameraEnabledRef.current = false
      setCameraEnabled(false)
      return
    }
    const replacementStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(cameraDeviceIdRef.current ? { deviceId: { exact: cameraDeviceIdRef.current } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    })
    const nextVideoTrack = replacementStream.getVideoTracks()[0]
    if (!nextVideoTrack) throw new Error('voicePermissionError')
    await Promise.all([...videoSenders.current.values()].map((sender) => sender.replaceTrack(nextVideoTrack)))
    const nextStream = new MediaStream([...currentStream.getAudioTracks(), nextVideoTrack])
    streamRef.current = nextStream
    setLocalStream(nextStream)
    cameraEnabledRef.current = true
    setCameraEnabled(true)
  }, [])

  return { participants, localStream, connecting, muted, cameraEnabled, error, toggleMute, toggleCamera, changeAudioInput, changeCameraDevice }
}

export async function sendCallInvite(targetUserId: string, roomId: string, caller: Profile) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const channel = supabase.channel(`voice-call:${targetUserId}:${roomId}`, { config: { private: true, broadcast: { self: false } } })
  try {
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('No se pudo iniciar la llamada. Revisa las políticas Realtime.'))
      })
    })
    const result = await channel.send({
      type: 'broadcast', event: 'voice-call',
      payload: { action: 'invite', to: targetUserId, roomId, callerId: caller.id, callerName: caller.display_name, callerAvatar: caller.avatar_path },
    })
    if (result !== 'ok') throw new Error('Supabase no pudo enviar la invitación de llamada.')
  } finally {
    await supabase.removeChannel(channel)
  }
}

export async function sendCallResponse(targetUserId: string, roomId: string, responder: Profile, action: 'accept' | 'decline' | 'end') {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const channel = supabase.channel(`voice-call:${targetUserId}:${roomId}`, { config: { private: true, broadcast: { self: false } } })
  try {
    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('No se pudo enviar la respuesta de llamada.'))
      })
    })
    const result = await channel.send({
      type: 'broadcast', event: 'voice-call',
      payload: { action, to: targetUserId, roomId, callerId: responder.id, callerName: responder.display_name },
    })
    if (result !== 'ok') throw new Error('Supabase no pudo enviar la respuesta de llamada.')
  } finally {
    await supabase.removeChannel(channel)
  }
}

export function useIncomingVoiceCalls(userId: string | undefined, rooms: Array<{ id: string }>) {
  const [incoming, setIncoming] = useState<{ roomId: string; callerId: string; callerName: string; callerAvatar: string | null } | null>(null)
  const [response, setResponse] = useState<{ roomId: string; action: 'accept' | 'decline' | 'end' } | null>(null)
  const roomKey = rooms.map((room) => room.id).sort().join(',')

  useEffect(() => {
    if (!userId || !supabase || !roomKey) return
    const supabaseClient = supabase
    const roomIds = roomKey.split(',')
    const channels = roomIds.map((roomId) => {
      const channel = supabaseClient.channel(`voice-call:${userId}:${roomId}`, {
        config: { private: true, broadcast: { self: false } },
      })
      channel.on('broadcast', { event: 'voice-call' }, ({ payload }) => {
        const call = payload as { action?: string; to?: string; roomId?: string; callerId?: string; callerName?: string; callerAvatar?: string | null }
        if (call.to !== userId || !call.roomId || !call.callerId) return
        if (call.action === 'invite') setIncoming({ roomId: call.roomId, callerId: call.callerId, callerName: call.callerName ?? 'CLARY', callerAvatar: call.callerAvatar ?? null })
        if (call.action === 'end') setIncoming((current) => current?.roomId === call.roomId ? null : current)
        if (call.action === 'accept' || call.action === 'decline' || call.action === 'end') setResponse({ roomId: call.roomId, action: call.action })
      })
      channel.subscribe()
      return channel
    })
    return () => { channels.forEach((channel) => { void supabaseClient.removeChannel(channel) }) }
  }, [userId, roomKey])

  const clearIncoming = useCallback(() => setIncoming(null), [])
  const clearResponse = useCallback(() => setResponse(null), [])
  return { incoming, response, clearIncoming, clearResponse }
}
