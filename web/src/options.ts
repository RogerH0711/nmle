// 選項打亂（不依賴瀏覽器環境，方便測試）。做法見 docs/design.md「題庫瀏覽與搜尋」的「選項打亂」。
// 作答紀錄、正解、回報一律用原本的字母；只有畫面上的順序和字母換掉。
import type { Letter, Question } from './types'

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']
const IDENTITY = [0, 1, 2, 3]

/** 畫面上第 i 個位置放原本的第 order[i] 個選項 */
export type Order = number[]

// 選項提到其他選項（「以上皆是」「選項 A 與 B」）的題目打亂會出錯。105–115 年沒有這種題目，留著防之後解析的年份。
// （不用 lookbehind：iOS 16.4 以前的 Safari 不支援，整支程式會載入失敗）
const REFERS_TO_OPTIONS =
  /以上(皆|均|都)|上述(皆|均|都|選項)|其他選項|選項\s*[A-DＡ-Ｄ](?![A-Za-z])|(^|[^A-Za-z])[A-DＡ-Ｄ]\s*[與和及、或]\s*[A-DＡ-Ｄ](?![A-Za-z])\s*(皆|均|都)/

// 選項本身就是 A–D 其中一個字母（維生素 A、D、E、K；TCR 的 V、D、J、C 片段；B₁、B₁₂）：打亂後會出現「B. A」「A. D」，
// 很容易看錯成選項代號，維持原順序（106100_1_078、108030_2_019、108030_2_100、114090_1_005 的 C 纖維）
const LETTER_OPTION = /^[A-DＡ-Ｄ][₀-₉]*$/

/**
 * 能不能打亂：一題多解、官方註記（「第 88 題答Ａ、Ｂ給分」寫的是原本的字母）、一律給分、
 * 選項提到其他選項、選項本身是一個字母的題目維持原順序。
 */
export function canShuffle(q: Question) {
  return (
    q.answers.length === 1 && !q.answer_note && !q.free_point &&
    !q.options.some((o) => REFERS_TO_OPTIONS.test(o)) &&
    !q.options.some((o) => LETTER_OPTION.test(o.trim()))
  )
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
  // 連續的「- (X)」項目照字母排序。105–109 年的詳解（11/27）常把一項寫成好幾行、項目之間空一行，
  // 所以一項延伸到下一項為止，空行後面還是選項就跟著前一項；最後一項到空行、粗體標題或結尾為止
  const head = (line: string) => /^\s*[-*]\s+[（(]([A-D])[)）]/.exec(line)?.[1]
  const blank = (line: string) => !line.trim()
  const heading = (line: string) => /^\s*\*\*[^*]+\*\*\s*$/.test(line)
  for (let i = 0; i < lines.length; i++) {
    if (!head(lines[i])) continue
    const items: string[][] = []
    let j = i
    while (j < lines.length && head(lines[j])) {
      const item = [lines[j++]]
      while (j < lines.length && !head(lines[j]) && !heading(lines[j])) {
        if (blank(lines[j])) {
          let k = j
          while (k < lines.length && blank(lines[k])) k++
          // 空行後面還是選項：空行跟著這一項；不是的話選項解析到這裡結束，空行留在原位
          if (k < lines.length && head(lines[k])) {
            item.push(...lines.slice(j, k))
            j = k
          }
          break
        }
        item.push(lines[j++])
      }
      items.push(item)
    }
    items.sort((a, b) => head(a[0])!.localeCompare(head(b[0])!))
    lines.splice(i, j - i, ...items.flat())
    i = j - 1
  }
  return lines.join('\n')
}
