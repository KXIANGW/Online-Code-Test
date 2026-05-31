import os

# Verify the program runs as a non-root user (uid=1000 / runner).
# The sandbox should run candidate code as a non-root user.
uid = os.getuid()
gid = os.getgid()
print(f"uid={uid}")
print(f"gid={gid}")
print(f"is_root={'YES' if uid == 0 else 'NO'}")
