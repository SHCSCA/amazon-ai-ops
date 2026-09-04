path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()

# These are GBK-encoded versions of original UTF-8 strings.
# Try to find each corrupted label and replace with proper UTF-8.

# 1. "浜哄伐瀹℃壒" (GBK for corrupted) -> should be "人工审批"
# GBK: 浜=B0 BA, 哄=B9 B5 (wrong! this is the corrupted version)
# Actually "浜哄伐瀹℃壒" in GBK bytes corresponds to a different string.
# The file has UTF-8 bytes that look like "浜哄伐瀹℃壒" when decoded as UTF-8 directly.
# So the file CONTENT is literally those corrupted Unicode codepoints in UTF-8 bytes.

# Let me check the actual UTF-8 codepoints
broken_label = "浜哄伐瀹℃壒".encode('utf-8')
correct_label = "人工审批".encode('utf-8')
print(f'broken label utf-8: {broken_label.hex()}')
print(f'correct label utf-8: {correct_label.hex()}')

# Find broken_label in data
idx = data.find(broken_label)
print(f'broken_label found at: {idx}')

# Replace
data = data.replace(broken_label, correct_label)

# Same for short label "浜哄伐"
data = data.replace("浜哄伐".encode('utf-8'), "人工".encode('utf-8'))

# "半自动" - check the corruption
# Original line 58 should have label "半自动" (E5 8D 8A E8 87 AA E5 8A A8)
# Current line 58 in the file is "鍗婅嚜鍔" - what UTF-8 bytes are those?
broken_semi_label = "鍗婅嚜鍔".encode('utf-8')
correct_semi_label = "半自动".encode('utf-8')
print(f'\nbroken semi utf-8: {broken_semi_label.hex()}')
print(f'correct semi utf-8: {correct_semi_label.hex()}')
idx2 = data.find(broken_semi_label)
print(f'broken semi found at: {idx2}')
data = data.replace(broken_semi_label, correct_semi_label)

# short "半自" -> should be "半自" (correct already)
data = data.replace("半自".encode('utf-8'), "半自".encode('utf-8'))  # no-op

# Line 59: "绛栫暐鍐呰嚜鍔" - decode this in GBK?
# Actually, since they're already corrupted to wrong Unicode chars,
# we need to replace them with correct UTF-8 bytes.
# Let me read what's in file
import re
m = re.search(b'label: "([^"]+)", short', data)
if m:
    s = m.group(1)
    print(f'\nFirst label found: {s.hex()} = {s.decode("utf-8", errors="replace")}')

# Save
with open(path, 'wb') as f:
    f.write(data)
print('\nWritten')