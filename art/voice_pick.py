# 挑選頁：辨識和量測判斷不了的（語氣像不像念稿、疑問句尾音、聲調、辨識寫錯字），每句列出幾個候選讓 Roger 聽了挑
#（11/14 Roger：「學術性的句子像念稿」是念的語氣；「疑問句的尾音應該會往上」）。挑好的寫進 voice_export.PICK。
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_pick.py fei breeze2-seg-B_s1-v3lv fei-mock_high-002.m fei-wrong-008 ...
# 每句列出評分最好的 N 次（Roger 判定不行的不列），輸出 art/bakeoff/voice/breezy/<角色>-pick.html
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from voice_export import BREEZY, HEARD, live, score  # noqa: E402

N = 6


def main():
    args = sys.argv[1:]
    # --from N：只列第 N 次以後的（改了念法、只想聽新的那批）
    first = int(args.pop(args.index('--from') + 1)) if '--from' in args else 1
    args = [a for a in args if a != '--from']
    cid, cfg, *keys = args
    groups = {}
    for k in keys:
        label, _, k = k.rpartition(':') if ':' in k else ('', '', k)
        groups.setdefault(label, []).append(k)
    result = json.loads((BREEZY / 'results.json').read_text(encoding='utf-8'))[cid][cfg]
    prosody = json.loads((BREEZY / 'prosody.json').read_text(encoding='utf-8')).get(cid, {}).get(cfg, {})
    page = ['<!doctype html><meta charset="utf-8"><title>配音挑選</title>',
            '<style>body{font:15px sans-serif;max-width:1100px;margin:2em auto;padding:0 16px}td{padding:4px 10px 4px 0;vertical-align:top}'
            '.dim{color:#888;font-size:13px}.bad{color:#b00}audio{width:240px;height:32px}h3{margin:1.6em 0 .3em}</style>',
            f'<h1>{cid} 配音挑選（{cfg}）</h1><p>每句是評分最好的幾次，左邊的「第 N 次」就是編號。'
            '聽完回我每句要哪一次（例如「mock_high-002.m：第 23 次」），都不行就說不行。'
            '「尾音」是問句最後 0.2 秒比前面高幾個半音，只供參考（和聽感對不太起來）。</p>']
    for label, ks in groups.items():
        if label:
            page.append(f'<h2>{html.escape(label)}</h2>')
        for key in ks:
            text = result['text'][key]
            takes = [t for t in result['takes'][key] if HEARD.get((cid, cfg, f"{key}_t{t['take']}.wav")) is not False and t['take'] >= first]
            takes.sort(key=lambda t: score(text, t))
            page.append(f'<h3>{key}</h3><div>{html.escape(text)}</div><table>')
            for t in takes[:N]:
                p = prosody.get(f"{key}_t{t['take']}.wav", {})
                rise = '、'.join('?' if r is None else f'{r:+.1f}' for r in p.get('rise', []))
                page.append(f'<tr><td><b>第 {t["take"]} 次</b></td><td><audio controls preload="none" src="{cid}/{cfg}/{key}_t{t["take"]}.wav"></audio></td>'
                            f'<td class="dim"><span class="{"" if live(t) else "bad"}">念錯 {t["misread"]:.0%}・多停 {t["extra"]}</span>'
                            f'{f"・尾音 {rise}" if rise else ""}<br>聽成：{html.escape(t["heard"])}</td></tr>')
            page.append('</table>')
    out = BREEZY / f'{cid}-pick.html'
    out.write_text('\n'.join(page), encoding='utf-8')
    print(f'挑選頁 {out}（{sum(map(len, groups.values()))} 句）')


if __name__ == '__main__':
    main()
