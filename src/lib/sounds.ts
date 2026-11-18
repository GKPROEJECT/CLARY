type Note = { frequency: number; start: number; duration: number }

let audioContext: AudioContext | undefined
let ringingTimer: ReturnType<typeof setInterval> | undefined

export function prepareSounds() {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined)
  } catch {
    return
  }
}

export function shouldPlayMessage(authorId: string, userId: string) {
  return Boolean(authorId && userId && authorId !== userId)
}

function playNotes(notes: Note[]) {
  try {
    audioContext ??= new AudioContext()
    const context = audioContext
    if (context.state === 'suspended') void context.resume().catch(() => undefined)
    for (const note of notes) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + note.start
      oscillator.type = 'sine'
      oscillator.frequency.value = note.frequency
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + note.duration)
    }
  } catch { return }
}

export function playMessageSound() {
  playNotes([{ frequency: 660, start: 0, duration: 0.12 }, { frequency: 880, start: 0.12, duration: 0.18 }])
}

export function playHangupSound() {
  playNotes([{ frequency: 440, start: 0, duration: 0.15 }, { frequency: 330, start: 0.15, duration: 0.22 }])
}

export function startRingtone() {
  stopRingtone()
  const ring = () => playNotes([{ frequency: 440, start: 0, duration: 0.25 }, { frequency: 550, start: 0.3, duration: 0.25 }])
  ring()
  ringingTimer = setInterval(ring, 2500)
}

export function stopRingtone() {
  if (ringingTimer !== undefined) clearInterval(ringingTimer)
  ringingTimer = undefined
}