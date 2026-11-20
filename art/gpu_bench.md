# 本機 GPU 速度紀錄

`art/gpu_bench.py` 的結果，新的接在最後。

## 2026-11-18 16:53　matmul　解鎖前

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- 矩陣乘法 8192×8192 fp16：32.3 TFLOPS
- 矩陣乘法 8192×8192 bf16：33.2 TFLOPS
- 矩陣乘法 8192×8192 fp32（不用 TF32）：10.2 TFLOPS
- GPU 忙碌時平均 1614 MHz、112 W（最高 1725 MHz、141 W）
- PyTorch 2.14.1+cu130、CUDA 13.0

## 2026-11-18 16:55　sdxl　解鎖前

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Animagine XL 4.0，1024×1024、28 步：20.0 / 20.1 秒（平均 0.72 秒／步，含 cpu offload 的搬移）
- GPU 忙碌時平均 1713 MHz、113 W（最高 1995 MHz、130 W）

## 2026-11-18 16:57　breeze　解鎖前

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Breeze TTS 2 念一句（32 字）：40.9 / 39.6 秒，念出 6.8 / 6.8 秒的語音（每秒語音要 5.92 秒）
- GPU 忙碌時平均 1981 MHz、73 W（最高 1995 MHz、82 W）
- PyTorch 2.9.1+cu128

## 2026-11-18 21:04　matmul　解鎖後

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- 矩陣乘法 8192×8192 fp16：33.0 TFLOPS
- 矩陣乘法 8192×8192 bf16：32.9 TFLOPS
- 矩陣乘法 8192×8192 fp32（不用 TF32）：9.9 TFLOPS
- GPU 忙碌時平均 1584 MHz、108 W（最高 1665 MHz、114 W）
- PyTorch 2.14.1+cu130、CUDA 13.0

## 2026-11-18 21:06　sdxl　解鎖後

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Animagine XL 4.0，1024×1024、28 步：20.1 / 20.1 秒（平均 0.72 秒／步，含 cpu offload 的搬移）
- GPU 忙碌時平均 1707 MHz、115 W（最高 1995 MHz、133 W）

## 2026-11-18 21:08　breeze　解鎖後

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Breeze TTS 2 念一句（32 字）：29.2 / 27.5 秒，念出 6.8 / 6.8 秒的語音（每秒語音要 4.17 秒）
- GPU 忙碌時平均 1956 MHz、75 W（最高 1995 MHz、89 W）
- PyTorch 2.9.1+cu128

## 11/18 解鎖（nv-uefi-unlocker）前後的結論

ssdiag：`VERDICT [ampere]: UNLOCKED`（SS0 = 0x88888888，canary intact）。

| | 解鎖前 | 解鎖後 | 差 |
|---|---|---|---|
| matmul fp16（本檔） | 32.3 | 33.0 TFLOPS | +2% |
| matmul bf16（本檔） | 33.2 | 32.9 TFLOPS | −1% |
| matmul fp32（本檔） | 10.2 | 9.9 TFLOPS | −3% |
| Animagine 1024²、28 步 | 20.0 秒 | 20.1 秒 | 0 |
| Breeze TTS 2 每秒語音 | 5.92 秒 | 4.17 秒 | 快 30% |

- Roger 另外量的（Claude desktop 那邊，各 3 次）：fp32 +13%、TF32／fp16／bf16 +19%；fp32 不走 Tensor Core 也快了 13%，
  扣掉測試條件的差別後 Tensor Core 只多約 5%。每時脈效率 fp16／bf16 都是 543 FLOP/clk/SM（GeForce 上限 512、全開 1024）。
- 結論（推論）：PyTorch 走 cuBLAS，沒有吃到解鎖的好處；和 README 裡 3070 Ti Laptop 的回報一致。
- Breeze 快 30% 不太可能是解鎖造成的：它只用 75 W、時脈接近滿載，卡在一堆小運算的延遲，不是算力。
  比較可能是重開機後 CPU／背景程式的狀態不同。要確認：不插 USB 開機（解鎖清掉）後再跑一次 breeze。

## 2026-11-18 22:48　breeze　沒解鎖（重開機清掉）第 1 輪

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Breeze TTS 2 念一句（32 字）：41.4 / 43.4 秒，念出 6.8 / 6.8 秒的語音（每秒語音要 6.23 秒）
- GPU 忙碌時平均 1974 MHz、72 W（最高 2010 MHz、77 W）
- PyTorch 2.9.1+cu128

## 2026-11-18 22:50　breeze　沒解鎖（重開機清掉）第 2 輪

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Breeze TTS 2 念一句（32 字）：44.5 / 43.9 秒，念出 6.8 / 6.8 秒的語音（每秒語音要 6.50 秒）
- GPU 忙碌時平均 1980 MHz、73 W（最高 1980 MHz、77 W）
- PyTorch 2.9.1+cu128

## 2026-11-18 22:52　breeze　沒解鎖（重開機清掉）第 3 輪

NVIDIA GeForce RTX 3070 Laptop GPU, 610.47

- Breeze TTS 2 念一句（32 字）：40.1 / 37.7 秒，念出 6.8 / 6.8 秒的語音（每秒語音要 5.72 秒）
- GPU 忙碌時平均 1980 MHz、75 W（最高 1980 MHz、79 W）
- PyTorch 2.9.1+cu128

### 11/18 補量：重開機清掉解鎖（ssdiag NOT_UNLOCKED）後 Breeze 三輪

| | 每秒語音要幾秒 |
|---|---|
| 解鎖前（16:57） | 5.92 |
| 解鎖後（21:08，只量 1 輪） | **4.17** |
| 沒解鎖第 1／2／3 輪 | 6.23 / 6.50 / 5.72 |

- 三輪期間 CPU 平均 21%、最高 33%（typeperf，每 2 秒），GPU 72–75 W、約 1980 MHz，和解鎖後那輪一樣。
- 所以上面「Breeze 快 30% 不太可能是解鎖造成的」是錯的推論：CPU 和功耗條件相同，沒解鎖的 4 輪都在 5.7–6.5，只有解鎖那輪是 4.2。
  可能的解釋（推論）：Breeze 每步都是小矩陣，沒頂到功耗牆，Tensor Core 每時脈多出來的吞吐量不會被功耗吃掉；大 matmul、SDXL 頂在 130 W，被功耗牆吃掉。
- 解鎖後只有 1 輪，還要再解鎖量 3 輪才算確定。

### 解鎖的用法（11/18 Roger 設定好）

平常不插 USB、正常開機（Secure Boot 開著，MOK 已登記，快速啟動關閉）。要跑大批配音（Breeze）時插 USB（NVBOOT 分割區），
用「重新啟動」開機、看到版本畫面按 Space；進 Windows 後跑 per_clock.py，約 540 FLOP/clk/SM 代表解鎖成功（沒解鎖約 500）。
SDXL／Qwen 出圖頂在功耗牆，解不解鎖都一樣。
