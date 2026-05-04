Add-Type -AssemblyName System.Drawing

$AppRoot = "C:\Users\user\Desktop\CNC-Recruit-App"
$IcoOut  = Join-Path $AppRoot "release\.icon-ico\icon.ico"
$PngOut  = Join-Path $AppRoot "icon.png"
$PngPub  = Join-Path $AppRoot "public\icon.png"

function New-CncBitmap {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $rect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size

    $radius = [int]($Size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
    $path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
    $path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point 0, 0),
        (New-Object System.Drawing.Point $Size, $Size),
        ([System.Drawing.Color]::FromArgb(255, 30, 64, 175)),
        ([System.Drawing.Color]::FromArgb(255, 88, 28, 135))
    )
    $g.FillPath($brush, $path)
    $brush.Dispose()

    $accentH = [int]($Size * 0.10)
    $accentY = [int]($Size * 0.78)
    $accentRect = New-Object System.Drawing.RectangleF 0, $accentY, $Size, $accentH
    $accentBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 20, 184, 166))
    $accentRegion = New-Object System.Drawing.Region $path
    $g.SetClip($accentRegion, [System.Drawing.Drawing2D.CombineMode]::Replace)
    $g.FillRectangle($accentBrush, $accentRect)
    $g.ResetClip()
    $accentBrush.Dispose()

    $fontSize = [single]($Size * 0.34)
    $font = $null
    foreach ($name in @("Segoe UI Black", "Arial Black", "Segoe UI", "Arial")) {
        try {
            $candidate = New-Object System.Drawing.Font($name, $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
            if ($candidate.Name -eq $name -or $candidate.FontFamily.Name -eq $name) {
                $font = $candidate; break
            }
            $candidate.Dispose()
        } catch {}
    }
    if (-not $font) {
        $font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    }

    $sf = New-Object System.Drawing.StringFormat ([System.Drawing.StringFormatFlags]::NoWrap)
    $sf.Alignment     = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $sf.Trimming      = [System.Drawing.StringTrimming]::None

    $tight = [System.Drawing.StringFormat]::GenericTypographic.Clone()
    $tight.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
    $measured = $g.MeasureString("CNC", $font, [int]::MaxValue, $tight)
    $tx = [single](($Size - $measured.Width) / 2)
    $ty = [single](($Size - $measured.Height) / 2 - ($Size * 0.05))

    $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.DrawString("CNC", $font, $textBrush, $tx, $ty, $tight)
    $textBrush.Dispose()
    $font.Dispose()

    $g.Dispose()
    $path.Dispose()
    return $bmp
}

function Save-PngBytes {
    param([System.Drawing.Bitmap]$Bmp)
    $ms = New-Object System.IO.MemoryStream
    $Bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return $ms.ToArray()
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()
foreach ($s in $sizes) {
    $bmp = New-CncBitmap -Size $s
    $bytes = Save-PngBytes -Bmp $bmp
    $entries += [PSCustomObject]@{ Size = $s; Png = $bytes; Bmp = $bmp }
}

$big = $entries | Where-Object { $_.Size -eq 256 } | Select-Object -First 1
[System.IO.File]::WriteAllBytes($PngOut, $big.Png)
if (Test-Path (Split-Path $PngPub)) {
    [System.IO.File]::WriteAllBytes($PngPub, $big.Png)
}

$icoDir = Split-Path $IcoOut
if (-not (Test-Path $icoDir)) { New-Item -ItemType Directory -Path $icoDir -Force | Out-Null }

$header = New-Object System.Collections.Generic.List[byte]
$header.AddRange([byte[]](0,0, 1,0))
$header.Add([byte]($entries.Count -band 0xFF))
$header.Add([byte](($entries.Count -shr 8) -band 0xFF))

$dataOffset = 6 + (16 * $entries.Count)
foreach ($e in $entries) {
    $w = if ($e.Size -ge 256) { 0 } else { $e.Size }
    $header.Add([byte]$w)
    $header.Add([byte]$w)
    $header.Add([byte]0)
    $header.Add([byte]0)
    $header.AddRange([byte[]](1,0))
    $header.AddRange([byte[]](32,0))
    $len = $e.Png.Length
    $header.Add([byte]( $len        -band 0xFF))
    $header.Add([byte](($len -shr  8) -band 0xFF))
    $header.Add([byte](($len -shr 16) -band 0xFF))
    $header.Add([byte](($len -shr 24) -band 0xFF))
    $header.Add([byte]( $dataOffset        -band 0xFF))
    $header.Add([byte](($dataOffset -shr  8) -band 0xFF))
    $header.Add([byte](($dataOffset -shr 16) -band 0xFF))
    $header.Add([byte](($dataOffset -shr 24) -band 0xFF))
    $dataOffset += $len
}
foreach ($e in $entries) { $header.AddRange([byte[]]$e.Png) }
[System.IO.File]::WriteAllBytes($IcoOut, $header.ToArray())

foreach ($e in $entries) { $e.Bmp.Dispose() }

"icon.png  -> $PngOut"
"icon.png  -> $PngPub"
"icon.ico  -> $IcoOut  ($([System.IO.FileInfo]::new($IcoOut).Length) bytes, $($entries.Count) sizes)"
