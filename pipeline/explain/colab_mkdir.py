"""在 Colab kernel 裡建立 colab_run.py 上傳要用的資料夾（colab upload 不會自己建）。"""
import os

for d in ("/content/incoming", "/content/queue", "/content/results"):
    os.makedirs(d, exist_ok=True)
print("ok")
