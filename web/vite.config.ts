import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 題庫 JSON 和圖片放在 repo 根目錄的 data/，直接當成靜態檔案一起部署
export default defineConfig({
  plugins: [react()],
  publicDir: '../data',
  base: './',
})
