# Demo A · 讀取主機檔案（竊取系統 / 他人資料）—— 預期判定：RE
#
# 攻擊情境：面試者上傳會去讀 /etc/shadow、其他容器掛載或主機檔案的程式。
# 防護：isolate 以獨立 rootfs + chroot 啟動 box，box 內看到的 /etc 是該語言
#       rootfs 的 /etc，讀不到主機機密；存取失敗丟出例外 → verdict 回 RE。
targets = ["/etc/shadow", "/proc/1/environ", "/var/lib/oct/rootfs"]
for path in targets:
    with open(path) as f:  # FileNotFoundError / PermissionError → RE
        print(path, "->", f.read()[:64])
