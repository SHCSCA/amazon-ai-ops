path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()
lines = data.split(b'\n')

print(f'Total lines: {len(lines)}')

# Fix line 57: the label is corrupted
# "人工审批" correct bytes: e4 ba e5 86 85 e5 ae a1 e6 89 b9
# current bytes: e6 b5 9c e5 93 84 e4 bc 90 e7 80 b9 e5 a3 92
old57 = b'{ id: "manual", label: "\xe6\xb5\x9c\xe5\x93\x84\xe4\xbc\x90\xe7\x80\xb9\xe5\xa3\x92", short: "\xe6\xb5\x9c\xe5\x93\x84\xe4\xbc\x90", icon: UserCircle, color: "#64748b" },'
new57 = b'{ id: "manual", label: "\xe4\xba\xba\xe5\x86\x85\xe5\xae\xa1\xe6\x89\xb9", short: "\xe4\xba\xba\xe5\x86\x85", icon: UserCircle, color: "#64748b" },'
print(f'L57 found: {old57 in data}')

# Fix line 58: "半自动" = e5 8d 8a e8 87 aa e5 8a a8
# current: e5 8d 8a e5 a9 8c e9 8d 94 3f (truncated at ?)
# Find the exact bad sequence
old58_prefix = b'{ id: "semi", label: "'
# search for it
for i, line in enumerate(lines):
    if old58_prefix in line and b'short' in line:
        print(f'Line {i+1}: {line}')
        # Find where short starts
        short_idx = line.find(b'short')
        print(f'  label part: {line[:short_idx]}')
        print(f'  label hex: {line[:short_idx].hex()}')
        # Find exact bad seq
        bad_seq = line[:short_idx]  # The label part ending with ? or truncated char
        print(f'  bad seq found in data: {bad_seq in data}')

# More targeted: search for the specific truncation pattern
# "半自动" is E5 8D 8A E8 87 AA E5 8A A8
# The bad version ends with something like E5 A9 8C E9 8D 94 (before closing ")
pattern = b'\xe5\x8d\x8a' + b'.\?\?' + b'", short'  # ?=unknown corrupted
import re
matches = list(re.finditer(b'\xe5\x8d\x8a[^\x22]{3,6}\x22, short', data))
print(f'Found {len(matches)} truncated semi label patterns')
for m in matches:
    print(f'  match: {m.group()!r}')
