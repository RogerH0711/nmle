// 選項打亂（不依賴瀏覽器環境，方便測試）。做法見 docs/design.md「題庫瀏覽與搜尋」的「選項打亂」。
// 作答紀錄、正解、回報一律用原本的字母；只有畫面上的順序和字母換掉。
import type { Letter, Question } from './types'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']
const IDENTITY = [0, 1, 2, 3]

/** 畫面上第 i 個位置放原本的第 order[i] 個選項 */
export type Order = number[]

// 選項提到其他選項（「以上皆是」「選項 A 與 B」）的題目打亂會出錯。110–115 年沒有這種題目，留著防之後解析的年份。
// （不用 lookbehind：iOS 16.4 以前的 Safari 不支援，整支程式會載入失敗）
const REFERS_TO_OPTIONS =
  /以上(皆|均|都)|上述(皆|均|都|選項)|其他選項|選項\s*[A-DＡ-Ｄ](?![A-Za-z])|(^|[^A-Za-z])[A-DＡ-Ｄ]\s*[與和及、或]\s*[A-DＡ-Ｄ](?![A-Za-z])\s*(皆|均|都)/

/**
 * 能不能打亂：一題多解、官方註記（「第 88 題答Ａ、Ｂ給分」寫的是原本的字母）、一律給分、
 * 選項提到其他選項的題目維持原順序。
 */
export function canShuffle(q: Question) {
  return q.answers.length === 1 && !q.answer_note && !q.free_point && !q.options.some((o) => REFERS_TO_OPTIONS.test(o))
}

export function makeOrder(q: Question, random = Math.random): Order {
  if (!canShuffle(q)) return IDENTITY
  const a = [...IDENTITY]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 畫面上的字母 → 原本的字母 */
export function toOriginal(order: Order, shown: Letter): Letter {
  return LETTERS[order[LETTERS.indexOf(shown)]]
}

/** 原本的字母 → 畫面上的字母 */
export function toShown(order: Order, original: Letter): Letter {
  return LETTERS[order.indexOf(LETTERS.indexOf(original))]
}

/** 照畫面順序排好選項、正解換成畫面上的字母的題目（給題目卡片和「問 AI」用） */
export function shownQuestion(q: Question, order: Order): Question {
  return {
    ...q,
    options: order.map((i) => q.options[i]) as Question['options'],
    answers: q.answers.map((l) => toShown(order, l)),
  }
}

/**
 * 詳解裡的選項字母換成畫面上的字母，「選項解析」照畫面順序重排。
 * 換的寫法：項目開頭「- (A)」、內文「(A)」「（A）」「選項A」；前後接英數字的不換（V(D)J）。
 */
export function relabelExplanation(text: string, order: Order): string {
  if (order.every((v, i) => v === i)) return text
  const swap = (l: string) => toShown(order, l as Letter)
  const lines = text.split('\n').map((line) =>
    line
      .replace(/(^|[^A-Za-z0-9])([（(])([A-D])([)）])(?![A-Za-z0-9])/g, (_, pre, a, l, b) => `${pre}${a}${swap(l)}${b}`)
      .replace(/選項(\s*)([A-D])(?![A-Za-z0-9])/g, (_, s, l) => `選項${s}${swap(l)}`),
  )
  // 連續的「- (X)」項目照字母排序
  const head = (line: string) => /^\s*[-*]\s+[（(]([A-D])[)）]/.exec(line)?.[1]
  for (let i = 0; i < lines.length; i++) {
    if (!head(lines[i])) continue
    let j = i
    while (j < lines.length && head(lines[j])) j++
    const run = lines.slice(i, j).sort((a, b) => head(a)!.localeCompare(head(b)!))
    lines.splice(i, run.length, ...run)
    i = j
  }
  return lines.join('\n')
}
