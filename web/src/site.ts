// 網站的正式網址（結尾要有 /）。搬到自訂網域時只改這裡（改進清單第 15 項）：
// - index.html 的分享預覽（og:url、og:image）：vite.config.ts 在 build 時把 __SITE__ 換成這個
// - SEO 靜態頁的 canonical、JSON-LD 與 sitemap.xml：staticPages.ts
// 網站本身用相對路徑（vite.config.ts 的 base: './'、manifest 的 start_url），換網域不用改；
// site.test.ts 會檢查其他檔案沒有寫死這個網址。
export const SITE = 'https://rogerh0711.github.io/nmle/'
