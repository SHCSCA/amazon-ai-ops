path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()

# Now fix L58/L59 which have GBK chars + stray ASCII ?
# L58: label "半自动?, short "鍗婅嚜"
# L59: label "绛栫暐鍐呰嚜鍔?, short "鑷"

# Replace corrupted strings with correct UTF-8
fixes = [
    # (broken_utf8_bytes, correct_utf8_bytes_or_str)
    (b'"\xe5\x8d\x8a\xe8\x87\xaa\xe5\x8a\xa8?, short: "\xe9\x8d\x97\xe5\xa9\x85\xe5\x9a\x9c"',
     b'"\xe5\x8d\x8a\xe8\x87\xaa\xe5\x8a\xa8", short: "\xe5\x8d\x8a\xe8\x87\xaa"'),

    (b'"\xe7\xbb\x9b\xe6\xa0\xab\xe6\x9a\x90\xe9\x8d\x90\xe5\x91\xb0\xe5\x9a\x9c\xe9\x8d\x94?, short: "\xe9\x91\xb7\xee\x81\x84\xe5\xa7\xa9"',
     b'"\xe7\xad\x96\xe7\x95\xa5\xe5\x86\x85\xe8\x87\xaa\xe5\x8a\xa8", short: "\xe8\x87\xaa\xe5\x8a\xa8"'),
]

for i, (broken, correct) in enumerate(fixes):
    found = data.count(broken)
    print(f'Fix {i+1}: found {found} times')
    if found:
        data = data.replace(broken, correct)

# More general fix: find any '...' sequences ending with "?, " pattern and check
# if preceding content is GBK chars. Actually let me scan all lines with the pattern
# '"...?, ' which indicates a Chinese string with stray ASCII ?
import re
pattern = re.compile(b'"([\xe0-\xef][\x80-\xbf]{2,})[?]?,')
candidates = []
for m in pattern.finditer(data):
    byte_start = m.start()
    chunk = m.group(0)
    candidates.append((byte_start, chunk))

print(f'\nFound {len(candidates)} candidate "X?" patterns')
for s, c in candidates[:10]:
    print(f'  @{s}: {c[:60]}')

# Don't apply blind replacement - too risky. Just fix the known ones.
with open(path, 'wb') as f:
    f.write(data)
print('\nWritten. New size:', len(data))
