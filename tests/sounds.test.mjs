import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { playHangupSound, playMessageSound, shouldPlayMessage, startRingtone, stopRingtone } from '../src/lib/sounds.ts'

const playedFrequencies = []
const originalAudioContext = globalThis.AudioContext

class TestAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}

  createOscillator() {
    const oscillator = {
      frequency: { value: 0 },
      connect() {},
      start() { playedFrequencies.push(oscillator.frequency.value) },
      stop() {},
    }
    return oscillator
  }

  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
  }
}

globalThis.AudioContext = TestAudioContext
after(() => {
  stopRingtone()
  globalThis.AudioContext = originalAudioContext
})

test('solo avisa de mensajes de otros usuarios', () => {
  assert.equal(shouldPlayMessage('autor', 'receptor'), true)
  assert.equal(shouldPlayMessage('receptor', 'receptor'), false)
  assert.equal(shouldPlayMessage('', 'receptor'), false)
})

test('mensaje y colgar reproducen tonos diferentes', () => {
  playedFrequencies.length = 0
  playMessageSound()
  playHangupSound()
  assert.deepEqual(playedFrequencies, [660, 880, 440, 330])
})

test('el timbre se repite y se detiene', (context) => {
  let callback
  const timer = { id: 'ring' }
  const intervals = context.mock.method(globalThis, 'setInterval', (handler) => { callback = handler; return timer })
  const clear = context.mock.method(globalThis, 'clearInterval', () => {})
  playedFrequencies.length = 0
  startRingtone()
  assert.equal(intervals.mock.calls.length, 1)
  callback()
  stopRingtone()
  assert.deepEqual(playedFrequencies, [440, 550, 440, 550])
  assert.equal(clear.mock.calls[0].arguments[0], timer)
})