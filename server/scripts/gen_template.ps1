# gen_template.ps1 — 生成一个简洁的测试 PPT 模板（6 个版式页），用于 PPT 链路验证与默认测试模板
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File gen_template.ps1 <输出pptx路径>
param([Parameter(Mandatory=$true)][string]$OutPath)
$ErrorActionPreference = "Stop"
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Add()
  $blank = $pres.SlideMaster.CustomLayouts.Item(7)  # 空白版式

  function Add-Text($slide, $left, $top, $width, $height, $text, $size, $bold, $color) {
    $shape = $slide.Shapes.AddTextbox(1, $left, $top, $width, $height)  # msoTextOrientationHorizontal=1
    $shape.TextFrame.TextRange.Text = $text
    $shape.TextFrame.TextRange.Font.Size = $size
    $shape.TextFrame.TextRange.Font.Bold = $bold
    $shape.TextFrame.TextRange.Font.Color.RGB = $color
    return $shape
  }

  # 1 封面
  $s = $pres.Slides.AddSlide(1, $blank)
  Add-Text $s 60 200 600 80 "项目名称" 44 $true 2302755 | Out-Null
  Add-Text $s 60 300 600 50 "一句话项目定位说明文字" 20 $false 4471305 | Out-Null
  Add-Text $s 60 480 600 40 "团队名称 · 2026" 14 $false 7697781 | Out-Null

  # 2 标题+正文
  $s = $pres.Slides.AddSlide(2, $blank)
  Add-Text $s 60 40 600 60 "页面标题" 32 $true 2302755 | Out-Null
  Add-Text $s 60 130 600 300 "正文要点一`n正文要点二`n正文要点三" 18 $false 2302755 | Out-Null

  # 3 三卡片
  $s = $pres.Slides.AddSlide(3, $blank)
  Add-Text $s 60 40 600 60 "核心优势" 32 $true 2302755 | Out-Null
  Add-Text $s 40 150 190 120 "优势一`n说明文字" 16 $false 2302755 | Out-Null
  Add-Text $s 250 150 190 120 "优势二`n说明文字" 16 $false 2302755 | Out-Null
  Add-Text $s 460 150 190 120 "优势三`n说明文字" 16 $false 2302755 | Out-Null

  # 4 图文页
  $s = $pres.Slides.AddSlide(4, $blank)
  Add-Text $s 60 40 600 60 "产品功能展示" 32 $true 2302755 | Out-Null
  Add-Text $s 60 140 280 300 "功能说明文字`n分点描述" 16 $false 2302755 | Out-Null
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 800, 500
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(226, 232, 240))
  $g.Dispose()
  $tmpImg = Join-Path $env:TEMP "metis-tpl-placeholder.png"
  $bmp.Save($tmpImg, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $s.Shapes.AddPicture($tmpImg, $false, $true, 370, 140, 260, 160) | Out-Null

  # 5 图表页
  $s = $pres.Slides.AddSlide(5, $blank)
  Add-Text $s 60 40 600 60 "数据图表" 32 $true 2302755 | Out-Null
  $chartShape = $s.Shapes.AddChart(51, 60, 130, 560, 320)  # xlColumnClustered=51
  $chartShape.Chart.ChartData.Activate() | Out-Null
  Add-Text $s 60 470 600 40 "图表说明文字" 14 $false 7697781 | Out-Null

  # 6 结束页
  $s = $pres.Slides.AddSlide(6, $blank)
  Add-Text $s 60 220 600 80 "感谢聆听" 44 $true 2302755 | Out-Null
  Add-Text $s 60 320 600 50 "联系方式与二维码占位" 16 $false 4471305 | Out-Null

  $pres.SaveAs($OutPath)
  $pres.Close()
  Write-Output "OK"
} finally {
  $ppt.Quit()
}
