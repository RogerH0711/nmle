import { useSyncExternalStore } from 'react'
import { dataUrl } from './bank'
import { normalizeAudio, voiceKeys, type AudioSettings } from './audioRules'
import type { PlayerTitle } from './player'

// 聲音：音效、BGM、語音三個聲道，全部走 Web Audio。
// - 預設靜音，設定存在瀏覽器（audioRules.ts）。
// - 瀏覽器要使用者點過畫面才准出聲，所以第一次點擊或按鍵時才建立 AudioContext。
// - 音效用振盪器即時合成，不用音檔；BGM 和語音的音檔列在 data/audio/manifest.json，沒列的就不播。
// - 分頁切到背景時整個暫停；語音播放時 BGM 調小聲。

const SETTINGS_KEY = 'nmle.audio.v1'
const FADE = 1.2 // BGM 換曲時淡入淡出的秒數
const DUCK = 0.4 // 語音播放時 BGM 降到幾成

export interface Manifest {
  bgm: Record<string, { file: string; loopStart?: number; loopEnd?: number }> // 曲目 id → 檔案（相對於 data/audio/）
  voice: string[] // 有語音的台詞，檔案是 data/audio/voice/<id>.mp3
}

// ---------- 設定 ----------

function loadSettings(): AudioSettings {
  try {
    return normalizeAudio(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'))
  } catch {
    return normalizeAudio(null)
  }
}

let settings = loadSettings()
let manifest: Manifest = { bgm: {}, voice: [] }
const listeners = new Set<() => void>()
let snapshot = { settings, manifest }

function emit() {
  snapshot = { settings, manifest }
  listeners.forEach((l) => l())
}

export function useAudio() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot,
  )
}

export function setAudio(patch: Partial<AudioSettings>) {
  settings = normalizeAudio({ ...settings, ...patch })
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // 存不了就只在這次瀏覽有效
  }
  emit()
  if (settings.enabled) unlock()
  applyVolumes()
  void applyBgm()
  if (!settings.enabled) stopVoice()
}

void fetch(dataUrl('audio/manifest.json'))
  .then((r) => (r.ok ? (r.json() as Promise<Partial<Manifest>>) : ({} as Partial<Manifest>)))
  .then((m) => {
    manifest = { bgm: m.bgm ?? {}, voice: m.voice ?? [] }
    emit()
    void applyBgm()
  })
  .catch(() => {})

// ---------- AudioContext ----------

let ctx: AudioContext | null = null
let sfxGain: GainNode
let bgmGain: GainNode
let voiceGain: GainNode

function unlock() {
  if (!settings.enabled) return
  if (!ctx) {
    ctx = new AudioContext()
    const bus = (v: number) => {
      const g = ctx!.createGain()
      g.gain.value = v
      g.connect(ctx!.destination)
      return g
    }
    sfxGain = bus(settings.sfx)
    bgmGain = bus(settings.bgm)
    voiceGain = bus(settings.voice)
  }
  if (ctx.state !== 'suspended') void applyBgm()
  else if (!document.hidden) void ctx.resume().then(() => applyBgm())
}

for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { capture: true })

document.addEventListener('visibilitychange', () => {
  if (!ctx) return
  if (document.hidden) void ctx.suspend()
  else if (settings.enabled) void ctx.resume().then(() => applyBgm())
})

const running = () => !!ctx && ctx.state === 'running' && settings.enabled

function applyVolumes() {
  if (!ctx) return
  const t = ctx.currentTime
  sfxGain.gain.setTargetAtTime(settings.sfx, t, 0.05)
  bgmGain.gain.setTargetAtTime(settings.bgm * (voicePlaying ? DUCK : 1), t, 0.05)
  voiceGain.gain.setTargetAtTime(settings.voice, t, 0.05)
}

const buffers = new Map<string, Promise<AudioBuffer | null>>()
function loadBuffer(path: string) {
  let p = buffers.get(path)
  if (!p) {
    p = fetch(dataUrl(`audio/${path}`))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => ctx!.decodeAudioData(b))
      .catch(() => null)
    buffers.set(path, p)
  }
  return p
}

// ---------- 音效 ----------

export type Sfx = 'correct' | 'wrong' | 'streak' | 'unlock' | 'message' | 'gift'

// [頻率 Hz, 開始秒, 長度秒]，依序疊起來
const NOTES: Record<Sfx, { wave: OscillatorType; gain: number; notes: [number, number, number][] }> = {
  correct: { wave: 'triangle', gain: 0.5, notes: [[659, 0, 0.12], [880, 0.09, 0.22]] },
  wrong: { wave: 'triangle', gain: 0.45, notes: [[330, 0, 0.16], [262, 0.13, 0.28]] },
  streak: { wave: 'triangle', gain: 0.45, notes: [[1047, 0, 0.1], [1319, 0.08, 0.1], [1568, 0.16, 0.3]] },
  unlock: { wave: 'sine', gain: 0.5, notes: [[523, 0, 0.16], [659, 0.12, 0.16], [784, 0.24, 0.16], [1047, 0.36, 0.6]] },
  message: { wave: 'sine', gain: 0.4, notes: [[988, 0, 0.07], [1319, 0.08, 0.12]] },
  gift: { wave: 'sine', gain: 0.35, notes: [[1319, 0, 0.12], [1568, 0.07, 0.12], [2093, 0.14, 0.35]] },
}

export function sfx(name: Sfx) {
  if (!running()) return
  const { wave, gain, notes } = NOTES[name]
  const now = ctx!.currentTime
  for (const [freq, start, dur] of notes) {
    const osc = ctx!.createOscillator()
    const env = ctx!.createGain()
    osc.type = wave
    osc.frequency.value = freq
    // 很短的起音，再指數衰減，聽起來像敲鐘而不是嗶聲
    env.gain.setValueAtTime(0.0001, now + start)
    env.gain.exponentialRampToValueAtTime(gain, now + start + 0.01)
    env.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
    osc.connect(env).connect(sfxGain)
    osc.start(now + start)
    osc.stop(now + start + dur + 0.05)
  }
}

// ---------- BGM ----------

let wanted: string | null = null
let current: { id: string; source: AudioBufferSourceNode; gain: GainNode } | null = null
let token = 0 // 換曲時遞增，載入比較慢的舊曲目不會蓋掉新的

let settle: ReturnType<typeof setTimeout> | undefined

// 畫面切換時常常短暫經過別的畫面（例如劇情播完、題目載入前會回到地圖一下），
// 等一下再換曲，連續的切換只算最後一次，才不會來回淡入淡出
export function setBgm(id: string | null) {
  if (id === wanted) return
  wanted = id
  clearTimeout(settle)
  settle = setTimeout(() => void applyBgm(), 400)
}

function fadeOut() {
  if (!current || !ctx) return
  const { source, gain } = current
  gain.gain.setTargetAtTime(0, ctx.currentTime, FADE / 4)
  source.stop(ctx.currentTime + FADE)
  current = null
}

async function applyBgm() {
  const my = ++token
  if (!settings.enabled) return fadeOut()
  if (!running()) return // 還沒點過畫面，或分頁在背景（整個暫停中）：回來時再處理
  if (current?.id === wanted) return
  const track = wanted ? manifest.bgm[wanted] : undefined
  if (!wanted || !track) return fadeOut() // 這個畫面不放，或這首還沒做
  const id = wanted
  const buffer = await loadBuffer(track.file)
  if (my !== token || !buffer || !running()) return
  fadeOut()
  const source = ctx!.createBufferSource()
  source.buffer = buffer
  source.loop = true
  if (track.loopStart !== undefined) source.loopStart = track.loopStart
  if (track.loopEnd !== undefined) source.loopEnd = track.loopEnd
  const gain = ctx!.createGain()
  gain.gain.setValueAtTime(0, ctx!.currentTime)
  gain.gain.setTargetAtTime(1, ctx!.currentTime, FADE / 4)
  source.connect(gain).connect(bgmGain)
  source.start()
  current = { id, source, gain }
}

// ---------- 語音 ----------

let voice: AudioBufferSourceNode | null = null
let voicePlaying = false

export function stopVoice() {
  voice?.stop()
  voice = null
  if (!voicePlaying) return
  voicePlaying = false
  applyVolumes()
}

/** 播這句台詞的語音（有的話）。同時只有一句，新的會打斷舊的 */
export async function playVoice(lineId: string | null, player: PlayerTitle) {
  stopVoice()
  if (!lineId || !running()) return
  const key = voiceKeys(lineId, player).find((k) => manifest.voice.includes(k))
  if (!key) return
  const buffer = await loadBuffer(`voice/${key}.mp3`)
  if (!buffer || !running()) return
  stopVoice()
  const source = ctx!.createBufferSource()
  source.buffer = buffer
  source.connect(voiceGain)
  source.onended = () => {
    if (voice !== source) return
    voice = null
    voicePlaying = false
    applyVolumes()
  }
  voice = source
  voicePlaying = true
  applyVolumes()
  source.start()
}
