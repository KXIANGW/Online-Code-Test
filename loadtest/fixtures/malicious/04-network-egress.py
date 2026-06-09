# Demo A · 對外連線（資料外洩嘗試）—— 預期判定：RE（連線失敗）
#
# 攻擊情境：面試者上傳會把測資 / 環境變數送到外部伺服器的程式。
# 防護：isolate 未開 --share-net，box 在獨立的 network namespace 內只有
#       loopback，對外連線丟出 OSError（Network is unreachable）。
#       "LEAKED" 永遠不會印出，verdict 回 RE。
import socket

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(("1.1.1.1", 80))  # 對外連線 → OSError
print("LEAKED")
