import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { APP_CSP } from './src/csp.ts'

// 只在 build 時把 CSP 加進 index.html（理由見 src/csp.ts）；放在 <head> 最前面，才會套用到後面所有的 script
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: APP_CSP }, injectTo: 'head-prepend' }],
}

// 離線與加到主畫面（PWA）：service worker 和 web manifest。開發伺服器不啟用。做法見 docs/design.md「技術架構」的離線。
// - 預先快取的只有網站程式（index.html、JS、CSS、圖示），不含題庫和美術（data/ 有 50 MB）。
// - 題庫、台詞、立繪、音檔用到時才快取（CacheFirst）。這些檔案的網址帶著部署版本 ?v=（bank.ts 的 dataUrl），
//   同一個網址的內容不會變；離線時跑的是快取裡那一版的程式，要的也是同一版的網址，所以對得上。
// - SEO 靜態頁（q/）、隱私權政策、Search Console 驗證檔不走 service worker，直接連網路。
// - 新版部署後，打開網站時背景下載新的 service worker，裝好就自動重新整理（autoUpdate）。
const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'script', // 外部的 registerSW.js；'inline' 會被 CSP 擋下
  manifest: {
    name: '醫師一階攻略～五位學姊陪你考過～',
    short_name: '醫師一階攻略',
    description: '用考選部醫師一階歷屆試題刷題，五位學姊陪你讀書。免費，不登入也能用。',
    lang: 'zh-Hant',
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#f6f4f1',
    theme_color: '#e8772e',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['index.html', 'assets/*.{js,css}', 'icons/*.png'],
    navigateFallback: 'index.html',
    navigateFallbackDenylist: [/\/q\//, /\/privacy\.html$/, /\/google[0-9a-f]+\.html$/, /\/sitemap\.xml$/],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.endsWith('.json'),
        handler: 'CacheFirst',
        options: { cacheName: 'nmle-data', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 24 * 3600 } },
      },
      {
        urlPattern: ({ url, sameOrigin }) => sameOrigin && /\.(webp|png|jpe?g|mp3)$/.test(url.pathname),
        handler: 'CacheFirst',
        options: { cacheName: 'nmle-media', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 24 * 3600 } },
      },
    ],
  },
})

// 題庫 JSON 和圖片放在 repo 根目錄的 data/，直接當成靜態檔案一起部署
export default defineConfig({
  plugins: [react(), csp, pwa],
  publicDir: '../data',
  base: './',
  build: {
    rollupOptions: {
      output: {
        // 套件和網站程式分開打包：套件很少更新，部署新版時瀏覽器可以沿用快取，只重新下載網站程式
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
        },
      },
    },
  },
})
