import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { avatarUrl, type Profile } from './lib/claryData'

type ProfilePopoverProps = {
  profile: Profile
  children: ReactNode
  className?: string
}

export function ProfilePopover({ profile, children, className = '' }: ProfilePopoverProps) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popoverId = useId()

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }

  function open() {
    cancelClose()
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(280, window.innerWidth - 24)
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    const top = rect.bottom + 188 > window.innerHeight ? Math.max(12, rect.top - 188) : rect.bottom + 8
    setPosition({ left, top })
  }

  function closeSoon() {
    cancelClose()
    closeTimer.current = setTimeout(() => setPosition(null), 120)
  }

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  const image = profile.avatar_path ? avatarUrl(profile.avatar_path) : null
  const banner = profile.banner_path ? avatarUrl(profile.banner_path) : null
  const initials = profile.display_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?'
  const joined = profile.created_at ? new Date(profile.created_at).toLocaleDateString(document.documentElement.lang || undefined, { dateStyle: 'medium' }) : ''
  const memberSince = ({ es: 'Miembro desde', en: 'Member since', fr: 'Membre depuis', de: 'Mitglied seit', it: 'Membro dal', pt: 'Membro desde', ca: 'Membre des de', eu: 'Kide-data:', gl: 'Membro desde', nl: 'Lid sinds' } as Record<string, string>)[document.documentElement.lang] ?? 'Miembro desde'
  const status = profile.presence_status === 'busy' ? 'busy' : profile.presence_status === 'offline' ? 'offline' : profile.presence_status === 'away' ? 'away' : 'online'
  const statusLabel = ({ online: 'En línea', away: 'Ausente', busy: 'Ocupado', offline: 'Desconectado' } as Record<string, string>)[status]

  return <>
    <button ref={triggerRef} type="button" className={`profile-hover-trigger ${className}`} aria-label={profile.display_name} aria-describedby={position ? popoverId : undefined} onMouseEnter={open} onMouseLeave={closeSoon} onFocus={open} onBlur={closeSoon} onClick={open}>{children}</button>
    {position && createPortal(<div id={popoverId} className="profile-popover" role="tooltip" style={{ left: position.left, top: position.top }} onMouseEnter={cancelClose} onMouseLeave={closeSoon}>
      <div className="profile-popover-banner" style={banner ? { backgroundImage: `linear-gradient(90deg, #16231b66, transparent), url("${banner}")` } : undefined} />
      <div className="profile-popover-content">
        {image ? <img className="profile-popover-avatar" src={image} alt="" /> : <span className="profile-popover-avatar profile-popover-initials">{initials}</span>}
        <strong>{profile.display_name}</strong>
        <span>@{profile.username}</span>
        <span className="profile-popover-status"><i className={`presence-dot ${status}`} />{statusLabel}</span>
        {joined && <span className="profile-popover-joined">{memberSince} {joined}</span>}
      </div>
    </div>, document.body)}
  </>
}