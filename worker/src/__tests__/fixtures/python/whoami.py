import os

# Verify the program runs as a non-root user (uid=1000 / runner).
# User: "1000:1000" is set in sandboxHostConfig via runner.ts.
uid = os.getuid()
gid = os.getgid()
print(f"uid={uid}")
print(f"gid={gid}")
print(f"is_root={'YES' if uid == 0 else 'NO'}")