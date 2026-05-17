import sys

data = sys.stdin.read().split()
n = int(data[0])
nums = [int(x) for x in data[1:1 + n]]
target = int(data[1 + n])

seen = {}
for i, v in enumerate(nums):
    need = target - v
    if need in seen:
        print(seen[need], i)
        break
    seen[v] = i
