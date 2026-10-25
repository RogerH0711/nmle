// Content-Security-Policy：限制網頁只能從哪裡載入 script、連到哪裡。就算哪天有 XSS，
// 也載入不了別的網站的 script、把資料送不出去。GitHub Pages 不能設定 HTTP header，所以用 <meta>，
// build 時由 vite.config.ts 加進 index.html（開發伺服器會插入 inline script 和 HMR 的 websocket，加了會被擋）。
// 新增外部服務時要加進來，否則會被瀏覽器擋下（主控台會出現 Content Security Policy 的錯誤）。

export const SUPABASE_ORIGIN = 'https://gppcwxkhkzfogdfudebu.supabase.co' // supabase.ts
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com' // turnstile.ts：登入的真人驗證

export const APP_CSP = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE_ORIGIN}`,
  // 允許 inline style：10/25 用 Playwright 試過拿掉也正常，但沙盒連不到 Cloudflare 的驗證主機，
  // Turnstile 互動驗證的流程沒辦法完整測；擋錯會讓所有人無法登入，而 inline style 的風險遠低於 script
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", // styles.css 的裝飾框是 data: 的 SVG
  `connect-src 'self' ${SUPABASE_ORIGIN}`, // 題庫、音檔用 fetch 讀自己網站的檔案
  `frame-src ${TURNSTILE_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

// SEO 靜態頁（staticPages.ts）：沒有 script，只有自己網站的 CSS 和圖片。
// <script type="application/ld+json"> 是資料，不會執行，不受 script-src 限制。
export const STATIC_PAGE_CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')
