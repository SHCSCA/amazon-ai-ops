path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()
lines = data.split(b'\n')

# Print raw hex of lines 55-62
for i in range(54, 62):
    print(f'L{i+1} hex={lines[i].hex()}')
