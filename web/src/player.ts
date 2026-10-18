// 玩家的稱呼：學姊們叫你「學弟」還是「學妹」。台詞和劇情的 {player} 代入這個。
// 只存在瀏覽器（換裝置要再選一次），不影響作答紀錄和好感度。

export const PLAYER_TITLES = ['學弟', '學妹'] as const
export type PlayerTitle = (typeof PLAYER_TITLES)[number]
export const DEFAULT_PLAYER: PlayerTitle = '學弟'

const KEY = 'nmle.player.v1'

export function loadPlayer(): PlayerTitle | null {
  try {
    const v = localStorage.getItem(KEY)
    return (PLAYER_TITLES as readonly string[]).includes(v ?? '') ? (v as PlayerTitle) : null
  } catch {
    return DEFAULT_PLAYER // 讀不到瀏覽器儲存空間時不要每次都問
  }
}

export function savePlayer(title: PlayerTitle) {
  try {
    localStorage.setItem(KEY, title)
  } catch {
    // 存不了就只在這次有效
  }
}
