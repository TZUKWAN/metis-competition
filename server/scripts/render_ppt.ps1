# render_ppt.ps1 — PowerPoint COM 导出：幻灯片 PNG + 整册 PDF
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File render_ppt.ps1 <pptx路径> <png输出目录> [pdf输出路径]
param(
  [Parameter(Mandatory=$true)][string]$PptxPath,
  [Parameter(Mandatory=$true)][string]$PngDir,
  [string]$PdfPath = ""
)
$ErrorActionPreference = "Stop"
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open($PptxPath, $true, $false, $false)  # ReadOnly, Untitled, WithWindow=false
  New-Item -ItemType Directory -Force -Path $PngDir | Out-Null
  for ($i = 1; $i -le $pres.Slides.Count; $i++) {
    $out = Join-Path $PngDir ("slide-{0:d2}.png" -f $i)
    $pres.Slides.Item($i).Export($out, "PNG", 1600, 900)
  }
  if ($PdfPath -ne "") {
    $pres.SaveAs($PdfPath, 32)  # ppSaveAsPDF = 32
  }
  $pres.Close()
  Write-Output ("OK slides=" + $pres.Slides.Count)
} finally {
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
