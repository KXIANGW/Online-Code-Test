# Demo A · 耗 CPU / 耗時程式碼 —— 預期判定：TLE
#
# 攻擊情境：面試者上傳會跑不完的程式，想拖垮判題資源。
# 防護：isolate 以 --time（CPU 時間）與 --wall-time（牆鐘時間）上限強制
#       終止程序，worker 不會被卡住，verdict 回 TLE。
while True:
    pass
