import os

# Attempt to write to several locations on the read-only root filesystem.
# ReadonlyRootfs: true should make every write fail with PermissionError /
# ReadOnlyFileSystem error. The sandbox allows writes only to /tmp (tmpfs).
results = []
targets = ["/etc/owned", "/usr/owned", "/bin/owned", "/owned"]
for path in targets:
    try:
        with open(path, "w") as f:
            f.write("owned")
        results.append(f"WRITE_SUCCEEDED:{path}")
    except OSError:
        results.append(f"write_blocked:{path}")

# /tmp should still be writable (tmpfs is explicitly mounted rw)
try:
    with open("/tmp/allowed", "w") as f:
        f.write("ok")
    results.append("tmp_write_ok")
except OSError:
    results.append("tmp_write_also_blocked")

print("\n".join(results))