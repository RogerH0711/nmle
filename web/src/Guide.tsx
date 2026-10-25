import { useEffect } from 'react'
import { COMEBACK_DAYS, type Character } from './characters'
import { LOCATION_NAMES } from './CampusMap'
import { GOALS } from './affection'
import { INTERVALS } from './review'
import { MIN_ANSWERS, RECENT } from './abilities'
import { STREAK_MILESTONES, STREAK_MIN_DAILY } from './messages'
import { EARN, GIFT_BONUS } from './shop'

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
            <li>
              選項順序每次出題都會打亂，避免記住「這題選 C」。想照考卷原本的順序，把題目上方的「打亂選項」關掉。一題多解、一律給分的題目和模擬考（含檢討）維持原順序。
            </li>
            <li>
              作答後可以按「看詳解」：詳解由 AI 生成，沒有經過人工審核，並和學生編寫的參考詳解比對過結論、檢查過名詞，依結果標示「已比對」「名詞可能有誤」「和參考詳解不同」「未經比對」。有錯請回報。
            </li>
            <li>看不懂或沒有詳解的題目，可以按「問 AI」，把題目、正解和你選的答案帶到 ChatGPT、Claude 或 Gemini 問。AI 不一定對，以課本為準。</li>
            <li>覺得題目或答案有錯，按題目下方的「回報疑義」。</li>
          </ul>
        </section>

        <section>
          <h3>題庫</h3>
          <p>
            標題列的「題庫」可以瀏覽和搜尋所有題目：選某一年、某份考卷或某個學科，或輸入關鍵字（例如 vancomycin、內側延腦）搜題目和選項，勾「也搜詳解」連詳解一起搜。空白分開的幾個字要同時出現，英文不分大小寫。
          </p>
          <p>
            正解要按「顯示正解」才會出現。找到的題目可以按「刷這 N 題」直接作答，作答紀錄和錯題複習照常算。網址會跟著搜尋條件變，可以傳給同學。
          </p>
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
          <h3>商店</h3>
          <p>
            地圖右上角的「商店」可以用書籤買禮物和服裝送學姊。書籤這樣賺：每題第一次答對 +{EARN.firstCorrect}、錯題按時複習答對 +
            {EARN.reviewPass}、一天寫滿 {STREAK_MIN_DAILY} 題 +{EARN.studyDay}。禮物同一位學姊一天送一次。
          </p>
          <p>
            「熟識」和「在意」這兩階，送禮可以幫忙加一點進度，最多抵 {Math.round(GIFT_BONUS.cap * 100)}%，她喜歡的禮物加倍；剩下的還是要靠讀書。之後的階段送禮不加進度，但每位學姊收到禮物都有不同的反應。
          </p>
          <p>
            服裝要好感度到了才買得到，送了她就會換上；買過的可以在「服裝」隨時換回來。有幾套是看完劇情就收到的。服裝不加好感度，劇情裡還是穿劇本寫的衣服；換上哪一套只記在這台裝置。
          </p>
        </section>

        <section>
          <h3>模擬考</h3>
          <p>
            選一份考卷，100 題限時 2 小時，和正式考試一樣交卷才看答案。開始後不能放棄，只能交卷；中途關掉網頁，計時也不會停。每份考卷只有第一次會列進排行榜（作答不到 10 分鐘就交卷的不算）。
          </p>
        </section>

        <section>
          <h3>登入與排行榜</h3>
          <ul>
            <li>
              不登入的話，紀錄只存在這台裝置的瀏覽器裡；換裝置或清除瀏覽器資料就不見了。
            </li>
            <li>
              登入後，紀錄會同步到各裝置，也能看排行榜。登入前在這台裝置寫的題目會併進帳號。
            </li>
            <li>
              可以用 Google 登入，或註冊不需要 Email 的帳號密碼。Google 登入時網站只會收到 Email、名稱和大頭貼網址，不會顯示給別人；帳號密碼沒有 Email 可以找回，忘記密碼就救不回來。
            </li>
            <li>排行榜只顯示暱稱。預設是「同學」加四個數字，可以在右上角改，不要用真名。</li>
            <li>想刪除帳號，點右上角的暱稱，再按「刪除帳號」。雲端上的紀錄會全部刪除，無法復原。</li>
            <li>排行榜有三種：本週正確率（至少 50 題）、連續作答天數（一天至少 10 題）、模擬考成績。</li>
            <li>網站會記錄匿名的使用統計：一個隨機的裝置代碼、每天在這台裝置作答幾題、有沒有開角色模式和登入。不記錄你是誰，也不記錄作答內容，只用來知道有多少人在用。</li>
          </ul>
        </section>

        <section>
          <h3>聲音</h3>
          <p>
            預設是靜音。右上角的 🔇 可以打開聲音，分別調音效、音樂、語音的音量。音樂只在角色模式播放，模擬考時不播；切到別的分頁時會自動暫停。
          </p>
        </section>

        <section>
          <h3>不想看劇情？</h3>
          <p>右上角關掉「角色模式」就是一般模式：沒有立繪和劇情，只留刷題、錯題複習、題庫、模擬考和排行榜。</p>
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
