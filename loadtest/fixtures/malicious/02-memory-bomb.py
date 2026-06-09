# Demo A · 耗記憶體程式碼 —— 預期判定：MLE 或 RE（記憶體超限被終止）
#
# 攻擊情境：面試者上傳無限配置記憶體的程式，想吃光節點 RAM。
# 防護：isolate --mem（cgroup 記憶體上限）觸發後終止程序。依 OOM 被攔截的
#       方式，verdict 為 MLE 或 RE —— 兩者都代表「被控制、未吃光主機」；
#       worker pod 本身另有 memory:1Gi 上限作為第二層保護。
chunk = "x" * (1024 * 1024)  # 1 MiB
blob = []
while True:
    blob.append(chunk * 64)  # 每輪再吃 64 MiB
