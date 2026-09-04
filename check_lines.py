path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()
lines = data.split(b'\r\n' if b'\r\n' in data else b'\n')
print(f'Line 55 (0-indexed 54): {lines[54][:60]}')
print(f'Line 56: {lines[55][:60]}')
print(f'Line 57: {lines[56][:60]}')
print(f'Line 58: {lines[57]}')
print(f'Line 59: {lines[58][:60]}')
print(f'Line 60: {lines[59][:60]}')
# Check for corruption in line 58
b = lines[57]
print(f'Line 58 hex: {b.hex()}')
# Find what comes after 'label: "'
import re
m = re.search(b'label: "([^"]*)"', b)
if m:
    print(f'Label value hex: {m.group(1).hex()}')
    print(f'Label value: {m.group(1).decode("utf-8", errors="replace")}')
