import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_CSP } from './src/csp'

// 只在 build 時把 CSP 加進 index.html（理由見 src/csp.ts）；放在 <head> 最前面，才會套用到後面所有的 script
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: APP_CSP }, injectTo: 'head-prepend' }],
}

// 題庫 JSON 和圖片放在 repo 根目錄的 data/，直接當成靜態檔案一起部署
export default defineConfig({
  plugins: [react(), csp],
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
