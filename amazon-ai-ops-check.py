path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()
# Find line 58
lines = data.split(b'\n')
print('Total lines:', len(lines))
# Find the AI_MODES block
for i, line in enumerate(lines):
    if b'AI_MODES' in line:
        print('  line', i+1, ':', line[:80].decode('utf-8', errors='replace'))
        for j in range(i, min(i+5, len(lines))):
            l = lines[j][:120].decode('utf-8', errors='replace')
            print('    L' + str(j+1) + ':', l)
        break
# Check if `?` is in line 58 (indicating a corrupted char)
import re
n = 0
for i, line in enumerate(lines):
    if b'\xe9' in line and b'?' in line and b'short' in line:
        n += 1
        print('Suspicious line', i+1, ':', line[:120])
        if n > 5: break