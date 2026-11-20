// 雲端資料備份，由 Roger 在自己的電腦執行：npm run db:backup（或 npm run db:backup -- <放備份的資料夾>）
//
// 照 Supabase 官方「Backup and Restore using the CLI」的做法，用 CLI 的 db dump 存成三個檔：
//   roles.sql（角色）、schema.sql（資料表、RLS、函式、trigger）、data.sql（資料，含 auth.users）
// 需求：這台電腦 supabase link 過；Docker Desktop 開著（CLI 連線上專案時在 Docker 容器裡跑 pg_dump）。
//
// data.sql 有使用者的 Email、密碼雜湊和全部作答紀錄：只能存在 repo 以外的地方，
// 不能 commit、不能放進 GitHub Actions（公開 repo 的產出別人下載得到）。預設存到 ~/nmle-backups/<日期時間>/。
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'node_modules', 'supabase', 'dist', 'supabase.js')

// 官方指南的三個指令（--linked 是這版 CLI 2.121 的寫法，新版改叫 --remote）。
// data 排除的兩張是 Storage 向量功能的表，官方指南也排除
const DUMPS = [
  ['roles.sql', ['--role-only']],
  ['schema.sql', []],
  ['data.sql', ['--data-only', '--use-copy', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']],
]

/** data.sql 每張表有幾筆：COPY 開頭到 \. 之間一行一筆（COPY 的文字格式會把資料裡的換行跳脫成 \n） */
export function countRows(sql) {
  const counts = new Map()
  let table = null
  for (const raw of sql.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (table === null) {
      const m = /^COPY ("[^"]+"\."[^"]+"|[\w.]+) /.exec(line)
      if (m) counts.set((table = m[1].replaceAll('"', '')), 0)
    } else if (line === '\\.') table = null
    else counts.set(table, counts.get(table) + 1)
  }
  return counts
}

/** 備份資料夾不能在 repo 裡面（避免不小心 commit 個資） */
export function insideRepo(dir, root = ROOT) {
  const rel = path.relative(root, path.resolve(dir))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function fail(message) {
  console.error(`\n備份失敗：${message}`)
  process.exit(1)
}

function main() {
  const parent = process.argv[2] ?? path.join(os.homedir(), 'nmle-backups')
  const dest = path.join(path.resolve(parent), timestamp())
  if (insideRepo(dest)) fail(`${dest} 在 repo 裡面。備份有個資，請放在 repo 以外的資料夾。`)

  const docker = spawnSync('docker', ['info'], { stdio: 'ignore' })
  if (docker.error || docker.status !== 0) fail('Docker 沒有在執行。先打開 Docker Desktop（db dump 在 Docker 容器裡跑 pg_dump），等它啟動完再重跑。')

  mkdirSync(dest, { recursive: true })
  console.log(`備份到 ${dest}\n`)
  for (const [file, flags] of DUMPS) {
    // 直接用 node 執行 CLI，不經過 shell，Windows 和 macOS 都一樣
    const r = spawnSync(process.execPath, [CLI, 'db', 'dump', '--linked', '-f', path.join(dest, file), ...flags], { cwd: ROOT, stdio: 'inherit' })
    if (r.status !== 0) fail(`${file} 沒有存成功（上面是 CLI 的錯誤訊息）。專案被暫停時也會失敗，見 supabase/README.md「專案被暫停時」。`)
  }

  const counts = countRows(readFileSync(path.join(dest, 'data.sql'), 'utf-8'))
  console.log('\n各表筆數：')
  for (const [table, n] of [...counts].filter(([t]) => t.startsWith('public.') || t === 'auth.users').sort()) {
    console.log(`  ${table.padEnd(32)} ${n}`)
  }
  for (const file of DUMPS.map(([f]) => f)) console.log(`${file.padEnd(11)} ${(statSync(path.join(dest, file)).size / 1024).toFixed(0)} KB`)
  if (!counts.has('auth.users')) fail('data.sql 裡沒有 auth.users，備份不完整。')
  if (![...counts].some(([t, n]) => t.startsWith('public.') && n > 0)) fail('public 的資料表全部是 0 筆，備份可能不完整。')
  console.log('\n完成。備份有使用者的 Email 和密碼雜湊：不要 commit、不要上傳到公開的地方，舊的留最近幾份就好。')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
