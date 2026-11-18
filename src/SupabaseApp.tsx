import brandLogo from '../Logo.png'
import { startTransition, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode, type RefObject } from 'react'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import {
  ArrowRight, Camera, Check, Copy, Download, FileText, Hash, ImagePlus,
  Languages, LogOut, Menu, MessageCircle, Mic, MicOff, Paperclip, Phone, PhoneOff,
  Link, Pencil, Plus, Search, Send, Settings, ShieldCheck, Sparkles, Trash2, Users,
  Video, VideoOff, Volume2, X,
} from 'lucide-react'
import {
  acceptWorkspaceInvite, addWorkspaceMember, avatarUrl, createChannel, createDirect, createGroup, createVoiceChannel, createWorkspace, createWorkspaceInvite,
  deleteChannel, deleteMessage, fetchMessages, fetchProfile, fetchSidebar, fetchWorkspaceMembers, removeAvatar,
  sendMessage, subscribeToChannelChanges, subscribeToNewMessages, subscribeToRoom, unsubscribeFromRoom, updateChannel, updateProfile, updateWorkspace,
  subscribeToProfiles, updateOwnPresence, uploadAvatar, uploadMessageFile, type ChatMessage, type Conversation,
  type Channel, type Profile, type Workspace, type WorkspaceMember,
} from './lib/claryData'
import { supabase, supabaseConfigured } from './lib/supabase'
import { languages, localeForLanguage, storedLanguage, translate, type LanguageCode, type TranslationKey } from './lib/i18n'
import { sendCallInvite, sendCallResponse, useIncomingVoiceCalls, useVoiceRoom, type VoiceDevice, type VoiceParticipant } from './hooks/useVoiceRoom'
import { useSpeaking } from './hooks/useSpeaking'
import { useVoicePresence } from './hooks/useVoicePresence'
import { playHangupSound, playMessageSound, prepareSounds, shouldPlayMessage, startRingtone, stopRingtone } from './lib/sounds'
import { ProfilePopover } from './ProfilePopover'
import './Clary.css'
import './VoiceControls.css'

type CreationMode = 'workspace' | 'channel' | 'voice' | 'direct' | 'invite' | null
type ContextMenu = { message: ChatMessage; x: number; y: number }
type WorkspaceContextMenu = { workspace: Workspace; x: number; y: number }
type PresenceContextMenu = { x: number; y: number }
type SettingsSection = 'profile' | 'voice' | 'appearance' | 'language' | 'account'
type AppTheme = 'clary' | 'forest' | 'ocean' | 'midnight'
type RoomView = { id: string; title: string; kind: 'channel' | 'voice' | 'direct' | 'group'; purpose: string; color: string; created_by?: string | null; profile?: Profile }
const colors = ['#742cf1', '#18c4ed', '#c647e8', '#2154ed', '#8b73ee']

function initials(value: string) {
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function presenceClass(profile: Pick<Profile, 'presence_status' | 'last_seen_at'>) {
  if (profile.presence_status === 'busy') return 'busy'
  if (profile.presence_status === 'offline') return 'offline'
  if (profile.presence_status === 'away') return 'away'
  return 'online'
}

function renderMessageContent(content: string) {
  return content.split(/(@[\w.-]+)/g).map((part, index) => part.startsWith('@')
    ? <span className="message-mention" key={`${part}-${index}`}>{part}</span>
    : part)
}

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const details = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const message = typeof details.message === 'string' ? details.message : ''
    const extra = [details.details, details.hint, details.code]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (message) return [message, ...extra].join(' · ')
  }
  return fallback
}

function PersonAvatar({ profile, className, color }: { profile?: Pick<Profile, 'display_name' | 'username' | 'avatar_path'> | null; className: string; color?: string }) {
  const image = profile?.avatar_path ? avatarUrl(profile.avatar_path) : null
  if (image) return <img className={className} src={image} alt={profile?.display_name ?? 'Foto de perfil'} />
  return <span className={`${className} avatar-fallback`} style={{ backgroundColor: color ?? '#d5c6ff' }}>{initials(profile?.display_name ?? profile?.username ?? '?')}</span>
}

function BrandLogo({ className = '' }: { className?: string }) {
  return <img className={`brand-image ${className}`} src={brandLogo} alt="CLARY" />
}

  function VoiceAudio({ participant, outputDeviceId = storedDevice('clary.audioOutput') }: { participant: VoiceParticipant; outputDeviceId?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !participant.stream) return
    audio.srcObject = new MediaStream(participant.stream.getAudioTracks())
    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }
    if (outputDeviceId && sinkAudio.setSinkId) void sinkAudio.setSinkId(outputDeviceId).catch(() => undefined)
    void audio.play().catch(() => undefined)
    return () => { audio.srcObject = null }
  }, [participant.stream, outputDeviceId])
  return <audio ref={audioRef} autoPlay playsInline aria-label={participant.displayName} />
}

function VoiceVideo({ stream, muted = false, className, filter = 'none' }: { stream: MediaStream | undefined; muted?: boolean; className: string; filter?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoAvailable, setVideoAvailable] = useState(false)
  useEffect(() => {
    const video = videoRef.current
    const tracks = stream?.getVideoTracks() ?? []
    if (!video || tracks.length === 0) return
    const updateAvailability = () => setVideoAvailable(tracks.some((track) => track.readyState === 'live' && !track.muted))
    startTransition(updateAvailability)
    tracks.forEach((track) => {
      track.addEventListener('mute', updateAvailability)
      track.addEventListener('unmute', updateAvailability)
      track.addEventListener('ended', updateAvailability)
    })
    video.srcObject = new MediaStream(tracks)
    void video.play().catch(() => undefined)
    return () => {
      tracks.forEach((track) => {
        track.removeEventListener('mute', updateAvailability)
        track.removeEventListener('unmute', updateAvailability)
        track.removeEventListener('ended', updateAvailability)
      })
      video.srcObject = null
    }
  }, [stream])
  if (!stream?.getVideoTracks().length) return null
  const filters: Record<string, string> = { none: 'none', soft: 'saturate(.88) contrast(.96)', mono: 'grayscale(1)', warm: 'sepia(.22) saturate(1.15)' }
  return <video ref={videoRef} className={className} style={{ visibility: videoAvailable ? 'visible' : 'hidden', filter: filters[filter] ?? 'none' }} autoPlay playsInline muted={muted} />
}

function VoiceDeviceControls({
  devices, audioInputId, audioOutputId, cameraDeviceId, cameraEnabled, disabled, cameraDisabled = false,
  onAudioInput, onAudioOutput, onCameraDevice, onToggleCamera, t,
}: {
  devices: VoiceDevice[]
  audioInputId: string
  audioOutputId: string
  cameraDeviceId: string
  cameraEnabled: boolean
  disabled: boolean
  cameraDisabled?: boolean
  onAudioInput: (id: string) => void
  onAudioOutput: (id: string) => void
  onCameraDevice: (id: string) => void
  onToggleCamera: () => void
  t: (key: TranslationKey) => string
}) {
  const inputs = devices.filter((device) => device.id.startsWith('audioinput:'))
  const outputs = devices.filter((device) => device.id.startsWith('audiooutput:'))
  const cameras = devices.filter((device) => device.id.startsWith('videoinput:'))
  return <div className="voice-device-controls">
    <label><Mic size={14} /><span>{t('audioInput')}</span><select disabled={disabled} value={audioInputId} onChange={(event) => onAudioInput(event.target.value)}><option value="">{t('defaultDevice')}</option>{inputs.map((device) => <option key={device.id} value={device.id.slice('audioinput:'.length)}>{device.label}</option>)}</select></label>
    <label><Volume2 size={14} /><span>{t('audioOutput')}</span><select disabled={disabled} value={audioOutputId} onChange={(event) => onAudioOutput(event.target.value)}><option value="">{t('defaultDevice')}</option>{outputs.map((device) => <option key={device.id} value={device.id.slice('audiooutput:'.length)}>{device.label}</option>)}</select></label>
    <label><Camera size={14} /><span>{t('cameraDevice')}</span><select disabled={disabled} value={cameraDeviceId} onChange={(event) => onCameraDevice(event.target.value)}><option value="">{t('defaultDevice')}</option>{cameras.map((device) => <option key={device.id} value={device.id.slice('videoinput:'.length)}>{device.label}</option>)}</select></label>
    <button className={`voice-control camera-control ${cameraEnabled ? 'camera-enabled' : ''}`} type="button" disabled={disabled || cameraDisabled} title={cameraEnabled ? t('cameraOff') : t('cameraOn')} aria-label={cameraEnabled ? t('cameraOff') : t('cameraOn')} onClick={onToggleCamera}>{cameraEnabled ? <VideoOff size={16} /> : <Video size={16} />}</button>
  </div>
}

function SpeakingParticipant({ stream, muted, children }: { stream: MediaStream | null | undefined; muted?: boolean; children: ReactNode }) {
  const speaking = useSpeaking(stream, muted)
  return <div className={`call-participant${speaking ? ' is-speaking' : ''}`}>{children}</div>
}

function CallStage({ room, profile, voice, voiceError, outputDeviceId, devices, audioInputId, cameraDeviceId, cameraFilter, onAudioInput, onAudioOutput, onCameraDevice, onToggleCamera, onHangup, onShowChat, t }: {
  room: RoomView
  profile: Profile | null
  voice: ReturnType<typeof useVoiceRoom>
  voiceError: string
  outputDeviceId: string
  devices: VoiceDevice[]
  audioInputId: string
  cameraDeviceId: string
  cameraFilter: string
  onAudioInput: (id: string) => void
  onAudioOutput: (id: string) => void
  onCameraDevice: (id: string) => void
  onToggleCamera: () => void
  onHangup: () => void
  onShowChat: () => void
  t: (key: TranslationKey) => string
}) {
  return <section className="call-stage" aria-label={t('voiceCall')}>
    <header className="call-stage-header">
      <div><span className="call-stage-eyebrow"><span className="call-stage-dot" />{voice.connecting ? t('voiceConnecting') : voice.error ? t('connectionError') : t('voiceConnected')}</span><h2>{room.title}</h2></div>
      {room.kind === 'direct' && <button className="call-icon-button" type="button" title={t('conversationTitle')} aria-label={t('conversationTitle')} onClick={onShowChat}><MessageCircle size={19} /></button>}
    </header>
    {voiceError && <p className="call-stage-error" role="alert">{voiceError}</p>}
    <div className={`call-participants ${voice.participants.length === 0 ? 'single' : ''}`}>
      <SpeakingParticipant stream={voice.localStream} muted={voice.muted}>
        <PersonAvatar profile={profile} className="call-participant-avatar" />
        <VoiceVideo stream={voice.localStream ?? undefined} muted className="call-participant-video" filter={cameraFilter} />
        <span className="call-participant-name">{profile?.display_name ?? 'CLARY'} {voice.muted && <MicOff size={14} />}</span>
      </SpeakingParticipant>
      {voice.participants.map((participant) => <SpeakingParticipant stream={participant.stream} key={participant.id}>
        {participant.avatarPath ? <img className="call-participant-avatar" src={avatarUrl(participant.avatarPath) ?? undefined} alt="" /> : <span className="call-participant-avatar call-avatar-fallback">{initials(participant.displayName)}</span>}
        <VoiceVideo stream={participant.stream} className="call-participant-video" />
        <span className="call-participant-name">{participant.displayName}</span>
      </SpeakingParticipant>)}
    </div>
    <footer className="call-stage-footer">
      <button className={`call-control ${voice.muted ? 'is-off' : ''}`} type="button" disabled={voice.connecting || Boolean(voice.error)} title={voice.muted ? t('voiceMuted') : t('voiceUnmuted')} aria-label={voice.muted ? t('voiceMuted') : t('voiceUnmuted')} onClick={voice.toggleMute}>{voice.muted ? <MicOff size={20} /> : <Mic size={20} />}</button>
      <button className={`call-control ${voice.cameraEnabled ? '' : 'is-off'}`} type="button" disabled={voice.connecting || Boolean(voice.error)} title={voice.cameraEnabled ? t('cameraOff') : t('cameraOn')} aria-label={voice.cameraEnabled ? t('cameraOff') : t('cameraOn')} onClick={onToggleCamera}>{voice.cameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}</button>
      <details className="call-device-menu"><summary className="call-control" title={t('settings')} aria-label={t('settings')}><Settings size={20} /></summary>
        <VoiceDeviceControls devices={devices} audioInputId={audioInputId} audioOutputId={outputDeviceId} cameraDeviceId={cameraDeviceId} cameraEnabled={voice.cameraEnabled} disabled={voice.connecting || Boolean(voice.error)} onAudioInput={onAudioInput} onAudioOutput={onAudioOutput} onCameraDevice={onCameraDevice} onToggleCamera={onToggleCamera} t={t} />
      </details>
      <button className="call-control call-hangup" type="button" title={t('endCall')} aria-label={t('endCall')} onClick={onHangup}><PhoneOff size={20} /></button>
    </footer>
  </section>
}

function SettingsScreen({ section, onSectionChange, onClose, profile, authUser, language, setLanguage, theme, setTheme, devices, audioInputId, audioOutputId, cameraDeviceId, voice, onAudioInput, onAudioOutput, onCameraDevice, onSignOut, onDeleteAccount, accountError, profileName, setProfileName, profileUsername, setProfileUsername, profileBusy, profileError, onProfileSubmit, avatarInputRef, bannerInputRef, onAvatarChange, onBannerChange, cameraFilter, setCameraFilter, t }: {
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
  onClose: () => void
  profile: Profile | null
  authUser: SupabaseUser | null
  language: LanguageCode
  setLanguage: (language: LanguageCode) => void
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  devices: VoiceDevice[]
  audioInputId: string
  audioOutputId: string
  cameraDeviceId: string
  voice: ReturnType<typeof useVoiceRoom>
  onAudioInput: (id: string) => void
  onAudioOutput: (id: string) => void
  onCameraDevice: (id: string) => void
  onSignOut: () => void
  onDeleteAccount: () => void
  accountError: string
  profileName: string
  setProfileName: (value: string) => void
  profileUsername: string
  setProfileUsername: (value: string) => void
  profileBusy: boolean
  profileError: string
  onProfileSubmit: (event: FormEvent<HTMLFormElement>) => void
  avatarInputRef: RefObject<HTMLInputElement | null>
  bannerInputRef: RefObject<HTMLInputElement | null>
  onAvatarChange: (event: FormEvent<HTMLInputElement>) => void
  onBannerChange: (event: FormEvent<HTMLInputElement>) => void
  cameraFilter: string
  setCameraFilter: (filter: string) => void
  t: (key: TranslationKey) => string
}) {
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const sections: Array<{ id: SettingsSection; label: string; icon: ReactNode }> = [
    { id: 'profile', label: 'Mi perfil', icon: <Users size={16} /> },
    { id: 'voice', label: 'Voz y vídeo', icon: <Volume2 size={16} /> },
    { id: 'appearance', label: 'Apariencia', icon: <Camera size={16} /> },
    { id: 'language', label: t('language'), icon: <Languages size={16} /> },
    { id: 'account', label: 'Cuenta', icon: <ShieldCheck size={16} /> },
  ]
  const joined = authUser?.created_at ? new Date(authUser.created_at).toLocaleDateString(localeForLanguage(language), { dateStyle: 'long' }) : ''
  const banner = profile?.banner_path ? avatarUrl(profile.banner_path) : undefined

  return <section className="settings-screen" aria-labelledby="settings-title">
    <header className="settings-topbar"><div><p className="eyebrow">CLARY</p><h1 id="settings-title">{t('settingsTitle')}</h1></div><button className="settings-back-button" type="button" title={t('close')} aria-label={t('close')} onClick={onClose}><X size={19} /></button></header>
    <div className="settings-layout">
      <nav className="settings-menu" aria-label={t('settingsTitle')}>{sections.map((item) => <button key={item.id} className={section === item.id ? 'selected' : ''} type="button" onClick={() => onSectionChange(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
      <div className="settings-content">
        {section === 'profile' && <>
          <div className="settings-section-heading"><h2>Mi perfil</h2><p>Tu identidad en los espacios y conversaciones.</p></div>
          <div className="settings-profile-banner" style={banner ? { backgroundImage: `linear-gradient(90deg, #16231b66, transparent), url("${banner}")` } : undefined}>
            <PersonAvatar profile={profile} className="settings-profile-avatar" />
            <input ref={bannerInputRef} className="visually-hidden" type="file" accept="image/*" onChange={onBannerChange} />
            <button type="button" className="settings-banner-button" disabled={profileBusy} onClick={() => bannerInputRef.current?.click()}><ImagePlus size={15} />Cambiar banner</button>
          </div>
              <div className="settings-profile-summary"><strong>{profile?.display_name}</strong><span>@{profile?.username}</span>{joined && <small>Miembro desde {joined}</small>}</div>
          <div className="settings-avatar-action"><input ref={avatarInputRef} className="visually-hidden" type="file" accept="image/*" onChange={onAvatarChange} /><button className="avatar-change-button" type="button" disabled={profileBusy} onClick={() => avatarInputRef.current?.click()}><ImagePlus size={15} />{t('changePhoto')}</button></div>
          <form className="settings-form" onSubmit={onProfileSubmit}><label>{t('visibleName')}<input required maxLength={80} value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label>{t('username')}<input required minLength={3} maxLength={32} value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} /></label>{profileError && <p className="auth-feedback error-feedback" role="alert">{profileError}</p>}<button className="primary-button modal-submit" type="submit" disabled={profileBusy}>{profileBusy ? t('saving') : t('saveChanges')}<Check size={16} /></button></form>
        </>}
        {section === 'voice' && <><div className="settings-section-heading"><h2>Voz y vídeo</h2><p>Elige los dispositivos que CLARY usará durante tus llamadas.</p></div><VoiceDeviceControls devices={devices} audioInputId={audioInputId} audioOutputId={audioOutputId} cameraDeviceId={cameraDeviceId} cameraEnabled={voice.cameraEnabled} disabled={voice.connecting || Boolean(voice.error)} cameraDisabled={!voice.localStream} onAudioInput={onAudioInput} onAudioOutput={onAudioOutput} onCameraDevice={onCameraDevice} onToggleCamera={() => void voice.toggleCamera()} t={t} /></>}
        {section === 'appearance' && <><div className="settings-section-heading"><h2>Apariencia</h2><p>Elige el aspecto de CLARY y el estilo de tu cámara.</p></div><label className="settings-field">Tema de CLARY<select value={theme} onChange={(event) => setTheme(event.target.value as AppTheme)}><option value="clary">Clary</option><option value="forest">Bosque</option><option value="ocean">Océano</option><option value="midnight">Medianoche</option></select></label><label className="settings-field">Filtro de cámara<select value={cameraFilter} onChange={(event) => setCameraFilter(event.target.value)}><option value="none">Original</option><option value="soft">Suave</option><option value="mono">Blanco y negro</option><option value="warm">Cálido</option></select></label><p className="settings-help">El filtro afecta a tu vista previa local. El desenfoque de fondo y los fondos virtuales necesitan procesamiento adicional y aún no están disponibles.</p></>}
        {section === 'language' && <><div className="settings-section-heading"><h2>{t('language')}</h2><p>{t('languageHelp')}</p></div><label className="settings-field"><span>{t('language')}</span><select value={language} onChange={(event) => { const nextLanguage = event.target.value as LanguageCode; localStorage.setItem('clary.language', nextLanguage); setLanguage(nextLanguage) }}>{languages.map((option) => <option key={option.code} value={option.code}>{option.native}</option>)}</select></label></>}
        {section === 'account' && <><div className="settings-section-heading"><h2>Cuenta</h2><p>Acceso y seguridad de tu cuenta.</p></div><div className="settings-account-row"><span>Correo electrónico</span><strong>{authUser?.email ?? ''}</strong></div><div className="settings-account-row"><span>Fecha de registro</span><strong>{joined}</strong></div><button className="settings-signout-button" type="button" onClick={onSignOut}><LogOut size={16} />{t('logout')}</button><div className="settings-danger-zone"><h3>Eliminar cuenta</h3><p>Esta acción elimina tu acceso, perfil y archivos. Los mensajes de texto se conservan sin asociarlos a tu cuenta.</p>{accountError && <p className="auth-feedback error-feedback" role="alert">{accountError}</p>}<label>Escribe ELIMINAR para confirmar<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label><button type="button" disabled={deleteConfirmation !== 'ELIMINAR'} onClick={onDeleteAccount}>Eliminar cuenta definitivamente</button></div></>}
      </div>
    </div>
  </section>
}

function storedDevice(key: string) {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

function storedMutedWorkspaces(): string[] {
  try {
    const stored = localStorage.getItem('clary.mutedWorkspaces')
    const parsed: unknown = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

function storedInviteToken() {
  const token = new URLSearchParams(window.location.search).get('invite')
  if (token) {
    try { localStorage.setItem('clary.pendingInvite', token) } catch { return token }
  }
  return token ?? storedDevice('clary.pendingInvite')
}

function SupabaseApp() {
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(null)
  const [language, setLanguage] = useState<LanguageCode>(storedLanguage)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [displayNameInput, setDisplayNameInput] = useState('')
  const [emailInput, setEmailInput] = useState(() => storedDevice('clary.rememberedEmail'))
  const [passwordInput, setPasswordInput] = useState('')
  const [rememberMe, setRememberMe] = useState(() => Boolean(storedDevice('clary.rememberedEmail')))
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
    const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(storedInviteToken())
    const [inviteNotice, setInviteNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [directs, setDirects] = useState<Conversation[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('')
  const [activeRoomId, setActiveRoomId] = useState('')
  const [voiceRoomId, setVoiceRoomId] = useState<string | null>(null)
  const [showCallStage, setShowCallStage] = useState(true)
  const [outgoingCallRoomId, setOutgoingCallRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
  const [membersWorkspaceId, setMembersWorkspaceId] = useState('')
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mutedWorkspaceIds, setMutedWorkspaceIds] = useState<string[]>(storedMutedWorkspaces)
  const [search, setSearch] = useState('')
  const [dataLoading, setDataLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [creationMode, setCreationMode] = useState<CreationMode>(null)
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null)
  const [channelName, setChannelName] = useState('')
  const [channelDescription, setChannelDescription] = useState('')
  const [channelError, setChannelError] = useState('')
  const [channelSaving, setChannelSaving] = useState(false)
  const [channelDeleteConfirm, setChannelDeleteConfirm] = useState(false)
  const [creationName, setCreationName] = useState('')
  const [creationMembers, setCreationMembers] = useState('')
  const [newGroup, setNewGroup] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('profile')
  const [profileNameInput, setProfileNameInput] = useState('')
  const [profileUsernameInput, setProfileUsernameInput] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenu | null>(null)
  const [presenceContextMenu, setPresenceContextMenu] = useState<PresenceContextMenu | null>(null)
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null)
  const [workspaceNameInput, setWorkspaceNameInput] = useState('')
  const [workspaceIconFile, setWorkspaceIconFile] = useState<File | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceInviteLink, setWorkspaceInviteLink] = useState('')
  const [workspaceInviteExpiry, setWorkspaceInviteExpiry] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(() => storedDevice('clary.audioInput'))
  const [audioOutputDeviceId, setAudioOutputDeviceId] = useState(() => storedDevice('clary.audioOutput'))
  const [cameraDeviceId, setCameraDeviceId] = useState(() => storedDevice('clary.camera'))
  const [cameraFilter, setCameraFilter] = useState(() => storedDevice('clary.cameraFilter') || 'none')
  const [theme, setTheme] = useState<AppTheme>(() => (storedDevice('clary.theme') as AppTheme) || 'clary')
  const [availableDevices, setAvailableDevices] = useState<VoiceDevice[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const workspaceIconInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const presenceStatusRef = useRef<Profile['presence_status']>('online')
  const manualPresenceRef = useRef(false)
  const workspacesRef = useRef(workspaces)
  const mutedWorkspaceIdsRef = useRef(mutedWorkspaceIds)

  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const authUserId = authUser?.id
  const t = (key: TranslationKey) => translate(language, key)
  const locale = localeForLanguage(language)
  const rooms: RoomView[] = [
    ...(activeWorkspace?.channels ?? []).map((channel) => ({
      id: channel.id, title: channel.name, kind: 'channel' as const,
      purpose: channel.purpose, created_by: channel.created_by, color: activeWorkspace?.color ?? colors[0],
    })),
    ...(activeWorkspace?.voiceChannels ?? []).map((channel) => ({
      id: channel.id, title: channel.name, kind: 'voice' as const,
      purpose: channel.purpose, created_by: channel.created_by, color: activeWorkspace?.color ?? colors[0],
    })),
    ...directs,
  ]
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? null
  const searchTerm = search.trim().toLowerCase()
  const channels = rooms.filter((room) => room.kind === 'channel' && room.title.toLowerCase().includes(searchTerm))
  const directRooms = directs.filter((room) => room.title.toLowerCase().includes(searchTerm))
  const voiceChannels = (activeWorkspace?.voiceChannels ?? []).filter((room) => room.name.toLowerCase().includes(searchTerm))
  const voice = useVoiceRoom(voiceRoomId, Boolean(voiceRoomId), authUserId, profile, audioInputDeviceId, cameraDeviceId)
  const voicePresence = useVoicePresence(activeWorkspace?.voiceChannels.map((room) => room.id) ?? [], authUserId, voiceRoomId)
  const voiceStatusError = voice.error === 'voicePermissionError' ? t('voicePermissionError') : voice.error === 'connectionError' ? t('connectionError') : voice.error
  const { incoming: incomingCall, response: callResponse, clearIncoming: clearIncomingCall, clearResponse: clearCallResponse } = useIncomingVoiceCalls(authUserId, directs)
  const outgoingRecipientId = directs.find((room) => room.id === outgoingCallRoomId)?.profile?.id
  const ownPresenceStatus = profile?.presence_status ?? 'offline'
  const mentionCandidates = mentionRange && activeRoom?.kind === 'channel' && membersWorkspaceId === activeWorkspaceId
    ? workspaceMembers.filter((member) => member.username.toLowerCase().includes(mentionRange.query.toLowerCase()) || member.display_name.toLowerCase().includes(mentionRange.query.toLowerCase())).slice(0, 8)
    : []

  useEffect(() => { workspacesRef.current = workspaces }, [workspaces])
  useEffect(() => { mutedWorkspaceIdsRef.current = mutedWorkspaceIds }, [mutedWorkspaceIds])

  useEffect(() => {
    if ((!settingsOpen && !voice.localStream) || !navigator.mediaDevices?.enumerateDevices) return
    let active = true
    const refreshDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (active) setAvailableDevices(devices.filter((device) => device.deviceId).map((device) => ({
          id: `${device.kind}:${device.deviceId}`,
          label: device.label || `${device.kind} ${device.deviceId.slice(0, 5)}`,
        })))
      } catch (error) {
        console.error('No se pudieron enumerar los dispositivos de audio y vídeo:', error)
      }
    }
    const handleDeviceChange = () => { void refreshDevices() }
    void refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => {
      active = false
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [settingsOpen, voice.localStream])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('clary.theme', theme)
  }, [theme])

  useEffect(() => {
    document.addEventListener('pointerdown', prepareSounds)
    document.addEventListener('keydown', prepareSounds)
    return () => {
      document.removeEventListener('pointerdown', prepareSounds)
      document.removeEventListener('keydown', prepareSounds)
      stopRingtone()
    }
  }, [])

  useEffect(() => {
    if (!authUserId) return
    const channel = subscribeToNewMessages((authorId, roomId) => {
      if (!shouldPlayMessage(authorId, authUserId)) return
      const owner = workspacesRef.current.find((workspace) => workspace.channels.some((room) => room.id === roomId))
        ?? workspacesRef.current.find((workspace) => workspace.voiceChannels.some((room) => room.id === roomId))
      if (owner && mutedWorkspaceIdsRef.current.includes(owner.id)) return
      playMessageSound()
    })
    return () => { void unsubscribeFromRoom(channel) }
  }, [authUserId])

  useEffect(() => {
    if (!authUserId || !activeWorkspaceId) return
    let active = true
    const refresh = () => {
      void fetchWorkspaceMembers(activeWorkspaceId).then((members) => {
        if (active) { setWorkspaceMembers(members); setMembersWorkspaceId(activeWorkspaceId) }
      }).catch(() => undefined)
    }
    refresh()
    const updates = subscribeToProfiles(refresh, `workspace-presence:${activeWorkspaceId}`)
    const timer = setInterval(refresh, 30000)
    return () => { active = false; clearInterval(timer); void unsubscribeFromRoom(updates) }
  }, [authUserId, activeWorkspaceId])

  useEffect(() => {
    if (!authUserId || !profile?.id) return
    presenceStatusRef.current = profile.presence_status
  }, [authUserId, profile?.id, profile?.presence_status])

  useEffect(() => {
    if (!authUserId || !profile?.id) return
    let lastActivity = Date.now()
    let lastPublished = 0
    manualPresenceRef.current = presenceStatusRef.current === 'away' || presenceStatusRef.current === 'busy' || presenceStatusRef.current === 'offline'
    const publish = (next: Profile['presence_status'], force = false) => {
      if (!force && next === presenceStatusRef.current && Date.now() - lastPublished < 60000) return
      presenceStatusRef.current = next
      lastPublished = Date.now()
      setProfile((current) => current ? { ...current, presence_status: next, last_seen_at: new Date().toISOString() } : current)
      void updateOwnPresence(authUserId, next).catch(() => undefined)
    }
    const markActive = () => {
      lastActivity = Date.now()
      if (presenceStatusRef.current === 'away' && !manualPresenceRef.current) publish('online')
    }
    const checkActivity = () => {
      if (presenceStatusRef.current === 'busy' || presenceStatusRef.current === 'offline') {
        if (Date.now() - lastPublished >= 60000) publish(presenceStatusRef.current, true)
      } else if (Date.now() - lastActivity >= 5 * 60 * 1000) {
        publish('away')
      } else if (Date.now() - lastPublished >= 60000) {
        publish(presenceStatusRef.current, true)
      }
    }
    document.addEventListener('pointermove', markActive, { passive: true })
    document.addEventListener('keydown', markActive)
    document.addEventListener('pointerdown', markActive)
    const timer = setInterval(checkActivity, 15000)
    const storedStatus = presenceStatusRef.current
    const initialStatus = storedStatus
    publish(initialStatus, true)
    return () => {
      clearInterval(timer)
      document.removeEventListener('pointermove', markActive)
      document.removeEventListener('keydown', markActive)
      document.removeEventListener('pointerdown', markActive)
    }
  }, [authUserId, profile?.id])

  useEffect(() => {
    if (!authUserId) return
    let active = true
    const channel = subscribeToChannelChanges(() => {
      void fetchSidebar(authUserId).then((sidebar) => {
        if (active) setWorkspaces(sidebar.workspaces)
      }).catch(() => undefined)
    })
    return () => { active = false; void unsubscribeFromRoom(channel) }
  }, [authUserId])

  useEffect(() => {
    if (!authUserId) return
    let active = true
    const refresh = () => {
      void fetchSidebar(authUserId).then((sidebar) => {
        if (active) setDirects(sidebar.conversations)
      }).catch(() => undefined)
    }
    const timer = setInterval(refresh, 5000)
    return () => { active = false; clearInterval(timer) }
  }, [authUserId])

  useEffect(() => {
    if (!incomingCall?.roomId && !outgoingCallRoomId) return
    startRingtone()
    return () => stopRingtone()
  }, [incomingCall?.roomId, outgoingCallRoomId])

  useEffect(() => {
    if (!incomingCall?.roomId) return
    const timer = setTimeout(clearIncomingCall, 35000)
    return () => clearTimeout(timer)
  }, [incomingCall?.roomId, clearIncomingCall])

  useEffect(() => {
    if (!outgoingCallRoomId || !outgoingRecipientId || !profile) return
    const timer = setInterval(() => {
      void sendCallInvite(outgoingRecipientId, outgoingCallRoomId, profile).catch(() => undefined)
    }, 5000)
    const timeout = setTimeout(() => {
      void sendCallResponse(outgoingRecipientId, outgoingCallRoomId, profile, 'end').catch(() => undefined)
      playHangupSound()
      setOutgoingCallRoomId(null)
      setVoiceRoomId(null)
      setVoiceError(translate(language, 'connectionError'))
    }, 30000)
    return () => { clearInterval(timer); clearTimeout(timeout) }
  }, [outgoingCallRoomId, outgoingRecipientId, profile, language])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(error.message)
      setAuthUser(data.session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setAuthUser(nextUser)
      if (!nextUser) {
        setProfile(null); setWorkspaces([]); setDirects([]); setActiveWorkspaceId(''); setActiveRoomId(''); setMessages([])
        setVoiceRoomId(null)
        setOutgoingCallRoomId(null)
      }
      setAuthLoading(false)
      setAuthError('')
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase) return
    const supabaseClient = supabase
    const unsubscribe = window.claryDesktop?.onAuthCallback((url) => {
      void (async () => {
        try {
          const callback = new URL(url)
          const inviteToken = callback.searchParams.get('invite')
          if (inviteToken) {
            localStorage.setItem('clary.pendingInvite', inviteToken)
            setPendingInviteToken(inviteToken)
          }
          if (callback.hostname === 'invite') {
            const token = callback.searchParams.get('token')
            if (token) {
              localStorage.setItem('clary.pendingInvite', token)
              setPendingInviteToken(token)
            }
            return
          }
          const code = callback.searchParams.get('code')
          const hash = new URLSearchParams(callback.hash.slice(1))
          const accessToken = hash.get('access_token')
          const refreshToken = hash.get('refresh_token')
          const result = code
            ? await supabaseClient.auth.exchangeCodeForSession(code)
            : accessToken && refreshToken
              ? await supabaseClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
              : { error: new Error(translate(language, 'genericError')) }
          if (result.error) setAuthError(result.error.message)
        } catch (error) {
          setAuthError(errorText(error, translate(language, 'genericError')))
        }
      })()
    })
    return () => unsubscribe?.()
  }, [language])

  useEffect(() => {
    if (!authUserId || !supabase) return
    let active = true
    startTransition(() => { setDataLoading(true); setDataError('') })
    void Promise.all([fetchProfile(authUserId), fetchSidebar(authUserId)])
      .then(([nextProfile, sidebar]) => {
        if (!active) return
        setProfile(nextProfile)
        setWorkspaces(sidebar.workspaces)
        setDirects(sidebar.conversations)
        const firstWorkspace = sidebar.workspaces[0]
        setActiveWorkspaceId((current) => sidebar.workspaces.some((workspace) => workspace.id === current) ? current : firstWorkspace?.id ?? '')
        const validRoomIds = [...sidebar.workspaces.flatMap((workspace) => workspace.channels.map((channel) => channel.id)), ...sidebar.conversations.map((room) => room.id)]
        const firstRoom = firstWorkspace?.channels[0]?.id ?? sidebar.conversations[0]?.id ?? ''
        setActiveRoomId((current) => validRoomIds.includes(current) ? current : firstRoom)
      })
      .catch((error: unknown) => { if (active) setDataError(errorText(error, translate(language, 'genericError'))) })
      .finally(() => { if (active) setDataLoading(false) })
    return () => { active = false }
  }, [authUserId, language])

  useEffect(() => {
    if (!authUserId || !pendingInviteToken) return
    let active = true
    void acceptWorkspaceInvite(pendingInviteToken).then(async (workspaceId) => {
      const sidebar = await fetchSidebar(authUserId)
      if (!active) return
      setWorkspaces(sidebar.workspaces)
      setDirects(sidebar.conversations)
      setActiveWorkspaceId(workspaceId)
      setActiveRoomId(sidebar.workspaces.find((workspace) => workspace.id === workspaceId)?.channels[0]?.id ?? '')
      setInviteNotice('Te has unido al espacio de trabajo.')
      localStorage.removeItem('clary.pendingInvite')
      history.replaceState(null, '', window.location.pathname)
      setPendingInviteToken(null)
    }).catch((error: unknown) => {
      if (!active) return
      setDataError(errorText(error, translate(language, 'genericError')))
      localStorage.removeItem('clary.pendingInvite')
      history.replaceState(null, '', window.location.pathname)
      setPendingInviteToken(null)
    })
    return () => { active = false }
  }, [authUserId, pendingInviteToken, language])

  useEffect(() => {
    if (!authUserId || !activeRoomId) {
      startTransition(() => setMessages([]))
      return
    }
    let active = true
    startTransition(() => { setMessagesLoading(true); setDataError('') })
    const load = async () => {
      try {
        const nextMessages = await fetchMessages(activeRoomId)
        if (active) setMessages(nextMessages)
      } catch (error) {
        if (active) setDataError(errorText(error, translate(language, 'genericError')))
      } finally {
        if (active) setMessagesLoading(false)
      }
    }
    void load()
    const realtime = subscribeToRoom(activeRoomId, () => { void load() })
    return () => { active = false; void unsubscribeFromRoom(realtime) }
  }, [authUserId, activeRoomId, language])

  useEffect(() => {
    if (!callResponse || voiceRoomId !== callResponse.roomId) return
    if (callResponse.action === 'decline' || callResponse.action === 'end') {
      playHangupSound()
      startTransition(() => {
        setVoiceRoomId(null)
        setOutgoingCallRoomId(null)
        if (callResponse.action === 'decline') setVoiceError(translate(language, 'callDeclined'))
      })
    } else if (callResponse.action === 'accept') {
      startTransition(() => setOutgoingCallRoomId(null))
    }
    clearCallResponse()
  }, [callResponse, voiceRoomId, clearCallResponse, language])

  useEffect(() => {
    if (!authUserId || !activeRoomId) return
    let active = true
    const channel = subscribeToProfiles(() => {
      void fetchMessages(activeRoomId).then((nextMessages) => { if (active) setMessages(nextMessages) })
    })
    return () => { active = false; void unsubscribeFromRoom(channel) }
  }, [authUserId, activeRoomId])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setAuthError(''); setAuthNotice(''); setAuthBusy(true)
    try {
      if (authMode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: emailInput.trim(), password: passwordInput,
          options: { data: { display_name: displayNameInput.trim() }, emailRedirectTo: window.location.protocol === 'http:' || window.location.protocol === 'https:' ? window.location.href : `clary://auth/callback${pendingInviteToken ? `?invite=${encodeURIComponent(pendingInviteToken)}` : ''}` },

        })
        if (error) throw error
        if (!data.session) setAuthNotice(t('mailConfirm'))
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: emailInput.trim(), password: passwordInput })
        if (error) throw error
      }
      if (rememberMe) localStorage.setItem('clary.rememberedEmail', emailInput.trim())
      else localStorage.removeItem('clary.rememberedEmail')
      setPasswordInput('')
    } catch (error) {
      setAuthError(errorText(error, t('genericError')))
    } finally {
      setAuthBusy(false)
    }
  }

  async function handleSignOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) setDataError(error.message)
  }

  async function handleDeleteAccount() {
    if (!supabase) return
    setDataError('')
    const { error } = await supabase.functions.invoke('delete-account')
    if (error) { setDataError(errorText(error, t('genericError'))); return }
    await supabase.auth.signOut({ scope: 'local' })
  }

  async function reloadSidebar(selectRoomId?: string) {
    if (!authUser) return
    const sidebar = await fetchSidebar(authUser.id)
    setWorkspaces(sidebar.workspaces); setDirects(sidebar.conversations)
    if (!sidebar.workspaces.some((workspace) => workspace.id === activeWorkspaceId)) setActiveWorkspaceId(sidebar.workspaces[0]?.id ?? '')
    if (selectRoomId) setActiveRoomId(selectRoomId)
    else if (!activeRoomId) setActiveRoomId(sidebar.workspaces[0]?.channels[0]?.id ?? sidebar.conversations[0]?.id ?? '')
  }

  function openWorkspaceEditor(workspace: Workspace) {
    setEditingWorkspace(workspace)
    setWorkspaceNameInput(workspace.name)
    setWorkspaceIconFile(null)
    setWorkspaceError('')
    setWorkspaceContextMenu(null)
  }

  async function handleWorkspaceSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingWorkspace || !authUser) return
    const name = workspaceNameInput.trim()
    if (!name) return
    setWorkspaceBusy(true)
    setWorkspaceError('')
    let uploadedPath: string | null = null
    try {
      if (workspaceIconFile) uploadedPath = await uploadAvatar(authUser.id, workspaceIconFile)
      const saved = await updateWorkspace(editingWorkspace.id, name, uploadedPath ?? undefined)
      setWorkspaces((current) => current.map((workspace) => workspace.id === saved.id
        ? { ...workspace, name: saved.name, initials: initials(saved.name), icon_path: saved.icon_path ?? editingWorkspace.icon_path }
        : workspace))
      if (uploadedPath && editingWorkspace.icon_path) await removeAvatar(editingWorkspace.icon_path).catch(() => undefined)
      setEditingWorkspace(null)
    } catch (error) {
      if (uploadedPath) await removeAvatar(uploadedPath).catch(() => undefined)
      setWorkspaceError(errorText(error, t('genericError')))
    } finally { setWorkspaceBusy(false) }
  }

  async function handleCreateWorkspaceInvite(workspace: Workspace) {
    setWorkspaceContextMenu(null)
    setWorkspaceError('')
    try {
      const invite = await createWorkspaceInvite(workspace.id)
      setWorkspaceInviteLink(invite.link)
      setWorkspaceInviteExpiry(new Date(invite.expiresAt).toLocaleString(locale))
      setInviteCopied(false)
    } catch (error) { setDataError(errorText(error, t('genericError'))) }
  }

  async function copyWorkspaceInvite() {
    try {
      await navigator.clipboard.writeText(workspaceInviteLink)
      setInviteCopied(true)
    } catch {
      setDataError('No se pudo copiar automáticamente. Selecciona y copia el enlace.')
    }
  }

  async function startDirectCall(room: Conversation) {
    if (!profile?.id || !room.profile) return
    setVoiceError('')
    try {
      setActiveRoomId(room.id)
      setVoiceRoomId(room.id)
      setShowCallStage(true)
      setOutgoingCallRoomId(room.id)
      await sendCallInvite(room.profile.id, room.id, profile)
    } catch (error) {
      setVoiceRoomId(null)
      setOutgoingCallRoomId(null)
      setVoiceError(errorText(error, t('genericError')))
    }
  }

  async function acceptIncomingCall() {
    if (!incomingCall) return
    stopRingtone()
    if (profile) await sendCallResponse(incomingCall.callerId, incomingCall.roomId, profile, 'accept').catch((error: unknown) => setVoiceError(errorText(error, t('genericError'))))
    setActiveRoomId(incomingCall.roomId)
    setVoiceRoomId(incomingCall.roomId)
    setShowCallStage(true)
    setVoiceError('')
    clearIncomingCall()
  }

  async function declineIncomingCall() {
    if (!incomingCall) return
    stopRingtone()
    playHangupSound()
    if (profile) await sendCallResponse(incomingCall.callerId, incomingCall.roomId, profile, 'decline').catch((error: unknown) => setVoiceError(errorText(error, t('genericError'))))
    clearIncomingCall()
  }

  function stopVoice() {
    if (!voiceRoomId) return
    const recipient = directs.find((room) => room.id === voiceRoomId)?.profile
    if (recipient && profile) void sendCallResponse(recipient.id, voiceRoomId, profile, 'end').catch((error: unknown) => setVoiceError(errorText(error, t('genericError'))))
    playHangupSound()
    setOutgoingCallRoomId(null)
    setVoiceRoomId(null)
  }

  function openChannelSettings(channel: Channel) {
    setEditingChannel(channel)
    setChannelName(channel.name)
    setChannelDescription(channel.purpose)
    setChannelError('')
    setChannelDeleteConfirm(false)
  }

  async function handleChannelSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingChannel || !authUser || editingChannel.created_by !== authUser.id) return
    const name = channelName.trim()
    if (!name) return
    setChannelSaving(true)
    setChannelError('')
    try {
      const saved = await updateChannel(editingChannel.id, name, channelDescription.trim())
      setWorkspaces((current) => current.map((workspace) => ({
        ...workspace,
        channels: workspace.channels.map((channel) => channel.id === saved.id ? { ...channel, name: saved.name, purpose: saved.purpose ?? '' } : channel),
        voiceChannels: workspace.voiceChannels.map((channel) => channel.id === saved.id ? { ...channel, name: saved.name, purpose: saved.purpose ?? '' } : channel),
      })))
      setEditingChannel(null)
    } catch (error) {
      setChannelError(errorText(error, t('channelSaveError')))
    } finally {
      setChannelSaving(false)
    }
  }

  async function handleChannelDelete() {
    if (!editingChannel || !authUser || editingChannel.created_by !== authUser.id) return
    setChannelSaving(true)
    setChannelError('')
    try {
      await deleteChannel(editingChannel.id)
      const deletedRoomId = editingChannel.id
      const sidebar = await fetchSidebar(authUser.id)
      setWorkspaces(sidebar.workspaces)
      setDirects(sidebar.conversations)
      if (voiceRoomId === deletedRoomId) {
        setVoiceRoomId(null)
        setOutgoingCallRoomId(null)
      }
      const nextRoomId = sidebar.workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.channels[0]?.id
        ?? sidebar.workspaces[0]?.channels[0]?.id
        ?? sidebar.conversations[0]?.id
        ?? ''
      setActiveRoomId(nextRoomId)
      setEditingChannel(null)
      setChannelDeleteConfirm(false)
    } catch (error) {
      setChannelError(errorText(error, t('genericError')))
    } finally { setChannelSaving(false) }
  }

  async function handleAudioInputChange(deviceId: string) {
    try {
      await voice.changeAudioInput(deviceId)
      setAudioInputDeviceId(deviceId)
      if (deviceId) localStorage.setItem('clary.audioInput', deviceId)
      else localStorage.removeItem('clary.audioInput')
    } catch (error) {
      setVoiceError(error instanceof Error && error.message === 'voicePermissionError' ? t('voicePermissionError') : errorText(error, t('genericError')))
    }
  }

  function handleAudioOutputChange(deviceId: string) {
    setAudioOutputDeviceId(deviceId)
    if (deviceId) localStorage.setItem('clary.audioOutput', deviceId)
    else localStorage.removeItem('clary.audioOutput')
  }

  async function handleCameraDeviceChange(deviceId: string) {
    try {
      await voice.changeCameraDevice(deviceId)
      setCameraDeviceId(deviceId)
      if (deviceId) localStorage.setItem('clary.camera', deviceId)
      else localStorage.removeItem('clary.camera')
    } catch (error) {
      setVoiceError(error instanceof Error && error.message === 'voicePermissionError' ? t('voicePermissionError') : errorText(error, t('genericError')))
    }
  }

  async function handleCameraToggle() {
    try { await voice.toggleCamera() }
    catch (error) { setVoiceError(error instanceof Error && error.message === 'voicePermissionError' ? t('voicePermissionError') : errorText(error, t('genericError'))) }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authUser || !creationMode) return
    const name = creationName.trim()
    if (!name) return
    setDataError(''); setDataLoading(true)
    try {
      if (creationMode === 'workspace') {
        const workspaceId = await createWorkspace(name)
        const sidebar = await fetchSidebar(authUser.id)
        setWorkspaces(sidebar.workspaces); setDirects(sidebar.conversations); setActiveWorkspaceId(workspaceId)
        setActiveRoomId(sidebar.workspaces.find((workspace) => workspace.id === workspaceId)?.channels[0]?.id ?? '')
      } else if (creationMode === 'channel' || creationMode === 'voice') {
        if (!activeWorkspace) throw new Error(t('noWorkspaceForChannel'))
        const roomId = creationMode === 'voice'
          ? await createVoiceChannel(activeWorkspace.id, name, authUser.id)
          : await createChannel(activeWorkspace.id, name.replace(/^#/, ''), authUser.id)
        await reloadSidebar(roomId)
      } else if (creationMode === 'invite') {
        if (!activeWorkspace) throw new Error(t('inviteWorkspaceUser'))
        await addWorkspaceMember(activeWorkspace.id, name)
        await reloadSidebar()
      } else {
        const roomId = newGroup
          ? await createGroup(name, creationMembers.split(','))
          : await createDirect(name)
        await reloadSidebar(roomId)
      }
      setCreationMode(null); setCreationName(''); setCreationMembers(''); setNewGroup(false); setNavOpen(false)
    } catch (error) {
      setDataError(errorText(error, t('genericError')))
    } finally {
      setDataLoading(false)
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authUser || !activeRoom) return
    const text = draft.trim()
    if (!text || text.length > 10000) return
    setDataError('')
    try { await sendMessage(activeRoom.id, authUser.id, text); setDraft(''); playMessageSound() }
    catch (error) { setDataError(errorText(error, t('genericError'))) }
  }

  function updateDraft(value: string, cursor: number) {
    setDraft(value)
    const beforeCursor = value.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)@([\w.-]*)$/)
    if (!match) { setMentionRange(null); setMentionIndex(0); return }
    setMentionRange({ start: cursor - match[0].length + match[1].length, end: cursor, query: match[2] })
    setMentionIndex(0)
  }

  function insertMention(member: WorkspaceMember) {
    if (!mentionRange || !composerRef.current) return
    const mention = `@${member.username} `
    const nextDraft = `${draft.slice(0, mentionRange.start)}${mention}${draft.slice(mentionRange.end)}`
    const cursor = mentionRange.start + mention.length
    setDraft(nextDraft)
    setMentionRange(null)
    requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  async function changePresenceStatus(status: Profile['presence_status']) {
    if (!authUserId) return
    manualPresenceRef.current = status !== 'online'
    presenceStatusRef.current = status
    setProfile((current) => current ? { ...current, presence_status: status, last_seen_at: new Date().toISOString() } : current)
    setPresenceContextMenu(null)
    try { await updateOwnPresence(authUserId, status) }
    catch (error) { setDataError(errorText(error, t('genericError'))) }
  }

  function toggleWorkspaceMute(workspace: Workspace) {
    const next = mutedWorkspaceIds.includes(workspace.id)
      ? mutedWorkspaceIds.filter((id) => id !== workspace.id)
      : [...mutedWorkspaceIds, workspace.id]
    setMutedWorkspaceIds(next)
    mutedWorkspaceIdsRef.current = next
    localStorage.setItem('clary.mutedWorkspaces', JSON.stringify(next))
    setWorkspaceContextMenu(null)
  }

  async function handleFileUpload(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !authUser || !activeRoom) return
    if (file.size > 25 * 1024 * 1024) { setDataError(t('fileTooLarge')); return }
    setUploadingFile(true); setDataError('')
    try { await uploadMessageFile(activeRoom.id, authUser.id, file, draft.trim()); setDraft(''); playMessageSound() }
    catch (error) { setDataError(errorText(error, t('genericError'))) }
    finally { setUploadingFile(false) }
  }

  async function handleDeleteMessage(message: ChatMessage) {
    try {
      await deleteMessage(message.id, message.attachment_path)
      setMessages((current) => current.map((item) => item.id === message.id ? {
        ...item,
        content: '',
        attachment_path: null,
        attachment_name: null,
        attachment_mime: null,
        attachment_url: null,
        deleted_at: new Date().toISOString(),
      } : item))
    } catch (error) { setDataError(errorText(error, t('genericError'))) }
    finally { setContextMenu(null) }
  }

  function openProfile() {
    if (!profile) return
    setProfileNameInput(profile.display_name)
    setProfileUsernameInput(profile.username)
    setProfileError('')
    setSettingsSection('profile')
    setSettingsOpen(true)
    setNavOpen(false)
  }

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!authUser || !profile) return
    const username = profileUsernameInput.trim().replace(/^@/, '').toLowerCase()
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) { setProfileError(t('usernameFormat')); return }
    setProfileBusy(true); setProfileError('')
    try {
      const updated = await updateProfile(authUser.id, { display_name: profileNameInput.trim(), username, avatar_path: profile.avatar_path })
      setProfile(updated)
    } catch (error) { setProfileError(errorText(error, t('genericError'))) }
    finally { setProfileBusy(false) }
  }

  async function handleAvatarUpload(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !authUser || !profile) return
    if (!file.type.startsWith('image/')) { setProfileError(t('imageOnly')); return }
    if (file.size > 5 * 1024 * 1024) { setProfileError(t('imageTooLarge')); return }
    setProfileBusy(true); setProfileError('')
    try {
      const oldPath = profile.avatar_path
      const path = await uploadAvatar(authUser.id, file)
      const updated = await updateProfile(authUser.id, { display_name: profile.display_name, username: profile.username, avatar_path: path })
      setProfile(updated)
      if (oldPath) await removeAvatar(oldPath).catch((error: unknown) => console.error(error))
    } catch (error) { setProfileError(errorText(error, t('genericError'))) }
    finally { setProfileBusy(false) }
  }

  async function handleBannerUpload(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !authUser || !profile) return
    if (!file.type.startsWith('image/')) { setProfileError(t('imageOnly')); return }
    if (file.size > 5 * 1024 * 1024) { setProfileError(t('imageTooLarge')); return }
    setProfileBusy(true); setProfileError('')
    try {
      const oldPath = profile.banner_path
      const path = await uploadAvatar(authUser.id, file)
      let updated: Profile
      try { updated = await updateProfile(authUser.id, { banner_path: path }) }
      catch (error) { await removeAvatar(path).catch(() => undefined); throw error }
      setProfile(updated)
      if (oldPath) await removeAvatar(oldPath).catch((error: unknown) => console.error(error))
    } catch (error) { setProfileError(errorText(error, t('genericError'))) }
    finally { setProfileBusy(false) }
  }

  if (!supabaseConfigured || !supabase) return (
    <main className="supabase-setup-screen"><section className="setup-panel">
      <div className="auth-brand"><BrandLogo /><span>CLARY</span></div>
      <p className="eyebrow">{t('setupEyebrow')}</p><h1>{t('setupTitle')}</h1>
      <p>{t('setupHint')}</p>
      <div className="setup-code"><code>VITE_SUPABASE_URL=https://tu-proyecto.supabase.co</code><code>VITE_SUPABASE_ANON_KEY=tu-clave-publishable</code></div>
      <p className="setup-footnote">{t('setupSecretWarning')}</p>
    </section></main>
  )

  if (authLoading) return <main className="auth-loading"><span className="loading-mark"><Sparkles size={20} /></span><p>{t('voiceConnecting')}</p></main>

  if (!authUser) return (
    <main className="auth-screen">
      <section className="auth-aside"><div className="auth-brand"><BrandLogo /><span>CLARY</span></div>
        <div className="auth-message"><p className="eyebrow">{t('authTagline').toUpperCase()}</p><h1>CLARY</h1><p className="auth-description">{t('loginHint')}</p></div>
        <div className="auth-aside-footer"><ShieldCheck size={16} /> {t('authTagline')}</div><div className="auth-pattern" aria-hidden="true"><span /><span /><span /><span /></div>
      </section>
      <section className="auth-main"><div className="auth-form-wrap">
        <div className="auth-mobile-brand"><BrandLogo /><span>CLARY</span></div>
        <p className="eyebrow">{t(authMode === 'login' ? 'loginEyebrow' : 'registerEyebrow')}</p><h2>{t(authMode === 'login' ? 'loginTitle' : 'registerTitle')}</h2>
        <p className="auth-hint">{t(authMode === 'login' ? 'loginHint' : 'registerHint')}</p>
        <form className="auth-form" onSubmit={handleAuth}>
          {authMode === 'register' && <label>{t('displayName')}<input required autoComplete="name" maxLength={80} value={displayNameInput} onChange={(event) => setDisplayNameInput(event.target.value)} /></label>}
          <label>{t('email')}<input required type="email" autoComplete="email" value={emailInput} onChange={(event) => setEmailInput(event.target.value)} /></label>
          <label>{t('password')}<input required minLength={8} type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder={t('passwordHint')} /></label>
          {authMode === 'login' && <div className="remember-row"><label><input type="checkbox" checked={rememberMe} onChange={(event) => { const checked = event.target.checked; setRememberMe(checked); if (!checked) localStorage.removeItem('clary.rememberedEmail') }} />{t('rememberMe')}</label><span>{t('rememberMeHelp')}</span></div>}
          {authError && <p className="auth-feedback error-feedback" role="alert">{authError}</p>}{authNotice && <p className="auth-feedback notice-feedback" role="status">{authNotice}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={authBusy}>{authBusy ? t('voiceConnecting') : t(authMode === 'login' ? 'loginButton' : 'registerButton')}<ArrowRight size={17} /></button>
        </form>
        <p className="auth-switch">{t(authMode === 'login' ? 'noAccount' : 'hasAccount')}{' '}<button type="button" onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); setAuthNotice('') }}>{t(authMode === 'login' ? 'register' : 'signIn')}</button></p>
        <p className="demo-note">{t('authFooter')}</p>
      </div></section>
    </main>
  )

  return (
    <main className={`app-shell ${navOpen ? 'nav-open' : ''}`} onClick={() => { setContextMenu(null); setWorkspaceContextMenu(null); setPresenceContextMenu(null) }}>
      <button className="mobile-scrim" type="button" aria-label={t('closeNavigation')} onClick={() => setNavOpen(false)} />
      <aside className="workspace-rail" aria-label={t('workspaceSection')}>
        <div className="rail-logo" aria-label="CLARY"><BrandLogo className="rail-brand-image" /></div><div className="rail-divider" />
        {workspaces.map((workspace, index) => <button key={workspace.id} className={`workspace-tile ${workspace.id === activeWorkspaceId ? 'selected' : ''}`} style={{ '--workspace-color': colors[index % colors.length] } as CSSProperties} type="button" title={workspace.name} onClick={() => { setActiveWorkspaceId(workspace.id); setActiveRoomId(workspace.channels[0]?.id ?? ''); setNavOpen(false) }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setWorkspaceContextMenu({ workspace, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 110) }) }}><span>{workspace.icon_path ? <img src={avatarUrl(workspace.icon_path) ?? undefined} alt="" /> : workspace.initials}</span></button>)}
        <button className="rail-add" type="button" title={t('createWorkspace')} onClick={(event) => { event.stopPropagation(); setCreationMode('workspace'); setCreationName('') }}><Plus size={19} /></button><div className="rail-spacer" />
      </aside>
      <aside className="workspace-nav">
        <div className="workspace-heading">
          {activeWorkspace ? <div className="workspace-heading-current"><span className="workspace-heading-mark" style={{ backgroundColor: activeWorkspace.color }}>{activeWorkspace.icon_path ? <img src={avatarUrl(activeWorkspace.icon_path) ?? undefined} alt="" /> : activeWorkspace.initials}</span><span className="workspace-heading-name">{activeWorkspace.name}</span></div> : <button className="workspace-select" type="button" onClick={() => { setCreationMode('workspace'); setCreationName('') }}><span className="workspace-heading-name">{t('createFirstWorkspaceTitle')}</span><Plus size={16} /></button>}
        </div>
        <div className="nav-search"><Search size={16} /><input aria-label={t('search')} placeholder={t('search')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="nav-scroll">
          <div className="nav-section-label"><span>{t('channelSection')}</span><button type="button" title={t('createChannel')} disabled={!activeWorkspace} onClick={() => { setCreationMode('channel'); setCreationName('') }}><Plus size={16} /></button></div>
          <nav className="conversation-nav" aria-label={t('channelSection')}>{channels.map((room) => <div className={`channel-row ${room.id === activeRoomId ? 'active' : ''}`} key={room.id}><button className={`conversation-link ${room.id === activeRoomId ? 'active' : ''}`} type="button" onClick={() => { setActiveRoomId(room.id); setNavOpen(false) }}><Hash size={16} /><span>{room.title}</span></button>{room.created_by === authUser.id && <button className="channel-settings-button" type="button" title={t('channelSettings')} aria-label={`${t('channelSettings')}: ${room.title}`} onClick={() => { const channel = activeWorkspace?.channels.find((item) => item.id === room.id); if (channel) openChannelSettings(channel) }}><Settings size={15} /></button>}</div>)}{channels.length === 0 && <p className="empty-nav">{dataLoading ? t('loading') : t('emptyChannels')}</p>}</nav>
          <div className="nav-section-label voice-label"><span>{t('voiceSection')}</span><button type="button" title={t('createVoiceChannel')} disabled={!activeWorkspace} onClick={() => { setCreationMode('voice'); setCreationName('') }}><Plus size={16} /></button></div>
          <nav className="conversation-nav" aria-label={t('voiceSection')}>{voiceChannels.map((room) => {
            const activeMembers = voiceRoomId === room.id
              ? voice.participants.map((participant) => ({ id: participant.id, username: participant.username, display_name: participant.displayName, avatar_path: participant.avatarPath }))
              : voicePresence[room.id] ?? []
            const members = [...(voiceRoomId === room.id && profile ? [{ id: profile.id, username: profile.username, display_name: profile.display_name, avatar_path: profile.avatar_path }] : []), ...activeMembers]
            return <div className={`channel-row ${room.id === activeRoomId ? 'active' : ''}`} key={room.id}>
              <button className={`conversation-link ${room.id === activeRoomId ? 'active' : ''}`} type="button" onClick={() => { setActiveRoomId(room.id); setNavOpen(false) }}><Volume2 size={16} /><span>{room.name}</span></button>
              {members.length > 0 && <span className="voice-sidebar-members" title={members.map((member) => member.display_name).join(', ')} aria-label={`${members.length} ${t('memberCount')}`}>
                {members.slice(0, 3).map((member) => <PersonAvatar key={member.id} profile={member} className="voice-sidebar-avatar" />)}{members.length > 3 && <span className="voice-sidebar-overflow">+{members.length - 3}</span>}
              </span>}
              {voiceRoomId === room.id && <span className="voice-sidebar-active" title={t('voiceConnected')} />}
              {room.created_by === authUser.id && <button className="channel-settings-button" type="button" title={t('channelSettings')} aria-label={`${t('channelSettings')}: ${room.name}`} onClick={() => openChannelSettings(room)}><Settings size={15} /></button>}
            </div>
          })}{voiceChannels.length === 0 && <p className="empty-nav">{t('emptyVoiceChannels')}</p>}</nav>
          <div className="nav-section-label direct-label"><span>{t('directSection')}</span><button type="button" title={t('newMessage')} onClick={() => { setCreationMode('direct'); setCreationName(''); setCreationMembers('') }}><Plus size={16} /></button></div>
          <nav className="conversation-nav" aria-label={t('directSection')}>{directRooms.map((room) => <button key={room.id} className={`conversation-link direct-link ${room.id === activeRoomId ? 'active' : ''}`} type="button" onClick={() => { setActiveRoomId(room.id); setNavOpen(false) }}>{room.profile ? <PersonAvatar profile={room.profile} className="mini-avatar" color={room.color} /> : <span className="mini-avatar" style={{ '--avatar-color': room.color } as CSSProperties}><Users size={13} /></span>}<span className="direct-name">{room.title}</span></button>)}{directRooms.length === 0 && <p className="empty-nav">{t('emptyDirects')}</p>}</nav>
        </div>
        <div className="profile-area" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setPresenceContextMenu({ x: Math.min(event.clientX, window.innerWidth - 200), y: Math.min(event.clientY, window.innerHeight - 190) }) }}>
          <button className="profile-trigger" type="button" onClick={openProfile}><span className="profile-presence-avatar"><PersonAvatar profile={profile} className="profile-avatar" /><span className={`presence-dot ${presenceClass({ presence_status: ownPresenceStatus, last_seen_at: profile?.last_seen_at ?? null })}`} /></span><span className="profile-copy"><strong>{profile?.display_name ?? t('profile')}</strong><span>@{profile?.username ?? ''}</span></span></button>
          <button className="icon-button settings-trigger" type="button" title={t('settings')} aria-label={t('settings')} onClick={(event) => { event.stopPropagation(); setProfileNameInput(profile?.display_name ?? ''); setProfileUsernameInput(profile?.username ?? ''); setProfileError(''); setSettingsSection('profile'); setSettingsOpen(true); setNavOpen(false) }}><Settings size={17} /></button>
        </div>
      </aside>

      <section className="chat-panel">
        {settingsOpen ? <SettingsScreen section={settingsSection} onSectionChange={setSettingsSection} onClose={() => setSettingsOpen(false)} profile={profile} authUser={authUser} language={language} setLanguage={(nextLanguage) => { localStorage.setItem('clary.language', nextLanguage); setLanguage(nextLanguage) }} theme={theme} setTheme={setTheme} devices={availableDevices} audioInputId={audioInputDeviceId} audioOutputId={audioOutputDeviceId} cameraDeviceId={cameraDeviceId} voice={voice} onAudioInput={handleAudioInputChange} onAudioOutput={handleAudioOutputChange} onCameraDevice={handleCameraDeviceChange} onSignOut={() => void handleSignOut()} onDeleteAccount={() => void handleDeleteAccount()} accountError={dataError} profileName={profileNameInput} setProfileName={setProfileNameInput} profileUsername={profileUsernameInput} setProfileUsername={setProfileUsernameInput} profileBusy={profileBusy} profileError={profileError} onProfileSubmit={handleProfileSave} avatarInputRef={avatarInputRef} bannerInputRef={bannerInputRef} onAvatarChange={handleAvatarUpload} onBannerChange={handleBannerUpload} cameraFilter={cameraFilter} setCameraFilter={(filter) => { localStorage.setItem('clary.cameraFilter', filter); setCameraFilter(filter) }} t={t} /> : <>
        {!(voiceRoomId && activeRoom?.id === voiceRoomId && showCallStage) && <header className="chat-topbar"><button className="mobile-menu-button" type="button" aria-label={t('workspaceSection')} onClick={() => setNavOpen(true)}><Menu size={20} /></button>
          {activeRoom?.kind === 'channel' ? <span className="title-symbol"><Hash size={19} /></span> : activeRoom?.kind === 'voice' ? <span className="title-symbol"><Volume2 size={19} /></span> : activeRoom?.profile ? <PersonAvatar profile={activeRoom.profile} className="title-avatar" color={activeRoom.color} /> : <span className="title-avatar" style={{ backgroundColor: activeRoom?.color ?? '#e9eee8' }}><Users size={15} /></span>}
          <div className="topbar-title"><h1>{activeRoom?.title ?? t('conversationTitle')}</h1><p>{activeRoom?.purpose ?? (activeWorkspace ? activeWorkspace.name : t('createFirstWorkspaceTitle'))}</p></div>
          {activeRoom?.kind === 'direct' && activeRoom.profile && <button className="call-button" type="button" title={t('callUser')} aria-label={t('callUser')} onClick={() => { if (voiceRoomId === activeRoom.id) { setShowCallStage(true); return } const direct = directs.find((room) => room.id === activeRoom.id); if (direct) void startDirectCall(direct) }}><Phone size={17} /><span>{t('callUser')}</span></button>}
        </header>}
        {inviteNotice && <div className="invite-notice" role="status">{inviteNotice}<button type="button" aria-label={t('close')} onClick={() => setInviteNotice('')}><X size={15} /></button></div>}
        {(dataError || voiceError || voice.error) && <div className="data-error" role="alert">{voiceError || voiceStatusError || dataError}<button type="button" aria-label={t('close')} onClick={() => { setDataError(''); setVoiceError('') }}><X size={15} /></button></div>}
        {voiceRoomId && voice.participants.map((participant) => <VoiceAudio key={participant.id} participant={participant} outputDeviceId={audioOutputDeviceId} />)}
        {voiceRoomId && activeRoom?.id === voiceRoomId && (activeRoom.kind === 'voice' || showCallStage) ? <CallStage room={activeRoom} profile={profile} voice={voice} voiceError={voiceStatusError} outputDeviceId={audioOutputDeviceId} devices={availableDevices} audioInputId={audioInputDeviceId} cameraDeviceId={cameraDeviceId} cameraFilter={cameraFilter} onAudioInput={(id) => void handleAudioInputChange(id)} onAudioOutput={handleAudioOutputChange} onCameraDevice={(id) => void handleCameraDeviceChange(id)} onToggleCamera={() => void handleCameraToggle()} onHangup={stopVoice} onShowChat={() => setShowCallStage(false)} t={t} /> : activeRoom?.kind === 'voice' ? <div className="voice-room-screen"><span className="intro-icon"><Volume2 size={21} /></span><h2>{activeRoom.title}</h2><p>{activeRoom.purpose}</p><button className="primary-button voice-join-button" type="button" disabled={voice.connecting} onClick={() => { setVoiceError(''); setVoiceRoomId(activeRoom.id); setShowCallStage(true) }}>{t('voiceJoin')}<Volume2 size={17} /></button></div> : activeRoom ? <>
          <div className="message-scroller">
            {activeRoom.kind !== 'channel' && <div className="channel-intro"><span className="intro-icon">{activeRoom.kind === 'group' ? <Users size={20} /> : <MessageCircle size={20} />}</span><h2>{`${t('directConversationIntro')} ${activeRoom.title}`}</h2><p>{activeRoom.purpose}</p></div>}
            <div className="date-divider"><span>{t('messagesHeading')}</span></div>
            <div className="message-list">
              {messagesLoading && messages.length === 0 && <p className="empty-conversation">{t('loadingMessages')}</p>}
              {messages.map((message) => <article key={message.id} className="message-row" onContextMenu={(event) => {
                if (message.author_id !== authUser.id || message.deleted_at) return
                event.preventDefault()
                setContextMenu({ message, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 70) })
              }}>
                <ProfilePopover profile={message.author} className="profile-hover-avatar"><PersonAvatar profile={message.author} className="message-avatar" /></ProfilePopover>
                <div className="message-body"><div className="message-meta"><ProfilePopover profile={message.author} className="profile-hover-name"><strong>{message.author.display_name}</strong></ProfilePopover><span className="message-username">@{message.author.username}</span><time dateTime={message.created_at} title={new Date(message.created_at).toLocaleString(locale)}>{new Date(message.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time></div>
                  {message.deleted_at ? <p className="deleted-message">{t('deletedMessage')}</p> : message.content && <p>{renderMessageContent(message.content)}</p>}
                      {!message.deleted_at && message.attachment_url && <div className="message-attachment">{message.attachment_mime?.startsWith('image/') && <a className="attachment-preview" href={message.attachment_url} target="_blank" rel="noreferrer"><img src={message.attachment_url} alt={message.attachment_name ?? t('attachFile')} loading="lazy" /></a>}<a className="attachment-file" href={message.attachment_url} target="_blank" rel="noreferrer" download={message.attachment_name ?? undefined}>{message.attachment_mime?.startsWith('image/') ? <ImagePlus size={15} /> : <FileText size={15} />}<span>{message.attachment_name ?? t('attachFile')}</span><Download size={14} /></a></div>}
                </div>
              </article>)}
              {!messagesLoading && messages.length === 0 && <div className="empty-conversation"><MessageCircle size={22} /><p>{t('messageEmpty')}</p></div>}
            </div>
          </div>
          <div className="composer-wrap">
            {mentionRange && mentionCandidates.length > 0 && <div className="mention-suggestions" role="listbox" aria-label="Mencionar a una persona">{mentionCandidates.map((member, index) => <button key={member.id} className={index === mentionIndex ? 'selected' : ''} type="button" role="option" aria-selected={index === mentionIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(member)}><span className="mention-avatar-wrap"><PersonAvatar profile={member} className="mention-avatar" /><i className={`presence-dot ${presenceClass(member)}`} /></span><span className="mention-copy"><strong>{member.display_name}</strong><small>@{member.username}</small></span><span className="mention-presence-label">{member.presence_status === 'busy' ? 'Ocupado' : member.presence_status === 'offline' ? 'Desconectado' : member.presence_status === 'away' ? 'Ausente' : 'En línea'}</span></button>)}</div>}
            <form className="composer" onSubmit={handleSend}>
            <textarea ref={composerRef} aria-label={t('sendHint')} placeholder={`${t('sendHintMobile')} ${activeRoom.kind === 'channel' ? `#${activeRoom.title}` : activeRoom.title}`} value={draft} maxLength={10000} onChange={(event) => updateDraft(event.target.value, event.currentTarget.selectionStart)} onKeyDown={(event) => {
              if (mentionRange && mentionCandidates.length > 0 && event.key === 'ArrowDown') { event.preventDefault(); setMentionIndex((index) => (index + 1) % mentionCandidates.length); return }
              if (mentionRange && mentionCandidates.length > 0 && event.key === 'ArrowUp') { event.preventDefault(); setMentionIndex((index) => (index - 1 + mentionCandidates.length) % mentionCandidates.length); return }
              if (mentionRange && mentionCandidates.length > 0 && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) { event.preventDefault(); insertMention(mentionCandidates[mentionIndex]); return }
              if (event.key === 'Escape' && mentionRange) { setMentionRange(null); return }
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
            }} rows={2} />
            <div className="composer-footer"><span>{uploadingFile ? t('loading') : t('sendHint')}</span><div className="composer-actions">
              <input ref={fileInputRef} className="visually-hidden" type="file" accept="image/*,video/*,audio/*,application/pdf,text/plain,.zip,.doc,.docx,.xlsx,.pptx" onChange={(event) => void handleFileUpload(event)} />
              <button className="attach-button" type="button" title={t('attachFile')} aria-label={t('attachFile')} disabled={uploadingFile} onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button>
              <button className="send-button" type="submit" disabled={!draft.trim() || uploadingFile} title={t('sendButton')} aria-label={t('sendButton')}><Send size={17} /></button>
            </div></div>
            </form>
          </div>
        </> : <div className="empty-workspace"><span className="intro-icon"><Sparkles size={21} /></span><h2>{dataLoading ? t('loading') : workspaces.length ? t('conversationSelect') : t('createFirstWorkspace')}</h2><p>{t('workspaceIntro')}</p>{!workspaces.length && <button className="primary-button" type="button" onClick={() => { setCreationMode('workspace'); setCreationName('') }}>{t('createWorkspace')}<ArrowRight size={16} /></button>}</div>}
        </>}
      </section>

      {workspaceContextMenu && <div className="message-context-menu workspace-context-menu" style={{ left: workspaceContextMenu.x, top: workspaceContextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => openWorkspaceEditor(workspaceContextMenu.workspace)}><Pencil size={15} />Editar espacio</button><button type="button" role="menuitem" onClick={() => void handleCreateWorkspaceInvite(workspaceContextMenu.workspace)}><Link size={15} />Crear invitación</button><button type="button" role="menuitem" onClick={() => toggleWorkspaceMute(workspaceContextMenu.workspace)}><Volume2 size={15} />{mutedWorkspaceIds.includes(workspaceContextMenu.workspace.id) ? 'Activar notificaciones' : 'Silenciar espacio'}</button></div>}
      {presenceContextMenu && <div className="message-context-menu presence-context-menu" style={{ left: presenceContextMenu.x, top: presenceContextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}><p>Estado</p>{([{ id: 'online', label: 'En línea' }, { id: 'away', label: 'Ausente' }, { id: 'busy', label: 'Ocupado' }, { id: 'offline', label: 'Desconectado' }] as const).map((status) => <button key={status.id} type="button" role="menuitemradio" aria-checked={ownPresenceStatus === status.id} onClick={() => void changePresenceStatus(status.id)}><i className={`presence-dot ${status.id}`} />{status.label}{ownPresenceStatus === status.id && <Check size={14} />}</button>)}</div>}
      {contextMenu && <div className="message-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}><button type="button" role="menuitem" onClick={() => void handleDeleteMessage(contextMenu.message)}><Trash2 size={15} />{t('deleteMessage')}</button></div>}
      {editingWorkspace && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !workspaceBusy) setEditingWorkspace(null) }}><section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-edit-title"><button className="modal-close icon-button" type="button" title={t('close')} aria-label={t('close')} disabled={workspaceBusy} onClick={() => setEditingWorkspace(null)}><X size={18} /></button><span className="modal-icon"><Pencil size={19} /></span><p className="eyebrow">CLARY</p><h2 id="workspace-edit-title">Editar espacio</h2><form onSubmit={handleWorkspaceSave}><label>Nombre del espacio<input autoFocus required maxLength={80} value={workspaceNameInput} onChange={(event) => setWorkspaceNameInput(event.target.value)} /></label><label>Icono del espacio<input ref={workspaceIconInputRef} type="file" accept="image/*" onChange={(event) => setWorkspaceIconFile(event.currentTarget.files?.[0] ?? null)} /></label>{workspaceError && <p className="auth-feedback error-feedback" role="alert">{workspaceError}</p>}<button className="primary-button modal-submit" type="submit" disabled={workspaceBusy || !workspaceNameInput.trim()}>{workspaceBusy ? t('saving') : t('saveChanges')}<Check size={16} /></button></form></section></div>}
      {workspaceInviteLink && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceInviteLink('') }}><section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-invite-title"><button className="modal-close icon-button" type="button" title={t('close')} aria-label={t('close')} onClick={() => setWorkspaceInviteLink('')}><X size={18} /></button><span className="modal-icon"><Link size={19} /></span><p className="eyebrow">CLARY</p><h2 id="workspace-invite-title">Invitar al espacio</h2><p className="modal-description">El enlace es de un solo uso y caduca el {workspaceInviteExpiry}.</p><label>Enlace de invitación<input readOnly value={workspaceInviteLink} onFocus={(event) => event.currentTarget.select()} /></label><button className="primary-button modal-submit" type="button" onClick={() => void copyWorkspaceInvite()}>{inviteCopied ? <><Check size={16} />Copiado</> : <><Copy size={16} />Copiar enlace</>}</button></section></div>}
      {editingChannel && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !channelSaving) setEditingChannel(null) }}><section className="creation-modal channel-settings-modal" role="dialog" aria-modal="true" aria-labelledby="channel-settings-title">
        <button className="modal-close icon-button" type="button" title={t('close')} aria-label={t('close')} disabled={channelSaving} onClick={() => setEditingChannel(null)}><X size={18} /></button>
        <span className="modal-icon"><Settings size={20} /></span><p className="eyebrow">CLARY</p><h2 id="channel-settings-title">{t('channelSettings')}</h2>
        <form onSubmit={handleChannelSave}>
          <label>{t('channelName')}<input autoFocus required maxLength={80} value={channelName} onChange={(event) => setChannelName(event.target.value)} /></label>
          <label>{t('channelDescription')}<textarea maxLength={1000} rows={3} value={channelDescription} onChange={(event) => setChannelDescription(event.target.value)} /></label>
          {channelError && <p className="auth-feedback error-feedback" role="alert">{channelError}</p>}
          <button className="primary-button modal-submit" type="submit" disabled={channelSaving || !channelName.trim()}>{channelSaving ? t('saving') : t('saveChanges')}<Check size={16} /></button>
        </form>
        <div className="channel-delete-zone">
          {channelDeleteConfirm ? <><p>Se eliminarán el canal y todos sus mensajes y archivos. Esta acción no se puede deshacer.</p><div className="channel-delete-actions"><button type="button" disabled={channelSaving} onClick={() => setChannelDeleteConfirm(false)}>Cancelar</button><button type="button" className="channel-delete-confirm" disabled={channelSaving} onClick={() => void handleChannelDelete()}>{channelSaving ? t('saving') : 'Eliminar definitivamente'}<Trash2 size={15} /></button></div></> : <button type="button" className="channel-delete-trigger" disabled={channelSaving} onClick={() => setChannelDeleteConfirm(true)}><Trash2 size={15} />Eliminar canal</button>}
        </div>
      </section></div>}
      {incomingCall && <div className="modal-backdrop call-backdrop"><section className="creation-modal incoming-call-modal" role="alertdialog" aria-modal="true" aria-labelledby="incoming-call-title"><span className="modal-icon call-ringing"><Phone size={20} /></span><p className="eyebrow">{t('incomingCall')}</p><h2 id="incoming-call-title">{incomingCall.callerName}</h2><p className="modal-description">{t('voiceCall')}</p><div className="incoming-call-actions"><button className="decline-call-button" type="button" onClick={() => void declineIncomingCall()}><PhoneOff size={17} />{t('declineCall')}</button><button className="accept-call-button" type="button" onClick={() => void acceptIncomingCall()}><Phone size={17} />{t('acceptCall')}</button></div></section></div>}
      {creationMode && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreationMode(null) }}><section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="creation-title">
        <button className="modal-close icon-button" type="button" title={t('close')} aria-label={t('close')} onClick={() => setCreationMode(null)}><X size={18} /></button><span className="modal-icon">{creationMode === 'workspace' ? <Sparkles size={20} /> : creationMode === 'channel' ? <Hash size={20} /> : creationMode === 'voice' ? <Volume2 size={20} /> : <MessageCircle size={20} />}</span>
        <p className="eyebrow">CLARY</p><h2 id="creation-title">{t(creationMode === 'workspace' ? 'createSpaceTitle' : creationMode === 'channel' ? 'createChannelTitle' : creationMode === 'voice' ? 'createVoiceChannelTitle' : creationMode === 'invite' ? 'inviteTitle' : 'newMessageTitle')}</h2><p className="modal-description">{t(creationMode === 'workspace' ? 'createSpaceHint' : creationMode === 'channel' ? 'createChannelHint' : creationMode === 'voice' ? 'createVoiceChannelHint' : creationMode === 'invite' ? 'inviteHint' : 'newMessageHint')}</p>
        <form onSubmit={handleCreate}>{creationMode === 'direct' && <label className="group-toggle"><input type="checkbox" checked={newGroup} onChange={(event) => setNewGroup(event.target.checked)} /> {t('createGroup')}</label>}
          <label>{t(creationMode === 'workspace' ? 'spaceName' : creationMode === 'channel' ? 'channelName' : creationMode === 'voice' ? 'voiceChannelName' : creationMode === 'invite' ? 'inviteUser' : newGroup ? 'groupName' : 'username')}<input autoFocus required value={creationName} onChange={(event) => setCreationName(event.target.value)} /></label>
          {creationMode === 'direct' && newGroup && <label>{t('groupUsers')}<input required value={creationMembers} onChange={(event) => setCreationMembers(event.target.value)} /></label>}
          <button className="primary-button modal-submit" type="submit" disabled={dataLoading}>{dataLoading ? t('saving') : t(creationMode === 'workspace' ? 'createSpaceAction' : creationMode === 'channel' ? 'createChannelAction' : creationMode === 'voice' ? 'createVoiceChannelAction' : creationMode === 'invite' ? 'inviteAction' : 'openConversation')}<ArrowRight size={16} /></button>
        </form>
      </section></div>}
    </main>
  )
}

export default SupabaseApp