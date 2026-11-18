export const SPEAKING_START_THRESHOLD = 0.035
export const SPEAKING_CONTINUE_THRESHOLD = 0.018

export function audioRootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

export function isAboveSpeakingThreshold(samples: Float32Array, wasSpeaking: boolean): boolean {
  return audioRootMeanSquare(samples) >= (wasSpeaking ? SPEAKING_CONTINUE_THRESHOLD : SPEAKING_START_THRESHOLD)
}

export function createAudioActivityDetector(holdMilliseconds = 300) {
  let speaking = false
  let lastActiveAt = Number.NEGATIVE_INFINITY

  return (samples: Float32Array, now: number): boolean => {
    if (isAboveSpeakingThreshold(samples, speaking)) {
      lastActiveAt = now
      speaking = true
    } else if (now - lastActiveAt >= holdMilliseconds) {
      speaking = false
    }
    return speaking
  }
}