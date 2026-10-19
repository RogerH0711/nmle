import { useEffect } from 'react'
import { COMEBACK_DAYS, type Character } from './characters'
import { LOCATION_NAMES } from './CampusMap'
import { GOALS } from './affection'
import { INTERVALS } from './review'
import { MIN_ANSWERS, RECENT } from './abilities'
import { STREAK_MILESTONES, STREAK_MIN_DAILY } from './messages'

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
  const close = () => {
    markSeen()
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      markSeen()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal guide" role="dialog" aria-label="怎麼玩" onClick={(e) => e.stopPropagation()}>
        <h2>怎麼玩</h2>
        <p className="guide-lead">
          用考選部 110–115 年的醫師一階歷屆試題刷題（24 份考卷、約 2,400 題）。五位學姊各負責幾個學科，選誰一起讀書，就是走誰的路線。免費，不登入也能用。
        </p>

        <section>
          <h3>每天這樣用</h3>
          <ol>
            <li>先點地圖上的<strong>圖書館</strong>，清掉今天到期的錯題。</li>
            <li>
              點一位學姊，和她一起讀 {roundSize} 題她負責學科的題目。第一次找她，或好感度升階時，會先播一段劇情。
            </li>
            <li>想照整份考卷刷，按地圖下方的「依考卷刷題」。</li>
          </ol>
        </section>

        <section>
          <h3>五位學姊</h3>
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
          <p className="guide-small">學姊們叫你「學弟」或「學妹」，第一次進地圖時選，之後在地圖下方的「稱呼」可以改。</p>
        </section>

        <section>
          <h3>作答</h3>
          <ul>
            <li>點選項作答，馬上顯示正解。電腦可以用鍵盤：1–4 或 A–D 作答，Enter 或 → 下一題，← 上一題。</li>
            <li>目前沒有詳解。作答後可以按「問 AI」，把題目、正解和你選的答案帶到 ChatGPT、Claude 或 Gemini 問。AI 不一定對，以課本為準。</li>
            <li>覺得題目或答案有錯，按題目下方的「回報疑義」。</li>
          </ul>
        </section>

        <section>
          <h3>錯題複習</h3>
          <p>
            答錯的題目會在 {INTERVALS.join('、')} 天後回來。到期當天（或之後）答對，才會排到下一次；第 {INTERVALS.length}{' '}
            次也答對就是「攻略完成」。中途答錯，從頭再來。
          </p>
        </section>

        <section>
          <h3>好感度與劇情</h3>
          <p>好感度看你在她負責學科的表現，不論是和她一起讀、依考卷刷題，還是模擬考裡寫的。升階後就能看下一段劇情。</p>
          <ol className="guide-stages">
            <li>
              <strong>熟識</strong>：她的學科答對 {GOALS.correct} 題（不同題目）
            </li>
            <li>
              <strong>在意</strong>：她的學科錯題複習，到期後答對 {GOALS.passes} 次
            </li>
            <li>
              <strong>心動</strong>：她的學科連續 {GOALS.window} 次作答，正確率 {GOALS.rate}% 以上
            </li>
            <li>
              <strong>告白前夕</strong>：一次模擬考裡，她的學科得分率 {GOALS.mockRate}% 以上
            </li>
          </ol>
          <p>
            階段只升不降。看過的劇情可以從地圖下方的「劇情」重看。同一題同一天重做，只算第一次。
          </p>
          <p>
            地圖右上角的「能力值」是各科最近 {RECENT} 題的正確率（寫滿 {MIN_ANSWERS} 題才有數字），看哪一科最需要加強。
          </p>
          <p>
            地圖右上角的「訊息」是學姊傳來的訊息：錯題到期、超過 {COMEBACK_DAYS} 天沒來、有新劇情、連續作答天數（一天至少{' '}
            {STREAK_MIN_DAILY} 題）達到 {STREAK_MILESTONES.slice(0, 3).join('、')} 天等時候。打開網站時才會收到，不會推播到手機。
          </p>
        </section>

        <section>
          <h3>模擬考</h3>
          <p>
            選一份考卷，100 題限時 2 小時，和正式考試一樣交卷才看答案。開始後不能放棄，只能交卷；中途關掉網頁，計時也不會停。每份考卷只有第一次會列進排行榜。
          </p>
        </section>

        <section>
          <h3>登入與排行榜</h3>
          <ul>
            <li>
              不登入的話，紀錄只存在這台裝置的瀏覽器裡；換裝置或清除瀏覽器資料就不見了。
            </li>
            <li>
              用 Google 登入後，紀錄會同步到各裝置，也能看排行榜。登入前在這台裝置寫的題目會併進帳號。
              <strong>登入目前還在測試，要先請網站作者把你的 Gmail 加進名單。</strong>
            </li>
            <li>排行榜只顯示暱稱。預設是「同學」加四個數字，可以在右上角改，不要用真名。</li>
            <li>排行榜有三種：本週正確率（至少 50 題）、連續作答天數（一天至少 10 題）、模擬考成績。</li>
          </ul>
        </section>

        <section>
          <h3>不想看劇情？</h3>
          <p>右上角關掉「角色模式」就是一般模式：沒有立繪和劇情，只留刷題、錯題複習、模擬考和排行榜。</p>
        </section>

        <p className="guide-note">
          非官方題庫，正解以考選部公告（含更正答案）為準。題目由程式從 PDF 解析，可能有誤。立繪為 AI 生成。
        </p>

        <button className="primary" onClick={close}>
          開始讀書
        </button>
      </div>
    </div>
  )
}
