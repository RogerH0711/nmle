# 配音試聽頁的本機伺服器：放 art/bakeoff/voice/breezy 的試聽頁和音檔，挑選頁（voice_pick.py）點選的結果存進 art/voice_picks.json
#（11/15 Roger：複製貼上手很酸，要能直接勾選）。只聽 127.0.0.1，外面連不到。
#
#   python art/voice_server.py            # http://localhost:8765/fei-pick.html
#
# voice_picks.json：{角色: {設定: {語音 key: {'take': 第幾次 或 null（都不行）, 'note': 備註}}}}，voice_export.py 匯出時讀
import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ART = Path(__file__).resolve().parent
ROOT = ART / 'bakeoff' / 'voice' / 'breezy'
PICKS = ART / 'voice_picks.json'


def load():
    return json.loads(PICKS.read_text(encoding='utf-8')) if PICKS.exists() else {}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] == '/picks':
            return self.reply(load())
        return super().do_GET()

    def do_POST(self):
        if self.path != '/picks':
            return self.send_error(404)
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        picks = load()
        entry = {'take': body.get('take')}
        if body.get('note'):
            entry['note'] = body['note']
        picks.setdefault(body['cid'], {}).setdefault(body['cfg'], {})[body['key']] = entry
        PICKS.write_text(json.dumps(picks, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
        self.reply({'ok': True})

    def reply(self, obj):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'http://localhost:{port}/  （{ROOT}）', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(ROOT))).serve_forever()
