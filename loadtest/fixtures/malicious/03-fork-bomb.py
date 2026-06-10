# Demo A · Fork bomb（程序炸彈）—— 預期判定：RE
#
# 攻擊情境：面試者上傳不斷 fork 子程序的程式，想耗盡 PID / 排程器。
# 防護：isolate --processes 限制 box 內的程序數，fork() 達上限後丟出
#       OSError，未捕捉 → 程序非正常結束，verdict 回 RE（不會擴散到主機）。
import os

for _ in range(1_000_000):
    os.fork()  # 觸及 --processes 上限後拋 OSError
