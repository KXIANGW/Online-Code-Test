import urllib.request
try:
    urllib.request.urlopen('http://example.com', timeout=2)
    print("Connected!")
except Exception as e:
    print(f"Network blocked: {e}")
