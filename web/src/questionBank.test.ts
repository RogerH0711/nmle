// 題庫抽檢：data/ 的考卷、圖片、正解 seed、詳解彼此對得起來，也沒有解析殘留。執行：npm test
// 題庫由 pipeline/build_exam.py 產生；這裡不通過時，修正走 pipeline/overrides/，不要直接改 data/。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { ExamFile, Index, Letter, Question } from './types.ts'

const root = new URL('../../', import.meta.url)
const data = new URL('data/', root)
const readJson = <T>(path: string, base = data): T => JSON.parse(readFileSync(new URL(path, base), 'utf-8')) as T

const index = readJson<Index>('index.json')
const exams = index.papers.map((p) => ({ paper: p, exam: readJson<ExamFile>(p.file) }))
const questions = exams.flatMap((e) => e.exam.questions)
const byId = new Map(questions.map((q) => [q.id, q]))
const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

test('index.json 列出的每份考卷都存在，題數、題號、題目 id 一致', () => {
  assert.ok(index.papers.length >= 24)
  const listed = index.papers.map((p) => p.file.replace(/^questions\//, ''))
  assert.equal(new Set(listed).size, listed.length, 'index.json 有重複的考卷')
  const onDisk = readdirSync(new URL('questions/', data)).filter((f) => f.endsWith('.json'))
  assert.deepEqual([...onDisk].sort(), [...listed].sort(), 'data/questions/ 和 index.json 的考卷不一致')
  for (const { paper, exam } of exams) {
    assert.equal(exam.exam.id, paper.id, `${paper.file} 的考卷 id`)
    assert.equal(exam.exam.paper, paper.paper, `${paper.id} 的科目`)
    // count 是可出題的題數（build_exam.py），沒出題的題目仍留在考卷裡
    assert.equal(exam.questions.length, 100, `${paper.id} 不是 100 題`)
    assert.equal(exam.questions.filter((q) => q.valid).length, paper.count, `${paper.id} 的可出題題數`)
    assert.deepEqual(exam.problems, [], `${paper.id} 有解析問題`)
    exam.questions.forEach((q, i) => {
      assert.equal(q.number, i + 1, `${paper.id} 第 ${i + 1} 題的題號`)
      assert.equal(q.id, `${paper.id}_${String(q.number).padStart(3, '0')}`, `${paper.id} 第 ${q.number} 題的 id`)
    })
  }
  assert.equal(byId.size, questions.length, '題目 id 重複')
})

test('學科區段涵蓋整份考卷，和每題的學科一致', () => {
  for (const { paper, exam } of exams) {
    const runs = paper.subject_runs ?? []
    assert.ok(runs.length > 0, `${paper.id} 沒有 subject_runs`)
    let next = 1
    for (const [from, to, subject] of runs) {
      assert.equal(from, next, `${paper.id} 的學科區段不連續`)
      assert.ok(subject in index.subjects, `${paper.id} 的學科 ${subject} 不在 subjects 裡`)
      for (const q of exam.questions.slice(from - 1, to)) assert.equal(q.subject, subject, `${q.id} 的學科`)
      next = to + 1
    }
    assert.equal(next, exam.questions.length + 1, `${paper.id} 的學科區段沒有涵蓋到最後一題`)
  }
})

// 頁首頁尾（代號：1301 頁次：8－2、背面尚有試題）、選項標記混進題幹、
// 亂碼（U+FFFD、字型私用區、控制字元、零寬字元；換行另外檢查）
const RESIDUE: [string, RegExp][] = [
  ['頁首頁尾', /代號|頁次|背面尚有|請翻頁|請接背面|第\s*\d+\s*頁|共\s*\d+\s*頁/],
  ['頁碼', /\d+\s*[－—–]\s*\d+\s*$/],
  ['選項標記', /^\s*[(（][A-DＡ-Ｄ][)）]|[(（][AＡ][)）].*[(（][BＢ][)）]/],
  ['亂碼', /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\uFFFD]/u],
]

function residue(text: string): string[] {
  const found = RESIDUE.filter(([, re]) => re.test(text)).map(([name]) => name)
  if (text !== text.trim()) found.push('前後空白')
  if (/\s{3,}|\n/.test(text)) found.push('連續空白或換行')
  return found
}

test('每題都有題幹和 4 個選項，沒有空字串，也沒有疑似解析殘留', () => {
  const problems: string[] = []
  for (const q of questions) {
    if (!q.valid) {
      // 沒出題的題目要寫原因（例如選項全是圖），而且只能是官方送分的題目
      assert.ok(q.issues.length > 0, `${q.id} 沒出題卻沒寫原因`)
      assert.ok(q.free_point, `${q.id} 沒出題，但不是送分題`)
      continue
    }
    assert.deepEqual(q.issues, [], `${q.id} 可出題卻有 issues`)
    assert.equal(q.options.length, 4, `${q.id} 不是 4 個選項`)
    const texts: [string, string][] = [['題幹', q.stem], ...q.options.map((o, i): [string, string] => [`選項 ${LETTERS[i]}`, o])]
    for (const [where, text] of texts) {
      if (typeof text !== 'string' || text.trim() === '') problems.push(`${q.id} ${where}是空的`)
      else for (const r of residue(text)) problems.push(`${q.id} ${where}：${r}（${JSON.stringify(text.slice(0, 40))}）`)
    }
    if (new Set(q.options).size !== 4) problems.push(`${q.id} 有重複的選項`)
  }
  assert.deepEqual(problems, [])
})

test('題目引用的圖片都在 data/images/，data/images/ 也沒有沒用到的圖', () => {
  const used = new Set<string>()
  for (const q of questions) {
    for (const img of q.images) {
      assert.match(img, new RegExp(`^images/${q.id.slice(0, -4)}/[\\w.-]+\\.(png|jpg|webp)$`), `${q.id} 的圖片路徑`)
      assert.ok(existsSync(new URL(img, data)), `${q.id} 的圖片 ${img} 不存在`)
      used.add(img)
    }
  }
  const onDisk = readdirSync(new URL('images/', data)).flatMap((dir) =>
    readdirSync(new URL(`images/${dir}/`, data)).map((f) => `images/${dir}/${f}`),
  )
  assert.deepEqual(onDisk.filter((f) => !used.has(f)), [], '沒有題目用到的圖片')
})

test('正解：格式合法，一題多解與送分題照官方', () => {
  for (const q of questions) {
    const { answers } = q
    assert.ok(answers.length >= 1, `${q.id} 沒有正解`)
    assert.ok(answers.every((a) => LETTERS.includes(a)), `${q.id} 的正解不在 A–D：${answers}`)
    assert.deepEqual(answers, LETTERS.filter((l) => answers.includes(l)), `${q.id} 的正解要依序且不重複`)
    if (q.free_point) {
      // 一律給分：四個都算對，並附上更正答案的說明（「一律給分」或「除未作答者不給分外，其餘均給分」）
      assert.deepEqual(answers, LETTERS, `${q.id} 送分題的正解要是 A–D`)
      assert.match(q.answer_note ?? '', /一律給分|均給分/, `${q.id} 送分題沒有說明`)
    } else if (answers.length > 1) {
      // 一題多解：2–3 個正解，並附上更正答案的說明（四個都對應該是送分題）
      assert.ok(answers.length <= 3, `${q.id} 四個都對卻不是送分題`)
      assert.match(q.answer_note ?? '', /給分/, `${q.id} 一題多解沒有說明`)
      for (const a of answers) assert.ok(q.answer_note!.includes(String.fromCharCode(a.charCodeAt(0) + 0xfee0)) || q.answer_note!.includes(a), `${q.id} 的說明沒提到 ${a}`)
    } else {
      assert.equal(q.answer_note, null, `${q.id} 單一正解卻有更正說明`)
    }
  }
})

test('question_keys.sql 的題目和 data/questions/ 一一對應，正解一致', () => {
  const sql = readFileSync(new URL('supabase/seed/question_keys.sql', root), 'utf-8')
  const rows = [...sql.matchAll(/^\('(\w+)', '\{([A-D,]*)\}', (true|false)\),?$/gm)]
  const declared = Number(/^-- (\d+) 題$/m.exec(sql)?.[1])
  assert.equal(rows.length, declared, 'seed 的列數和開頭註明的題數不同（格式可能跑掉了）')
  const keys = new Map<string, { answers: string[]; free: boolean }>()
  for (const [, id, answers, free] of rows) {
    assert.ok(!keys.has(id), `seed 裡 ${id} 重複`)
    keys.set(id, { answers: answers.split(','), free: free === 'true' })
  }
  // export_keys.py：沒出題的題目不匯出，但官方送分的要匯出
  const expected = questions.filter((q) => q.valid || q.free_point)
  assert.deepEqual([...keys.keys()].sort(), expected.map((q) => q.id).sort(), 'seed 和題庫的題目不一致，請重跑 pipeline/export_keys.py')
  for (const q of expected) {
    const k = keys.get(q.id)!
    assert.deepEqual(k.answers, q.answers, `${q.id} 的正解和題庫不同，請重跑 pipeline/export_keys.py`)
    assert.equal(k.free, q.free_point, `${q.id} 的送分標記和題庫不同`)
  }
})

test('data/explanations/ 的題號都對得到可出題的題目，詳解寫的答案和正解一致', () => {
  const files = readdirSync(new URL('explanations/', data)).filter((f) => f.endsWith('.json'))
  assert.ok(files.length > 0)
  const papers = new Set(index.papers.map((p) => p.id))
  const levels = new Set(['checked', 'terms', 'conflict', 'unchecked'])
  for (const f of files) {
    const paper = f.replace(/\.json$/, '')
    assert.ok(papers.has(paper), `${f} 不在 index.json 的考卷裡`)
    const file = readJson<{ questions: Record<string, { text: string; level: string }> }>(`explanations/${f}`)
    for (const [num, e] of Object.entries(file.questions)) {
      assert.match(num, /^[1-9]\d*$/, `${f} 的題號 ${num}`)
      const q: Question | undefined = byId.get(`${paper}_${num.padStart(3, '0')}`)
      assert.ok(q, `${f} 第 ${num} 題不在題庫裡`)
      assert.ok(q.valid, `${q.id} 沒出題卻有詳解`)
      assert.ok(levels.has(e.level), `${q.id} 詳解的分級 ${e.level}`)
      assert.ok(e.text.trim().length > 0, `${q.id} 詳解是空的`)
      // 第一行是「**答案：D**」或「**答案：（D）**」，一題多解會列好幾個
      const head = /^\*\*答案：([^*\n]+)\*\*/.exec(e.text)
      assert.ok(head, `${q.id} 詳解沒有答案那行`)
      assert.deepEqual([...new Set(head[1].match(/[A-D]/g))].sort(), q.answers, `${q.id} 詳解的答案和正解不同`)
    }
  }
})
