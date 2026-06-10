# Demo A · 危險 syscall（namespace / 提權嘗試）—— 預期：syscall 被擋
#
# 攻擊情境：面試者上傳呼叫 unshare()/mount() 等想跳出沙箱、提權的程式。
# 防護：worker 套用自訂 seccomp 政策（worker/sandbox/isolate-seccomp.policy），
#       對 unshare / setns / clone3 / mount / ptrace / bpf 等回 ENOSYS(38)。
#       下方 unshare 必然回 rc=-1、errno=38，無法建立新 namespace；
#       輸出與題目預期不符 → verdict 回 WA/RE，且「無提權發生」即為佐證。
import ctypes
import ctypes.util

libc = ctypes.CDLL(ctypes.util.find_library("c"), use_errno=True)
CLONE_NEWNS = 0x00020000
rc = libc.unshare(CLONE_NEWNS)
print("unshare rc =", rc, "errno =", ctypes.get_errno())  # 預期 rc=-1 errno=38
