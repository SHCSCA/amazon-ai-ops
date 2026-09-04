path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()

# Strategy: search for any sequence of UTF-8 bytes that look like GBK garbage
# The pattern: GBK Chinese chars are 2 bytes each, range 0x81-0xFE.
# In UTF-8, Chinese chars use 3 bytes: 0xE0-0xEF + 0x80-0xBF + 0x80-0xBF
# The corrupted strings have UTF-8 codepoints like U+6FF6, U+6FB9 which are in the
# CJK Compatibility area. These correspond to chars that are common in GBK but not UTF-8.

# Most reliable approach: build a mapping of GBK->UTF-8 substitution table.
# Let me use cchardet/charset detection per line instead.

# Read line by line, for each line try to detect GBK corruption
lines = data.split(b'\n')
print(f'Processing {len(lines)} lines')

def fix_line(line):
    # Try: if line has high bytes that decode as GBK to a meaningful Chinese string,
    # re-encode to UTF-8
    try:
        decoded = line.decode('gbk')
        # Check if the decoded string contains lots of valid Chinese chars
        # vs Latin punctuation (which indicates GBK didn't really decode)
        import re
        chinese_count = sum(1 for c in decoded if '\u4e00' <= c <= '\u9fff')
        latin_count = sum(1 for c in decoded if c.isalpha() and ord(c) < 128)
        if chinese_count > 2 and latin_count < chinese_count * 0.3:
            return decoded.encode('utf-8')
    except Exception:
        pass
    return line

new_lines = [fix_line(l) for l in lines]
new_data = b'\n'.join(new_lines)

with open(path, 'wb') as f:
    f.write(new_data)
print(f'Old size: {len(data)}, New size: {len(new_data)}')
print(f'Diff: {len(new_data) - len(data)} bytes')
