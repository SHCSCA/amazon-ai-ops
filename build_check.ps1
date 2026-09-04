$env:LC_ALL = 'C.UTF-8'
$env:LANG = 'C.UTF-8'
$env:PYTHONIOENCODING = 'utf-8'
Set-Location 'D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype'
npx vite build 2>&1 | Out-File -Encoding UTF8 'D:\Desktop\py\amazon-ai-ops\build_result.txt'
exit $LASTEXITCODE