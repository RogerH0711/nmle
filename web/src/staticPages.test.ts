// SEO 靜態頁的 HTML。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paperPage, questionPage, questionPath, sitemap, SITE } from './staticPages.ts'
import type { ExamFile, Index, PaperInfo, Question } from './types.ts'

const index: Index = { subjects: { pharmacology: '藥理學' }, papers: [] }
const paper: PaperInfo = { id: '113020_1', year: 113, session: 1, paper: '醫學(一)', file: 'questions/113020_1.json', count: 2 }
const q = (n: number, extra: Partial<Question> = {}): Question => ({
  id: `113020_1_${String(n).padStart(3, '0')}`, number: n, subject: 'pharmacology', subject_status: 'range',
  stem: '下列何者<script>alert(1)</script>正確？', options: ['甲 & 乙', '"丙"', '丁', '戊'], answers: ['B'],
  free_point: false, answer_note: null, override_reason: null, images: ['images/113020_1_045.png'],
  explanation: null, explanation_status: 'none', valid: true, issues: [], ...extra,
})

test('題目頁：內容跳脫、相對路徑回到網站根目錄、正解和詳解收在 details 裡', () => {
  const exp = { model: 'Qwen', questions: { '1': { text: '**答案：B**\n\n**關鍵觀念**\n<b>粗</b>**重點**', level: 'checked' as const } } }
  const html = questionPage(q(1), paper, index, exp, undefined, q(2))
  assert.equal(questionPath(q(1)), 'q/113020_1/1.html')
  assert.ok(!html.includes('<script>alert'), '題幹沒有跳脫')
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('甲 &amp; 乙') && html.includes('&quot;丙&quot;'))
  assert.ok(html.includes('&lt;b&gt;粗&lt;/b&gt;<strong>重點</strong>'), '詳解沒有跳脫')
  assert.ok(!html.includes('答案：B'), '詳解的答案那行應該略過')
  assert.ok(html.includes('<summary>看正解</summary>\n<p class="answer">正解：B</p>'))
  assert.ok(html.includes('href="../../q/style.css"') && html.includes('src="../../images/113020_1_045.png"'))
  assert.ok(html.includes('href="../../q/113020_1/2.html"'), '下一題')
  assert.ok(html.includes('href="../../#/bank/113020_1/1"'), '連回網站的題庫')
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}q/113020_1/1.html">`))
  assert.ok(!html.includes('{root}'))
})

test('考卷頁：只列可出題的題目', () => {
  const file: ExamFile = { exam: { id: '113020_1', year: 113, session: 1, paper: '醫學(一)' }, problems: [], questions: [q(1), q(2, { valid: false })] }
  const html = paperPage(file, paper, index)
  assert.ok(html.includes('q/113020_1/1.html'))
  assert.ok(!html.includes('q/113020_1/2.html'))
  assert.ok(html.includes('href="../q/style.css"'))
})

test('sitemap 用絕對網址', () => {
  assert.equal(sitemap(['', 'q/index.html']).match(/<loc>/g)?.length, 2)
  assert.ok(sitemap(['q/index.html']).includes(`<loc>${SITE}q/index.html</loc>`))
})

/** 從頁面取出所有 JSON-LD 並解析（解析失敗就是格式錯） */
function jsonLd(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
}

test('題目頁 JSON-LD：Quiz 包一題選擇題，正解在 acceptedAnswer', () => {
  const html = questionPage(q(1, { stem: '題幹</script><script>alert(1)</script>結尾' }), paper, index, undefined)
  assert.ok(!html.includes('</script><script>alert'), '題幹裡的 </script> 沒有跳脫')
  const all = jsonLd(html)
  assert.equal(all.length, 1)
  assert.ok(html.indexOf('application/ld+json') < html.indexOf('</head>'), 'JSON-LD 放在 head 裡')
  const d = all[0]
  assert.equal(d['@context'], 'https://schema.org')
  assert.equal(d['@type'], 'Quiz')
  assert.equal(d.url, `${SITE}q/113020_1/1.html`)
  assert.equal(d.inLanguage, 'zh-Hant')
  assert.deepEqual(d.about, { '@type': 'Thing', name: '藥理學' })
  assert.equal(d.educationalAlignment.alignmentType, 'educationalSubject')
  assert.equal(d.isPartOf.url, `${SITE}q/113020_1.html`)
  assert.equal(d.hasPart.length, 1)
  const qu = d.hasPart[0]
  assert.equal(qu['@type'], 'Question')
  assert.equal(qu.eduQuestionType, 'Multiple choice')
  assert.equal(qu.text, '題幹</script><script>alert(1)</script>結尾', '解析回來要是原本的題幹')
  assert.deepEqual(qu.image, [`${SITE}images/113020_1_045.png`])
  assert.deepEqual(qu.acceptedAnswer, [{ '@type': 'Answer', position: 2, name: 'B', text: '"丙"' }])
  assert.deepEqual(qu.suggestedAnswer.map((a: { name: string }) => a.name), ['A', 'C', 'D'])
  for (const a of [...qu.acceptedAnswer, ...qu.suggestedAnswer]) assert.equal(a['@type'], 'Answer')
  assert.equal(qu.comment, undefined)
})

test('題目頁 JSON-LD：一題多解、送分題、沒有附圖和學科', () => {
  const multi = jsonLd(questionPage(q(1, { answers: ['A', 'D'], answer_note: '答Ａ或Ｄ均給分', images: [] }), paper, index, undefined))[0]
  const mq = multi.hasPart[0]
  assert.deepEqual(mq.acceptedAnswer.map((a: { name: string }) => a.name), ['A', 'D'])
  assert.deepEqual(mq.suggestedAnswer.map((a: { name: string }) => a.name), ['B', 'C'])
  assert.deepEqual(mq.comment, { '@type': 'Comment', text: '答Ａ或Ｄ均給分' })
  assert.equal(mq.image, undefined)

  const free = jsonLd(questionPage(q(1, { answers: ['A', 'B', 'C', 'D'], free_point: true, subject: null }), paper, index, undefined))[0]
  assert.equal(free.hasPart[0].acceptedAnswer, undefined, '送分題沒有正解')
  assert.equal(free.hasPart[0].suggestedAnswer.length, 4)
  assert.equal(free.about, undefined)
  assert.equal(free.educationalAlignment, undefined)
})

test('考卷頁沒有 JSON-LD', () => {
  const file: ExamFile = { exam: { id: '113020_1', year: 113, session: 1, paper: '醫學(一)' }, problems: [], questions: [q(1)] }
  assert.equal(jsonLd(paperPage(file, paper, index)).length, 0)
})
