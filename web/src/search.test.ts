// 題庫搜尋的比對與網址。執行：npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bankHash, buildExpansions, expandTerms, highlight, parseBankHash, parseQuery, searchBank } from './search.ts'
import type { ExamFile, Index, Question } from './types.ts'

const q = (id: string, stem: string, options: string[], extra: Partial<Question> = {}): Question => ({
  id, number: Number(id.slice(-3)), subject: 'pharmacology', subject_status: 'range', stem,
  options: options as Question['options'], answers: ['A'], free_point: false, answer_note: null, override_reason: null,
  images: [], explanation: null, explanation_status: 'none', valid: true, issues: [], ...extra,
})

const bank = [
  q('113020_1_001', '下列何者屬於 aminoglycoside？', ['Gentamicin', 'Vancomycin', 'Penicillin', 'Aspirin']),
  q('113020_2_005', '第2天出現發燒', ['甲', '乙', '丙', '丁'], { subject: 'microbiology' }),
  q('112020_1_010', 'ＶＡＮＣＯＭＹＣＩＮ 的作用機轉', ['a', 'b', 'c', 'd']),
  q('112020_1_011', '沒出題', ['a', 'b', 'c', 'd'], { valid: false }),
]
const ids = (hits: { q: Question }[]) => hits.map((h) => h.q.id)
const g = (query: string) => expandTerms(parseQuery(query))

test('關鍵字不分大小寫、全半形，選項也搜', () => {
  const hits = searchBank(bank, { scope: 'all', subject: 'all', groups: g('vancomycin') })
  assert.deepEqual(ids(hits), ['113020_1_001', '112020_1_010'])
})

test('略過空白：「第 2 天」找得到「第2天」；多個關鍵字要同時出現', () => {
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', groups: g('第 2 天') })), ['113020_2_005'])
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', groups: g('gentamicin aspirin') })), ['113020_1_001'])
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', groups: g('gentamicin 發燒') })), [])
})

test('範圍：某年全部、單份考卷；學科；不列沒出題的題目', () => {
  assert.deepEqual(ids(searchBank(bank, { scope: 'y113', subject: 'all', groups: [] })), ['113020_1_001', '113020_2_005'])
  assert.deepEqual(ids(searchBank(bank, { scope: '112020_1', subject: 'all', groups: [] })), ['112020_1_010'])
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'microbiology', groups: [] })), ['113020_2_005'])
})

test('只有詳解提到的題目另外標示；關鍵字可以一半在題目、一半在詳解', () => {
  const exp = new Map([['112020_1_010', '抑制細胞壁合成'], ['113020_2_005', '病毒感染']])
  const hits = searchBank(bank, { scope: 'all', subject: 'all', groups: g('細胞壁 vancomycin') }, exp)
  assert.deepEqual(hits.map((h) => [h.q.id, h.inExplanation]), [['112020_1_010', true]])
})

test('標示符合的片段，對回原文（含中間的空白、全形字）', () => {
  assert.deepEqual(highlight('與 IL-5 有關', parseQuery('與il-5')), [
    { text: '與 IL-5', mark: true },
    { text: ' 有關', mark: false },
  ])
  assert.deepEqual(highlight('ＡＢ和AB', parseQuery('ab')), [
    { text: 'ＡＢ', mark: true },
    { text: '和', mark: false },
    { text: 'AB', mark: true },
  ])
  assert.deepEqual(highlight('沒有', []), [{ text: '沒有', mark: false }])
})

test('網址來回轉換；亂打的範圍當成全部', () => {
  const r = { scope: '113020_1', number: 45, query: '抗生素', subject: 'pharmacology' }
  assert.deepEqual(parseBankHash(bankHash(r)), r)
  assert.deepEqual(parseBankHash('#/bank'), { scope: 'all', number: null, query: '', subject: 'all' })
  assert.deepEqual(parseBankHash('#/bank/y113'), { scope: 'y113', number: null, query: '', subject: 'all' })
  assert.equal(parseBankHash('#/bank/<script>')?.scope, 'all')
  assert.equal(parseBankHash('#/bank/y113/5')?.number, null) // 題號只對單份考卷有意義
  assert.equal(parseBankHash('#/other'), null)
  assert.equal(parseBankHash(''), null)
})

// ---------- 同義詞與上位概念 ----------

const concepts = [
  { name: '抗生素', aliases: ['antibiotic'], includes: ['胺基醣苷'], members: ['vancomycin'] },
  { name: '胺基醣苷', aliases: ['aminoglycoside'], members: ['gentamicin'] },
  { name: '氫離子幫浦抑制劑', aliases: ['PPI'], members: ['omeprazole'] },
]
const exp = buildExpansions(concepts, [['epinephrine', '腎上腺素']])

test('上位概念：子概念的成員也找；結尾的「類」「藥」略過；別名也觸發', () => {
  assert.deepEqual(new Set(expandTerms(parseQuery('抗生素類'), exp)[0]), new Set(['抗生素類', '抗生素', 'antibiotic', 'vancomycin', '胺基醣苷', 'aminoglycoside', 'gentamicin']))
  assert.deepEqual(ids(searchBank(bank, { scope: 'all', subject: 'all', groups: expandTerms(parseQuery('抗生素'), exp) })), ['113020_1_001', '112020_1_010'])
  assert.ok(expandTerms(parseQuery('Antibiotic'), exp)[0].includes('gentamicin'))
})

test('短的縮寫只觸發、不拿去比對（ppi 會中 happiness）；同義詞雙向；沒有對照的字照舊', () => {
  const ppi = expandTerms(parseQuery('PPI'), exp)[0]
  assert.equal(ppi[0], 'ppi')
  assert.ok(ppi.includes('omeprazole'))
  assert.ok(!expandTerms(parseQuery('氫離子幫浦抑制劑'), exp)[0].includes('ppi'))
  assert.deepEqual(expandTerms(parseQuery('腎上腺素'), exp), [['腎上腺素', 'epinephrine']])
  assert.deepEqual(expandTerms(parseQuery('epinephrine'), exp), [['epinephrine', '腎上腺素']])
  assert.deepEqual(expandTerms(parseQuery('發燒 vancomycin'), exp), [['發燒'], ['vancomycin']])
  assert.equal(exp.labels.get('ppi'), 'PPI') // 畫面上列原本的寫法
})

// 用真的題庫和 data/search/ 的對照表抽查：該找到的找得到，常見的誤中不會發生
const data = new URL('../../data/', import.meta.url)
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, data), 'utf-8')) as T
const all = readJson<Index>('index.json').papers.flatMap((p) => readJson<ExamFile>(p.file).questions)
const real = buildExpansions(readJson<{ concepts: typeof concepts }>('search/concepts.json').concepts, readJson<{ groups: string[][] }>('search/synonyms.json').groups)
const find = (query: string) => searchBank(all, { scope: 'all', subject: 'all', groups: expandTerms(parseQuery(query), real) }).map((h) => h.q)
const literal = (query: string) => searchBank(all, { scope: 'all', subject: 'all', groups: expandTerms(parseQuery(query)) }).map((h) => h.q)
const text = (q: Question) => [q.stem, ...q.options].join('\n').toLowerCase()

test('真實題庫：搜類別找得到只寫藥名、菌名的題目', () => {
  for (const [query, member] of [['抗生素', 'gentamicin'], ['β阻斷劑', 'propranolol'], ['革蘭氏陰性菌', 'pseudomonas'], ['線蟲', '絲蟲'], ['腎上腺素', 'epinephrine']]) {
    const found = find(query)
    assert.ok(found.length > literal(query).length, `「${query}」展開後沒有多找到題目`)
    assert.ok(found.some((q) => text(q).includes(member) && !text(q).includes(query)), `「${query}」找不到只寫 ${member} 的題目`)
  }
})

test('真實題庫：類別不會誤中名字相近的字', () => {
  // 展開的寫法如果有 statin 會中 nystatin、somatostatin；influenza 會中 Haemophilus influenzae；azole 會中 metronidazole。
  // 直接打 statin 本來就會中（打的字照原樣比對），這裡檢查的是類別名稱展開出來的寫法
  const nystatin = find('降血脂藥').filter((q) => /nystatin|somatostatin/.test(text(q)) && !/simvastatin|atorvastatin|atrovastatin|rosuvastatin|pravastatin|lovastatin/.test(text(q)))
  assert.deepEqual(nystatin.map((q) => q.id), [])
  const flu = find('RNA病毒').filter((q) => text(q).includes('influenzae') && !/influenza (virus|a|b)|流感|rna/.test(text(q)))
  assert.deepEqual(flu.map((q) => q.id), [])
  const azole = find('azole類抗黴菌藥').filter((q) => /metronidazole|omeprazole|albendazole/.test(text(q)) && !/conazole|clotrimazole|miconazole|抗黴菌|antifungal/.test(text(q)))
  assert.deepEqual(azole.map((q) => q.id), [])
})

test('對照表的格式：概念名稱不重複、includes 都存在、同義詞每組至少兩個', () => {
  const list = readJson<{ concepts: typeof concepts }>('search/concepts.json').concepts
  const names = list.map((c) => c.name)
  assert.equal(new Set(names).size, names.length, '概念名稱重複')
  for (const c of list) for (const i of c.includes ?? []) assert.ok(names.includes(i), `${c.name} includes 的「${i}」不存在`)
  for (const grp of readJson<{ groups: string[][] }>('search/synonyms.json').groups) assert.ok(grp.length >= 2, grp.join('/'))
})
