path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()
lines = data.split(b'\n')
for i in range(55, 63):
    print(f'L{i+1} len={len(lines[i])} bytes={lines[i].hex()}')
    print(f'     utf8={lines[i].decode("utf-8", errors="replace")}')
    print()