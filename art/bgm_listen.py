# BGM 試聽頁：把 art/bakeoff/bgm/ 的候選列成一頁，給 Roger 每首挑一個
#
#   art/ace-step/.venv/Scripts/python.exe -X utf8 art/bgm_listen.py
# 輸出：art/bakeoff/bgm/index.html（不進 repo），瀏覽器直接開檔案就能聽。
from pathlib import Path

OUT = Path(__file__).parent / 'bakeoff' / 'bgm'

LABELS = {
    'map': '校園地圖、排行榜、模擬考首頁',
    'library': '錯題複習',
    'theme_jingcheng': '沈靜澄（酷系）',
    'theme_yiqing': '夏以晴（元氣）',
    'theme_ying': '葉縈（病嬌）',
    'theme_zhixun': '溫芷薰（大姊姊）',
    'theme_fei': '顏緋（傲嬌）',
}

parts = [
    '<!doctype html><meta charset="utf-8"><title>BGM 候選</title>',
    '<style>body{font:16px sans-serif;max-width:760px;margin:2em auto;padding:0 16px}'
    'td{padding:4px 12px 4px 0}audio{width:520px;max-width:100%}</style>',
    '<h1>BGM 候選</h1><p>每首 100 秒。挑的時候留意：有沒有人聲、音量會不會突然變大、放著讀書會不會分心。</p>',
]
for track, label in LABELS.items():
    parts.append(f'<h2>{label}<br><small>{track}</small></h2><table>')
    for path in sorted((OUT / track).glob('*.flac')):
        parts.append(f'<tr><td>{path.stem}</td><td><audio controls preload="none" src="{track}/{path.name}"></audio></td></tr>')
    parts.append('</table>')
(OUT / 'index.html').write_text('\n'.join(parts), encoding='utf-8')
