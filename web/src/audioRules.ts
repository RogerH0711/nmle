import type { PlayerTitle } from './player'

// 聲音的規則（不碰瀏覽器 API，可以單獨測試）；播放在 audio.ts。

export interface AudioSettings {
  enabled: boolean // 總開關：預設關，朋友多半在圖書館或通勤時用
  bgm: number // 0–1
  sfx: number
  voice: number
}

export const DEFAULT_AUDIO: AudioSettings = { enabled: false, bgm: 0.4, sfx: 0.6, voice: 0.8 }

const clamp = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback

/** 從瀏覽器讀回來的設定可能是舊版或壞掉的，補上預設值 */
export function normalizeAudio(raw: unknown): AudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AudioSettings, unknown>>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_AUDIO.enabled,
    bgm: clamp(r.bgm, DEFAULT_AUDIO.bgm),
    sfx: clamp(r.sfx, DEFAULT_AUDIO.sfx),
    voice: clamp(r.voice, DEFAULT_AUDIO.voice),
  }
}

/**
 * 現在該放哪一首 BGM（曲目 id，對應 data/audio/manifest.json 的 bgm）。
 * 一般模式和模擬考作答中不放：一般模式是給不想看 galgame 的人，模擬考要和考場一樣安靜。
 */
export function chooseBgm(s: {
  characterMode: boolean
  mockRunning: boolean
  story: { character: string; bgm?: string } | null // 正在播的劇情；劇情可以指定曲目，沒指定就用她的主題曲
  onMap: boolean // 在校園地圖、排行榜、模擬考首頁這些「不在讀書」的畫面
  runKind: string | null
  runCharacter: string | null
}): string | null {
  if (!s.characterMode || s.mockRunning) return null
  if (s.story) return s.story.bgm ?? `theme_${s.story.character}`
  if (s.onMap) return 'map'
  if (s.runKind === 'character' && s.runCharacter) return `theme_${s.runCharacter}`
  if (s.runKind === 'review') return 'library'
  return 'map'
}

// 有 {player} 的台詞要錄學弟、學妹兩個版本，檔名加上 .m / .f
const PLAYER_VOICE: Record<PlayerTitle, string> = { 學弟: 'm', 學妹: 'f' }

/** 這句台詞的語音要找哪幾個檔名（依序）：先找有稱呼的版本，再找共用的 */
export function voiceKeys(lineId: string, player: PlayerTitle) {
  return [`${lineId}.${PLAYER_VOICE[player]}`, lineId]
}
