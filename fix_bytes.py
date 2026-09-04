path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()

# 修复 AI_MODES（之前 StrReplace 把"自动"截了"动"）
old1 = b'{ id: "manual", label: "\xe4\xba\xba\xe5\xb7\xa5\xe5\xae\xa1\xe6\x89\xb9", short: "\xe4\xba\xba\xe5\xb7\xa5", icon: UserCircle, color: "#64748b" },'
new1 = b'{ id: "manual", label: "\xe4\xba\xba\xe5\xb7\xa5\xe5\xae\xa1\xe6\x89\xb9", short: "\xe4\xba\xba\xe5\xb7\xa5", icon: UserCircle, color: "#64748b" },'
# 这行其实是好的（包含全部 8 字节汉字）。检查文件实际内容

# 找所有 '"\xe5\x8d\x8a\xe8\x87\xaa" 截断的字节序列
import re
# 半 = e5 8d 8a, 自 = e8 87 aa, 动 = e5 8a a8
# 预期正确的 label "半自动" = e5 8d 8a e8 87 aa e5 8a a8
# 实际错误 "半自" (缺"动"字 e5 8a a8)
bad_seq = b'"\xe5\x8d\x8a\xe8\x87\xaa", short: "\xe5\x8d\x8a\xe8\x87\xaa"'
fixed_seq = b'"\xe5\x8d\x8a\xe8\x87\xaa\xe5\x8a\xa8", short: "\xe5\x8d\x8a\xe8\x87\xaa"'

count = data.count(bad_seq)
print(f'Found {count} occurrences of broken semi label')
data = data.replace(bad_seq, fixed_seq)

# 类似修复 "策略内自动" 截断
# 策 = e7 ad 96, 略 = e7 95 a5, 内 = e5 86 85, 自 = e8 87 aa, 动 = e5 8a a8
bad2 = b'"\xe7\xad\x96\xe7\x95\xa5\xe5\x86\x85\xe8\x87\xaa", short: "\xe9\x94\x81\xe2\xbd\x84\xe5\xa8\xb6"'
fixed2 = b'"\xe7\xad\x96\xe7\x95\xa5\xe5\x86\x85\xe8\x87\xaa\xe5\x8a\xa8", short: "\xe8\x87\xaa\xe5\x8a\xa8"'
count2 = data.count(bad2)
print(f'Found {count2} occurrences of broken auto label')
data = data.replace(bad2, fixed2)

with open(path, 'wb') as f:
    f.write(data)
print('Written, new size:', len(data))