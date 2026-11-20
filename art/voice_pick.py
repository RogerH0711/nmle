# 挑選頁：辨識和量測判斷不了的（語氣像不像念稿、疑問句尾音、聲調、辨識寫錯字），每句列出幾個候選讓 Roger 聽了挑
#（11/14 Roger：「學術性的句子像念稿」是念的語氣；「疑問句的尾音應該會往上」）。
# 11/15 改成互動式（Roger：複製貼上手很酸）：點選就存進 art/voice_picks.json，要用 voice_server.py 開（python -m http.server 存不了）。
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_pick.py fei breeze2-seg-B_s1-v3lv [--from N] [--n 3] [--out story] 分組:語音key ...
# 每句列出評分最好的 N 次（Roger 判定不行的不列），輸出 art/bakeoff/voice/breezy/<角色>-pick.html（--out story 就是 <角色>-story-pick.html）
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from voice_export import BREEZY, HEARD, live, score  # noqa: E402

N = 6
CONTEXT = 3  # 劇情台詞前面附幾句上下文（11/15 Roger：劇情類的要給上下文，才知道劇情跟情緒）


def story_context(cid):
    """{劇情台詞 id: (前面幾句, 後面一句)}，每句是 (說話的人, 文字)。選項攤平成「（選項）A／B」接著兩邊的回應"""
    path = BREEZY.parents[2].parent / 'data' / 'stories' / f'{cid}.json'
    if not path.exists():
        return {}
    chars = json.loads((path.parents[1] / 'characters.json').read_text(encoding='utf-8'))
    name = next((c['name'] for c in chars.get('characters', []) if c.get('id') == cid), cid)
    who = {'narration': '旁白', 'player': '我', cid: name}
    out = {}
    for scene in json.loads(path.read_text(encoding='utf-8'))['scenes']:
        flat = [('', f"【{scene['title']}】")]

        def walk(ls, prefix=''):
            for l in ls:
                if l['speaker'] == 'choice':
                    flat.append(('', '（選項）' + '／'.join(o['text'] for o in l['options'])))
                    for i, o in enumerate(l['options'], 1):
                        walk(o['lines'], f'選 {i} 的回應・')
                else:
                    flat.append((prefix + who.get(l['speaker'], l['speaker']), l['text'], l.get('id')))
        walk(scene['lines'])
        for i, item in enumerate(flat):
            if len(item) == 3 and item[2]:
                out[item[2]] = ([x[:2] for x in flat[max(0, i - CONTEXT):i]], [x[:2] for x in flat[i + 1:i + 2]])
    return out

STYLE = '''body{font:15px sans-serif;max-width:1100px;margin:0 auto;padding:0 16px 4em}
td{padding:4px 10px 4px 0;vertical-align:middle}.dim{color:#888;font-size:13px}.bad{color:#b00}
audio{width:240px;height:32px}h3{margin:1.6em 0 .3em}
.bar{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #ddd;z-index:1}
.line{border-left:4px solid #ddd;padding-left:12px}.line.done{border-color:#2a2}.line.nogood{border-color:#b00}
.status{font-size:13px;margin-left:8px}.ctx{color:#888;font-size:13px;margin:2px 0}.say{font-weight:bold;margin:4px 0}label{cursor:pointer}input[type=text]{width:60%;padding:4px}
@media (prefers-color-scheme: dark){body,.bar{background:#1b1b1b;color:#ddd}.bar{border-color:#444}}'''

SCRIPT = '''
const page = document.body.dataset
const lines = [...document.querySelectorAll('.line')]
function refresh() {
  const done = lines.filter(l => l.classList.contains('done') || l.classList.contains('nogood')).length
  document.getElementById('count').textContent = `已挑 ${done}/${lines.length} 句`
}
function mark(line, take) {
  line.classList.toggle('done', take !== null && take !== undefined)
  line.classList.toggle('nogood', take === null)
}
async function save(line, status) {
  const picked = line.querySelector('input[type=radio]:checked')
  if (!picked) return
  const take = picked.value === 'none' ? null : Number(picked.value)
  const note = line.querySelector('input[type=text]').value.trim()
  status.textContent = '存檔中…'
  try {
    const r = await fetch('/picks', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({cid: page.cid, cfg: page.cfg, key: line.dataset.key, take, note})})
    if (!r.ok) throw new Error(r.status)
    status.textContent = '已存'
    mark(line, take)
  } catch (e) {
    status.textContent = '存不了（要用 python art/voice_server.py 開這頁）'
  }
  refresh()
}
for (const line of lines) {
  const status = line.querySelector('.status')
  line.querySelectorAll('input[type=radio]').forEach(i => i.addEventListener('change', () => save(line, status)))
  line.querySelector('input[type=text]').addEventListener('change', () => save(line, status))
}
// 一次只播一個：按下一個播放，前一個停掉
document.addEventListener('play', e => document.querySelectorAll('audio').forEach(a => a !== e.target && a.pause()), true)
fetch('/picks').then(r => r.json()).then(all => {
  const mine = (all[page.cid] || {})[page.cfg] || {}
  for (const line of lines) {
    const p = mine[line.dataset.key]
    if (!p) continue
    const v = p.take === null ? 'none' : String(p.take)
    const input = line.querySelector(`input[value="${v}"]`)
    if (input) input.checked = true
    line.querySelector('input[type=text]').value = p.note || ''
    if (input || p.take === null) mark(line, p.take)
    line.querySelector('.status').textContent = input || p.take === null ? '已存' : `之前挑的第 ${p.take} 次不在這頁`
  }
  refresh()
}).catch(() => { document.getElementById('count').textContent = '讀不到已存的結果（要用 python art/voice_server.py 開這頁）' })
'''


def main():
    args = sys.argv[1:]

    def option(name, default):
        if name not in args:
            return default
        i = args.index(name)
        value = args[i + 1]
        del args[i:i + 2]
        return value
    first = int(option('--from', 1))  # 只列第 N 次以後的（改了念法、只想聽新的那批）
    n = int(option('--n', N))  # 每句列幾個候選
    out_name = option('--out', '')
    cid, cfg, *keys = args
    groups = {}
    for k in keys:
        label, _, k = k.rpartition(':') if ':' in k else ('', '', k)
        groups.setdefault(label, []).append(k)
    result = json.loads((BREEZY / 'results.json').read_text(encoding='utf-8'))[cid][cfg]
    prosody = json.loads((BREEZY / 'prosody.json').read_text(encoding='utf-8')).get(cid, {}).get(cfg, {})
    context = story_context(cid)

    def ctx(items):
        return ''.join(f'<div class="ctx">{html.escape(s + "：" if s else "")}{html.escape(t)}</div>' for s, t in items)
    page = [f'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>配音挑選</title><style>{STYLE}</style>',
            f'<body data-cid="{cid}" data-cfg="{cfg}">',
            f'<div class="bar"><b>{cid} 配音挑選</b>（{cfg}）<span id="count" class="status"></span></div>',
            '<p>每句聽完點一個就會自動存檔（左邊的線變綠色）；都不行就點「都不行」，可以在備註寫原因。'
            '換頁、重新整理都會留著。「尾音」是問句最後 0.2 秒比前面高幾個半音，只供參考。</p>']
    for label, ks in groups.items():
        if label:
            page.append(f'<h2>{html.escape(label)}</h2>')
        for key in ks:
            key, _, since = key.partition('@')  # 「語音key@13」：這句只列第 13 次以後的
            since = int(since) if since else first
            text = result['text'][key]
            takes = [t for t in result['takes'][key] if HEARD.get((cid, cfg, f"{key}_t{t['take']}.wav")) is not False and t['take'] >= since]
            takes.sort(key=lambda t: score(text, t))
            before, after = context.get(key.split('.')[0], ([], []))
            page.append(f'<div class="line" data-key="{key}"><h3>{key}<span class="status"></span></h3>{ctx(before)}'
                        f'<div class="say">{html.escape(text)}</div>{ctx(after)}<table>')
            for t in takes[:n]:
                p = prosody.get(f"{key}_t{t['take']}.wav", {})
                rise = '、'.join('?' if r is None else f'{r:+.1f}' for r in p.get('rise', []))
                page.append(f'<tr><td><label><input type="radio" name="{key}" value="{t["take"]}"> <b>第 {t["take"]} 次</b></label></td>'
                            f'<td><audio controls preload="none" src="{cid}/{cfg}/{key}_t{t["take"]}.wav"></audio></td>'
                            f'<td class="dim"><span class="{"" if live(t) else "bad"}">念錯 {t["misread"]:.0%}・多停 {t["extra"]}</span>'
                            f'{f"・尾音 {rise}" if rise else ""}<br>聽成：{html.escape(t["heard"])}</td></tr>')
            page.append(f'<tr><td><label><input type="radio" name="{key}" value="none"> 都不行</label></td>'
                        f'<td colspan="2"><input type="text" placeholder="備註（例如：一階的一要念四聲）"></td></tr></table></div>')
    page.append(f'<script>{SCRIPT}</script>')
    out = BREEZY / f'{cid}-{out_name + "-" if out_name else ""}pick.html'
    out.write_text('\n'.join(page), encoding='utf-8')
    print(f'挑選頁 {out}（{sum(map(len, groups.values()))} 句）')


if __name__ == '__main__':
    main()
