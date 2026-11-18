import { startTransition, useEffect, useState } from 'react'
import { createAudioActivityDetector } from '../lib/audioActivity'

export function useSpeaking(stream: MediaStream | null | undefined, muted = false): boolean {
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    startTransition(() => setSpeaking(false))
    const track = stream?.getAudioTracks().find((item) => item.readyState === 'live')
    if (!track || muted) return

    let context: AudioContext | undefined
    let source: MediaStreamAudioSourceNode | undefined
    let frame = 0
    let previous = false
    let disposed = false

    try {
      context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      source = context.createMediaStreamSource(new MediaStream([track]))
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const detect = createAudioActivityDetector()

      const sample = (now: number) => {
        if (disposed) return
        analyser.getFloatTimeDomainData(samples)
        const next = track.enabled && track.readyState === 'live' && detect(samples, now)
        if (next !== previous) {
          previous = next
          setSpeaking(next)
        }
        frame = requestAnimationFrame(sample)
      }

      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      frame = requestAnimationFrame(sample)
    } catch {
      if (context) void context.close().catch(() => undefined)
      return
    }

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      source?.disconnect()
      if (context) void context.close().catch(() => undefined)
    }
  }, [stream, muted])

  return Boolean(!muted && stream?.getAudioTracks().some((track) => track.enabled && track.readyState === 'live') && speaking)
}