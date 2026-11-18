import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioRootMeanSquare, createAudioActivityDetector, isAboveSpeakingThreshold } from '../src/lib/audioActivity.ts'

test('el silencio y los buffers vacíos no activan el indicador', () => {
  assert.equal(audioRootMeanSquare(new Float32Array()), 0)
  assert.equal(isAboveSpeakingThreshold(new Float32Array(512), false), false)
})

test('la voz activa el indicador y el ruido bajo no lo activa', () => {
  assert.equal(isAboveSpeakingThreshold(new Float32Array(512).fill(0.06), false), true)
  assert.equal(isAboveSpeakingThreshold(new Float32Array(512).fill(0.01), false), false)
})

test('el umbral más bajo mantiene estable el indicador mientras habla', () => {
  const quietVoice = new Float32Array(512).fill(0.025)
  assert.equal(isAboveSpeakingThreshold(quietVoice, false), false)
  assert.equal(isAboveSpeakingThreshold(quietVoice, true), true)
})

test('mantiene el borde durante pausas cortas y lo apaga tras el silencio', () => {
  const detect = createAudioActivityDetector(300)
  const voice = new Float32Array(512).fill(0.06)
  const silence = new Float32Array(512)
  assert.equal(detect(voice, 1000), true)
  assert.equal(detect(silence, 1200), true)
  assert.equal(detect(silence, 1300), false)
})