import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 題庫 JSON 和圖片放在 repo 根目錄的 data/，直接當成靜態檔案一起部署
export default defineConfig({
  plugins: [react()],
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
