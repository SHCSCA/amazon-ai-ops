path = r'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx'
with open(path, 'rb') as f:
    data = f.read()
lines = data.split(b'\n')
# Show bytes of lines 126-135
for i in range(125, 140):
    if i < len(lines):
        print(f'L{i+1}: {lines[i][:100]}')
        # Show decoded
        try:
            decoded = lines[i].decode('utf-8')
            print(f'    utf-8: {decoded[:100]}')
        except:
            print(f'    [decode error]')
