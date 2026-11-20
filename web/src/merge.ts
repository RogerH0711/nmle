// 合併同一份紀錄的兩個版本（不依賴瀏覽器環境，方便測試）。
// 同一個網站開了好幾個分頁時，每個分頁各自把記憶體裡的紀錄寫回同一個 localStorage 鍵，
// 不合併的話後寫的分頁會蓋掉前一個分頁的作答。作答、模擬考、送禮都是只增不改、有 id 的紀錄，可以直接依 id 聯集。

/** 依 id 聯集；兩邊都有的那筆，只要一邊已同步就算已同步。依 time 排序。回傳 null 表示 incoming 沒有新東西 */
export function mergeRecords<T extends { id: string; synced: boolean }>(
  current: T[],
  incoming: T[],
  time: (r: T) => string,
): T[] | null {
  const byId = new Map(current.map((r) => [r.id, r]))
  let changed = false
  for (const r of incoming) {
    const mine = byId.get(r.id)
    if (!mine) {
      byId.set(r.id, r)
      changed = true
    } else if (r.synced && !mine.synced) {
      byId.set(r.id, { ...mine, synced: true })
      changed = true
    }
  }
  if (!changed) return null
  return [...byId.values()].sort((a, b) => time(a).localeCompare(time(b)))
}

/** 依 key 聯集（學姊傳的訊息）：兩邊都有的那則，只要一邊讀過就算讀過。保留 current 的順序，新的接在後面 */
export function mergeByKey<T extends { key: string; read: boolean }>(current: T[], incoming: T[]): T[] {
  const byKey = new Map(current.map((m) => [m.key, m]))
  for (const m of incoming) {
    const mine = byKey.get(m.key)
    if (!mine) byKey.set(m.key, m)
    else if (m.read && !mine.read) byKey.set(m.key, { ...mine, read: true })
  }
  return [...byKey.values()]
}
