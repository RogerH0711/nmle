// 每一頁最下方的免責聲明
export function Disclaimer() {
  return (
    <footer className="disclaimer">
      <p>
        非官方題庫。試題與答案取自考選部公開的歷屆試題，正解以考選部公告（含更正答案）為準。題目由程式從 PDF
        解析，可能有誤，發現問題請按題目下方的「回報疑義」。
      </p>
      <p>
        角色立繪、背景音樂與配音為 AI 生成（立繪 Animagine XL 4.0，去背使用 BRIA RMBG-2.0，CC BY-NC 4.0；音樂 ACE-Step 1.5；配音 Breeze TTS 2）。網站會記錄匿名的使用統計（隨機的裝置代碼和每天作答題數，不含個人資料）。
      </p>
      <p>
        <a href={`${import.meta.env.BASE_URL}privacy.html`}>隱私權政策與使用條款</a>
        {/* 靜態的歷屆試題頁（build 時產生，給搜尋引擎收錄；scripts/static-pages.ts） */}
        {' ・ '}
        <a href={`${import.meta.env.BASE_URL}q/index.html`}>歷屆試題總覽</a>
      </p>
    </footer>
  )
}
