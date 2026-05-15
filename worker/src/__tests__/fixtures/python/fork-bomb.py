import os
# Will raise OSError once PidsLimit is exhausted → unhandled exception → RE.
while True:
    os.fork()
