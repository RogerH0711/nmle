# 比較不同配音設定（例如 BreezyVoice B_s1 和 Breeze TTS 2）的試聽頁：每句一列，各設定最好的那次固定排成欄，欄名就是設定名稱
#（11/13 Roger：答案放頁尾一直翻很難分析）。加 --blind 改成每句順序打亂、標 A/B/C、答案在頁尾。只讀 results.json 和音檔，不動網站的 data/audio。
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/voice_compare.py fei B_s1-final breeze2-clone-B_s1 breeze2-direct-B_s1
# 為了公平，每個設定都只從前 MAX_TAKE 次裡挑（B_s1 難念的句子念到 30 次）。
import html
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from voice_export import BREEZY, best_takes, live  # noqa: E402

MAX_TAKE = 6
LABEL = {'B_s1-final': 'BreezyVoice B_s1', 'breeze2-clone-B_s1': 'Breeze clone', 'breeze2-clone-B_s1-say': 'Breeze clone-say（姊→姐、乾酪→干酪）',
         'breeze2-direct-B_s1': 'Breeze direct（中文指示）', 'breeze2-direct-B_s1-en2': 'Breeze direct-en2（英文指示）',
         'breeze2-seg-B_s1': 'Breeze seg（分段念）', 'breeze2-direct-B_s1-emo': 'Breeze direct-emo（只講語氣）',
         'breeze2-seg-B_s1-v2': 'Breeze seg v2（短段合併、咳→清嗓子）', 'breeze2-seg-B_s1-v2emo': 'Breeze seg v2 + 語氣',
         **{f'breeze2-seg-B_s1-v2-jiu-{c}': f'seg v2（研究→研{c}）' for c in '就舊救'}}


def main():
    blind = '--blind' in sys.argv
    # --out 名稱：試聽頁另存成 <角色>-<名稱>.html，不蓋掉主要的比較頁
    out_name = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else 'compare'
    cfgs = [a for a in sys.argv[2:] if a not in ('--blind', '--out', out_name)]
    cid = sys.argv[1]
    best = {c: {k: (t, b) for k, t, b, _ in best_takes(cid, c, MAX_TAKE)} for c in cfgs}
    keys = sorted(set.intersection(*(set(b) for b in best.values())))
    rng = random.Random(0)
    letters = 'ABCDEFG'[:len(cfgs)]
    how = ('每句順序都打亂。先聽、記下每句喜歡哪個（例如 fei-start-001：B），再看頁尾的答案。' if blind
           else '每一欄固定是同一個設定。')
    page = ['<!doctype html><meta charset="utf-8"><title>配音比較</title>',
            '<style>body{font:15px sans-serif;max-width:1200px;margin:2em auto;padding:0 16px}td{padding:6px 10px 6px 0;vertical-align:top;border-top:1px solid #ddd}'
            '.dim{color:#888;font-size:13px}.bad{color:#b00}audio{width:220px;height:32px}</style>',
            f'<h1>{cid} 配音比較（{len(keys)} 句）</h1><p>每格是該設定最好的那次（都只從前 {MAX_TAKE} 次挑）。{how}'
            '紅字是語音辨識判定還不能上線的。</p><table>']
    answer = []
    for key in keys:
        order = cfgs[:]
        if blind:
            rng.shuffle(order)
        text = best[cfgs[0]][key][0]
        page.append(f'<tr><td colspan="{len(cfgs)}"><b>{key}</b>　{html.escape(text)}</td></tr><tr>')
        for letter, c in zip(letters, order):
            b = best[c][key][1]
            label = letter if blind else f'<b>{LABEL.get(c, c)}</b><br>'
            page.append(f'<td>{label} <audio controls preload="none" src="{cid}/{c}/{key}_t{b["take"]}.wav"></audio>'
                        f'<br><span class="dim {"" if live(b) else "bad"}">念錯 {b["misread"]:.0%}・多停 {b["extra"]}'
                        f'<br>聽成：{html.escape(b["heard"])}</span></td>')
        page.append('</tr>')
        answer.append(f'{key}：' + '、'.join(f'{l}={c}' for l, c in zip(letters, order)))
    page.append('</table><h2>統計</h2><table><tr><td>設定</td><td>完美（念錯 0、不多停）</td><td>可上線</td><td>平均念錯率</td></tr>')
    for c in cfgs:
        bs = [best[c][k][1] for k in keys]
        page.append(f'<tr><td>{c}</td><td>{sum(not b["misread"] and not b["extra"] for b in bs)}/{len(bs)}</td>'
                    f'<td>{sum(live(b) for b in bs)}/{len(bs)}</td><td>{sum(b["misread"] for b in bs) / len(bs):.1%}</td></tr>')
    if blind:
        page.append('</table><details><summary>答案（聽完再看）</summary><p>' + '<br>'.join(answer) + '</p></details>')
    else:
        page.append('</table>')
    out = BREEZY / f'{cid}-{out_name}.html'
    out.write_text('\n'.join(page), encoding='utf-8')
    print(f'試聽頁 {out}')
    for c in cfgs:
        bs = [best[c][k][1] for k in keys]
        print(f'  {c}：完美 {sum(not b["misread"] and not b["extra"] for b in bs)}/{len(bs)}，可上線 {sum(live(b) for b in bs)}/{len(bs)}，'
              f'平均念錯率 {sum(b["misread"] for b in bs) / len(bs):.1%}')


if __name__ == '__main__':
    main()
