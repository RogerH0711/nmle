import type { Index, Letter, Question } from './types'
import { dataUrl, imageUrl } from './bank'
import { subtopicName, subtopicOf, useSubtopics } from './subtopics'
import { ExplanationPanel } from './ExplanationPanel'
import { AskAi } from './AskAi'
import { ReportButton } from './Report'
import { shownQuestion, toShown, type Order as OptionOrder } from './options'
import { isCorrect } from './run'
import { FavoriteButton, NoteEditor, UnsureToggle } from './MarkControls'

// 一題：題幹、選項、作答後的回饋（正解、詳解、問 AI）、上一題／下一題、回報疑義

const LETTERS: Letter[] = ['A', 'B', 'C', 'D']

// 一般模式（或這個學科的角色還沒推出）用的通用回饋
const FEEDBACK = {
  correct: ['答對了！', '漂亮！', '正確！', '很穩！'],
  wrong: ['差一點，看一下正解。', '這題記下來，之後再複習。', '沒關係，下一題。'],
}

function pickLine(kind: keyof typeof FEEDBACK, seed: number) {
  const lines = FEEDBACK[kind]
  return lines[seed % lines.length]
}

export function QuestionCard(props: {
  q: Question
  order: OptionOrder // 畫面上的選項順序；picked 是原本的字母，onPick 傳畫面上的字母
  index: Index
  picked: Letter | undefined
  onPick: (l: Letter) => void
  onNext: () => void
  onPrev?: () => void
  seed: number
  showLine: boolean // 有角色陪讀時，反應台詞由角色說，這裡只顯示正解
  speech: { name: string; color: string; text: string } | null // 手機版把角色台詞放在選項下方，作答後一眼看得到
  navRef: React.RefObject<HTMLElement | null> // 作答後捲到這裡，回饋和「下一題」才看得到
}) {
  const { order, index, onPick, onNext, onPrev, seed, showLine, speech, navRef } = props
  const correct = props.picked ? isCorrect(props.q, props.picked) : null
  // 以下都用畫面上的順序和字母；回報疑義用原本的字母
  const q = shownQuestion(props.q, order)
  const picked = props.picked && toShown(order, props.picked)
  const paper = index.papers.find((p) => q.id.startsWith(p.id + '_'))
  const subtopics = useSubtopics(dataUrl('subtopics.json'))
  const topic = subtopics ? subtopicName(subtopics, q.subject, subtopicOf(subtopics, q.id)) : null

  return (
    <main className="card">
      <div className="qhead">
        <span className="qnum">
          {paper && `${paper.year}-${paper.session ?? ''} ${paper.paper} `}第 {q.number} 題
        </span>
        {q.subject && (
          <span className="tag" title={q.subject_status === 'range' ? '依題號區段粗分，尚未逐題確認' : undefined}>
            {index.subjects[q.subject] ?? q.subject}
            {topic && `・${topic}`}
          </span>
        )}
        {q.free_point && <span className="tag warn">本題一律給分</span>}
        {!q.free_point && q.answers.length > 1 && <span className="tag warn">一題多解</span>}
        <FavoriteButton questionId={q.id} />
      </div>

      <p className="stem">{q.stem}</p>
      {q.images.map((src) => (
        <img key={src} className="figure" src={imageUrl(src)} alt={`第 ${q.number} 題附圖`} />
      ))}

      <ol className="options">
        {q.options.map((text, i) => {
          const letter = LETTERS[i]
          let state = ''
          if (picked) {
            if (q.answers.includes(letter) && !q.free_point) state = 'is-answer'
            if (letter === picked) state += correct ? ' is-right' : ' is-wrong'
          }
          return (
            <li key={letter}>
              <button className={`option ${state}`} onClick={() => onPick(letter)} disabled={!!picked}>
                <span className="key">{letter}</span>
                <span className="text">{text}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {picked && (
        <div className={`feedback ${correct ? 'good' : 'bad'}`} role="status">
          {showLine && <p className="line">{pickLine(correct ? 'correct' : 'wrong', seed)}</p>}
          {speech && (
            <p className="line char-line">
              <span style={{ color: speech.color }}>{speech.name}</span>：{speech.text}
            </p>
          )}
          <p className="answer">
            {q.free_point ? '本題官方一律給分。' : `正解：${q.answers.join('、')}`}
            {q.answer_note && !q.free_point && <span className="note">（{q.answer_note}）</span>}
          </p>
          <div className="mark-row">
            {/* 答錯的會進錯題複習，不用另外標；送分題不算答對 */}
            {correct && !q.free_point && <UnsureToggle questionId={q.id} />}
            <NoteEditor key={q.id} questionId={q.id} />
          </div>
          <ExplanationPanel key={`exp-${q.id}`} questionId={q.id} number={q.number} order={order} />
          <AskAi key={q.id} q={q} paper={paper} subject={q.subject ? (index.subjects[q.subject] ?? q.subject) : null} picked={picked} />
        </div>
      )}

      <nav className="nav" ref={navRef}>
        <button className="ghost" onClick={onPrev} disabled={!onPrev}>
          ← 上一題
        </button>
        <button className="primary" onClick={onNext} disabled={!picked}>
          下一題 →
        </button>
      </nav>
      <div className="card-foot">
        <ReportButton key={q.id} questionId={q.id} picked={props.picked} />
        <p className="hint">鍵盤：1–4 作答，Enter 下一題</p>
      </div>
    </main>
  )
}
