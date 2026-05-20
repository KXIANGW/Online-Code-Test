import socket

# Verify that CapDrop: ["ALL"] prevents privileged operations.
# Each operation below requires a specific Linux capability that has been dropped.
results = []

# CAP_SYS_ADMIN: required for sethostname()
try:
    socket.sethostname("hacked")
    results.append("SETHOSTNAME_SUCCEEDED")
except (PermissionError, OSError):
    results.append("sethostname_blocked")

# CAP_NET_RAW: required to open a raw (packet-capture) socket
try:
    s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0800))
    s.close()
    results.append("RAW_SOCKET_SUCCEEDED")
except (PermissionError, OSError):
    results.append("raw_socket_blocked")

# CAP_NET_ADMIN: required to manipulate network interfaces
try:
    import subprocess
    result = subprocess.run(
        ["ip", "link", "set", "lo", "down"],
        capture_output=True, timeout=3
    )
    if result.returncode == 0:
        results.append("IP_LINK_SET_SUCCEEDED")
    else:
        results.append("ip_link_set_blocked")
except (PermissionError, OSError, FileNotFoundError):
    results.append("ip_link_set_blocked")

print("\n".join(results))