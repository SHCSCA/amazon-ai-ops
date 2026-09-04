# Read App.jsx as UTF-8 and find the bad line
$content = [System.IO.File]::ReadAllText("D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx", [System.Text.Encoding]::UTF8)
$lines = $content -split "`n"
Write-Host "Total lines: $($lines.Count)"
Write-Host "Lines 55-62:"
for ($i = 54; $i -lt 62; $i++) {
    Write-Host "L$($i+1): $($lines[$i])"
}
