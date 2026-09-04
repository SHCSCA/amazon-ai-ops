path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()

# Search for AI_MODES area
idx = data.find(b'AI_MODES')
print(f'AI_MODES at byte {idx}')
chunk = data[idx:idx+400]
print('Chunk hex:', chunk.hex())
# Look for known corrupt labels - search for byte sequence
# 浜 = E6 B5 9C in UTF-8
print('Looking for 浜=E6B59C:', b'\xe6\xb5\x9c' in data)
print('Looking for half label (E5 8D 8A):', b'\xe5\x8d\x8a' in data)
# Check if our previous replacement took effect
for pat in [b'\xe6\xb5\x9c\xe5\x93\x84\xe4\xbc\x90\xe7\x80\xb9\xe5\xa3\x92', b'\xe4\xba\xba\xe5\x86\x85\xe5\xae\xa1\xe6\x89\xb9']:
    print(f'  {pat}: found={pat in data}, count={data.count(pat)}')

# Look at exact lines 56-60 by line index
lines = data.split(b'\n')
for i in range(55, 61):
    print(f'L{i+1}: {lines[i][:80]}')
