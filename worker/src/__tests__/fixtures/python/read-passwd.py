try:
    with open("/etc/passwd") as f:
        print(f.readline().strip())
except Exception as e:
    print(f"Error: {e}")
