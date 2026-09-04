$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$content = [System.IO.File]::ReadAllText("D:\Desktop\py\amazon-ai-ops\amazon-ai-ops-autonomy-prototype\src\App.jsx", [System.Text.Encoding]::UTF8)
$lines = $content -split "`n"
$out = @()
$out += "Total lines: $($lines.Count)"
for ($i = 54; $i -lt 62; $i++) {
    $out += "L$($i+1): $($lines[$i])"
}
[System.IO.File]::WriteAllLines("D:\Desktop\py\amazon-ai-ops\lines_out.txt", $out, [System.Text.Encoding]::UTF8)