import { useState } from 'react'
import { useDialog } from './dialog'
import { COMEBACK_DAYS, type Character } from './characters'
import { LOCATION_NAMES } from './CampusMap'
import { GOALS } from './affection'
import { INTERVALS } from './review'
import { MIN_ANSWERS, RECENT } from './abilities'
import { STREAK_MILESTONES, STREAK_MIN_DAILY } from './messages'
import { EARN, GIFT_BONUS } from './shop'
import { countAnswers, downloadBackup, importBackup, parseBackup } from './backup'
import { ask } from './ConfirmDialog'

const SEEN_KEY = 'nmle.guide.seen.v1'

/** 第一次打開網站時自動顯示說明；之後從標題列的「說明」打開 */
export function guideSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // 讀不到瀏覽器儲存空間時不要每次都跳出來
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // 存不了就算了，下次再顯示一次
  }
}

// 11/15 Roger：說明字太多，使用者會直接跳過。第一頁只放「快速開始」，其他照主題分頁，想知道再點
const TABS = [
  ['start', '快速開始'],
  ['answer', '作答與題庫'],
  ['progress', '複習與好感度'],
  ['shop', '商店'],
  ['mock', '模擬考'],
  ['account', '帳號與聲音'],
] as const
type Tab = (typeof TABS)[number][0]

/**
 * 使用說明（怎麼玩）。數字盡量從程式的設定值讀，改門檻時說明會跟著變。
 */
export function Guide({
  characters,
  subjects,
  roundSize,
  onClose,
}: {
  characters: Character[]
  subjects: Record<string, string>
  roundSize: number
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('start')
  const close = () => {
    markSeen()
    onClose()
  }

  const dialogRef = useDialog(close) // Esc、Tab、焦點（dialog.ts）

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal guide" role="dialog" aria-modal="true" aria-label="怎麼玩" ref={dialogRef} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2>怎麼玩</h2>
        <div className="guide-tabs" role="tablist" aria-label="說明的主題">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'start' && (
          <section role="tabpanel">
            <p className="guide-lead">用 105–115 年的醫師一階歷屆試題刷題，五位學姊各帶幾科陪你讀。免費，不登入也能用。</p>
            <ol className="guide-steps">
              <li>
                <strong>圖書館</strong>：先清掉今天到期的錯題。
              </li>
              <li>
                <strong>點一位學姊</strong>：和她一起讀 {roundSize} 題她負責的科目，好感度升階就有新劇情。
              </li>
              <li>
                <strong>依考卷刷題</strong>：想照整份考卷寫，按地圖下方的按鈕。
              </li>
            </ol>
            <table className="guide-cast">
              <tbody>
                {characters.map((c) => (
                  <tr key={c.id} style={{ '--char': c.color } as React.CSSProperties}>
                    <th>{c.name}</th>
                    <td>{c.subjects.map((s) => subjects[s] ?? s).join('、')}</td>
                    <td className="guide-place">{LOCATION_NAMES[c.location ?? ''] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="guide-small">其他細節在上面的分頁。之後隨時可以從標題列的「說明」打開。</p>
          </section>
        )}

        {tab === 'answer' && (
          <section role="tabpanel">
            <h3>作答</h3>
            <ul>
              <li>點選項作答，馬上顯示正解。鍵盤：1–4 或 A–D 作答，Enter 或 → 下一題，← 上一題。</li>
              <li>選項順序每次會打亂；想照原本順序，關掉題目上方的「打亂選項」。</li>
              <li>「看詳解」是 AI 生成的，和學生的參考詳解比對過，會標示比對結果。有錯請按「回報疑義」。</li>
              <li>「問 AI」會把題目和你的答案帶到 ChatGPT、Claude 或 Gemini。AI 不一定對，以課本為準。</li>
            </ul>
            <h3>題庫</h3>
            <ul>
              <li>標題列的「題庫」可以依年份、考卷、學科瀏覽，或用關鍵字搜（例如 vancomycin、抗生素、革蘭氏陰性菌）。</li>
              <li>搜分類會連裡面的藥名、菌名一起找，中英文也會互相找。正解要按「顯示正解」才出現。</li>
              <li>找到的題目可以按「刷這 N 題」直接寫；網址可以傳給同學。</li>
            </ul>
          </section>
        )}

        {tab === 'progress' && (
          <section role="tabpanel">
            <h3>錯題複習</h3>
            <p>
              答錯的題目會在 {INTERVALS.join('、')} 天後回來。到期後答對才排下一次，第 {INTERVALS.length} 次也答對就「攻略完成」；中途答錯從頭來。
            </p>
            <h3>不確定、收藏、筆記</h3>
            <ul>
              <li>答對但其實是猜的：作答後按「加入不確定清單」。再答一次就移出，答錯會進錯題複習。</li>
              <li>題目右上角的 ☆ 收藏；作答後可以寫筆記，只有你看得到。</li>
              <li>不確定和收藏的題目都在圖書館（一般模式在題目上方），可以一起刷。登入後跨裝置同步。</li>
            </ul>
            <h3>好感度與劇情</h3>
            <p>看你在她負責科目的表現，不論是和她讀、依考卷刷題還是模擬考。階段只升不降，看過的劇情可以從「劇情」重看。同一題同一天重做只算第一次。</p>
            <ol className="guide-stages">
              <li>
                <strong>熟識</strong>：她的科目答對 {GOALS.correct} 題
              </li>
              <li>
                <strong>在意</strong>：她的科目錯題到期後答對 {GOALS.passes} 次
              </li>
              <li>
                <strong>心動</strong>：她的科目連續 {GOALS.window} 次作答，正確率 {GOALS.rate}% 以上
              </li>
              <li>
                <strong>告白前夕</strong>：模擬考裡她的科目得分率 {GOALS.mockRate}% 以上
              </li>
            </ol>
            <h3>能力值與訊息</h3>
            <ul>
              <li>
                「能力值」：各科最近 {RECENT} 題的正確率（寫滿 {MIN_ANSWERS} 題才有）。
              </li>
              <li>
                「訊息」：錯題到期、{COMEBACK_DAYS} 天沒來、有新劇情、連續 {STREAK_MILESTONES.slice(0, 3).join('、')} 天（一天至少 {STREAK_MIN_DAILY} 題）時，學姊會傳訊息。
              </li>
            </ul>
          </section>
        )}

        {tab === 'shop' && (
          <section role="tabpanel">
            <p>
              用書籤買禮物和服裝送學姊。第一次答對 +{EARN.firstCorrect}、錯題按時複習答對 +{EARN.reviewPass}、一天寫滿 {STREAK_MIN_DAILY} 題 +
              {EARN.studyDay}。
            </p>
            <ul>
              <li>禮物同一位學姊一天送一次。「熟識」「在意」兩階可以加一點進度（最多 {Math.round(GIFT_BONUS.cap * 100)}%，她喜歡的加倍），之後只換到她的反應。</li>
              <li>服裝要好感度到了才買得到，送了就換上，之後可以換回來；有幾套看完劇情就會收到。服裝不加好感度。</li>
            </ul>
          </section>
        )}

        {tab === 'mock' && (
          <section role="tabpanel">
            <p>選一份考卷，100 題限時 2 小時，交卷才看答案。</p>
            <ul>
              <li>開始後不能放棄，只能交卷；關掉網頁計時也不會停。</li>
              <li>每份考卷只有第一次列進排行榜（作答不到 10 分鐘就交卷的不算）。</li>
            </ul>
          </section>
        )}

        {tab === 'account' && (
          <section role="tabpanel">
            <h3>登入與排行榜</h3>
            <ul>
              <li>不登入：紀錄只存在這台裝置，換裝置或清除瀏覽器資料就不見。</li>
              <li>登入：各裝置同步，也能上排行榜；登入前寫的題目會併進帳號。</li>
              <li>可以用 Google 或不需要 Email 的帳號密碼登入。Google 登入只收到 Email、名稱和大頭貼網址，不會顯示給別人；帳號密碼忘了無法找回。</li>
              <li>排行榜有本週正確率（至少 50 題）、連續作答天數（一天至少 10 題）、模擬考成績，只顯示暱稱（預設「同學」加四個數字），不要用真名。</li>
              <li>點右上角的暱稱可以刪除帳號，雲端紀錄會全部刪除、無法復原。</li>
              <li>網站會記錄匿名的使用統計（隨機的裝置代碼、每天作答題數），不記錄你是誰和作答內容。</li>
            </ul>
            <h3>備份與搬家</h3>
            <p>把這台裝置的紀錄（作答、模擬考、送禮、看過的劇情、設定）存成一個檔案，到別的瀏覽器或網站搬家後再匯入。匯入會和現有的紀錄合併，不會覆蓋，重複匯入也不會重複計算。</p>
            <BackupControls />
            <h3>聲音</h3>
            <p>預設靜音。右上角的喇叭可以開聲音、分別調音效、音樂、配音。模擬考時不播音樂。</p>
            <h3>不想看劇情？</h3>
            <p>右上角關掉「角色模式」：沒有立繪和劇情，只留刷題、錯題複習、題庫、模擬考和排行榜。</p>
          </section>
        )}

        <p className="guide-note">非官方題庫，正解以考選部公告（含更正答案）為準。題目由程式從 PDF 解析，可能有誤。立繪、音樂與配音為 AI 生成。</p>

        <button className="primary" onClick={close}>
          開始讀書
        </button>
      </div>
    </div>
  )
}

/** 備份檔的下載與匯入（backup.ts）。匯入後重新整理網頁，記憶體裡的紀錄才會換成合併後的 */
function BackupControls() {
  const [status, setStatus] = useState<string | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const backup = parseBackup(await file.text())
      const n = countAnswers(backup)
      const date = new Date(backup.exported_at).toLocaleDateString('zh-TW')
      const message = `${date} 的備份，${n} 筆作答。\n會和這台裝置現有的紀錄合併（同一筆不會重複計算），完成後重新整理網頁。`
      if (!(await ask({ title: '匯入備份', message, confirm: '匯入' }))) return
      importBackup(backup)
      window.location.reload()
    } catch (e) {
      setStatus(e instanceof Error && e.message.includes('備份') ? e.message : '匯入失敗：瀏覽器空間可能不夠，或檔案損壞')
    }
  }

  return (
    <div className="backup">
      <button
        className="ghost small"
        onClick={() => {
          try {
            downloadBackup()
            setStatus('已下載備份檔。有登入的話，匯入後要登入同一個帳號才看得到。')
          } catch {
            setStatus('瀏覽器不讓網站下載檔案，請換一個瀏覽器（例如 Chrome、Safari）再試。')
          }
        }}
      >
        下載備份
      </button>
      <label className="ghost small backup-import">
        匯入備份
        <input type="file" accept="application/json,.json" onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = '' // 取消匯入後再選同一個檔案也要觸發
          }} />
      </label>
      {status && (
        <p className="guide-small" role="status">
          {status}
        </p>
      )}
    </div>
  )
}
