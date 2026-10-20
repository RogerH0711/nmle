#!/bin/bash
# 在 Colab VM 上安裝 vLLM（由 colab_job.py 呼叫）。10/20 在 A100 40GB 上實測可用的組合：
# - Python 3.12 的 venv：Colab 預設是 3.13，vLLM 的 wheel 不一定支援
# - vllm 固定 0.32.0：10/20 安裝時的最新版，Qwen3.6-27B-FP8 實測可跑
# - ninja：vLLM 在 A100 上要即時編譯 kernel（flashinfer JIT），而且 venv 的 bin 要在 PATH 裡才找得到
set -ex
cd /content
pip install -q uv
uv venv /content/venv -p 3.12
uv pip install --python /content/venv/bin/python "vllm==0.32.0" ninja --torch-backend=auto
export PATH=/content/venv/bin:$PATH
python -c "import vllm; print('vllm', vllm.__version__)"
which ninja
echo INSTALL_DONE
