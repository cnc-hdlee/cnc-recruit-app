Add-Type -AssemblyName System.Drawing

# 공식 C&C 로고 (cnccosmetic.com/logo.png — 300x104)에서 좌측 C&C 원만 잘라 정사각 아이콘 생성
$AppRoot   = "C:\Users\user\Desktop\CNC-Recruit-App"
$LogoSrc   = Join-Path $AppRoot "cnc-logo-original.png"
$IcoOut    = Join-Path $AppRoot "release\.icon-ico\icon.ico"
$PngOut    = Join-Path $AppRoot "icon.png"
$PngPub    = Join-Path $AppRoot "public\icon.png"

if (-not (Test-Path $LogoSrc)) {
    Write-Error "원본 로고 없음: $LogoSrc — cnccosmetic.com/logo.png 에서 다운로드 필요"
    exit 1
}

# 원본 로드
$srcBmp = [System.Drawing.Bitmap]::FromFile($LogoSrc)
$srcW = $srcBmp.Width
$srcH = $srcBmp.Height
"원본 크기: ${srcW}x${srcH}"

# C&C 원 부분만 — 좌측에서 높이만큼의 정사각형 (300x104 → 104x104)
$cropW = $srcH
$cropH = $srcH
$cropX = 0
$cropY = 0
"크롭: ${cropW}x${cropH} from (${cropX},${cropY})"

function New-CncBitmap {
    param([int]$Size, [System.Drawing.Bitmap]$Source, [int]$CX, [int]$CY, [int]$CW, [int]$CH)

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # 투명 배경 유지 (PNG 그대로)
    $g.Clear([System.Drawing.Color]::Transparent)

    # 약간 패딩 (5%) — 원이 가장자리에 딱 붙지 않게
    $pad = [int]($Size * 0.05)
    $destRect = New-Object System.Drawing.Rectangle $pad, $pad, ($Size - 2 * $pad), ($Size - 2 * $pad)
    $srcRect  = New-Object System.Drawing.Rectangle $CX, $CY, $CW, $CH

    $g.DrawImage($Source, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose()
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
    $bmp = New-CncBitmap -Size $s -Source $srcBmp -CX $cropX -CY $cropY -CW $cropW -CH $cropH
    $bytes = Save-PngBytes -Bmp $bmp
    $entries += [PSCustomObject]@{ Size = $s; Png = $bytes; Bmp = $bmp }
}

# icon.png — 256 사이즈 사용
$big = $entries | Where-Object { $_.Size -eq 256 } | Select-Object -First 1
[System.IO.File]::WriteAllBytes($PngOut, $big.Png)
if (Test-Path (Split-Path $PngPub)) {
    [System.IO.File]::WriteAllBytes($PngPub, $big.Png)
}

# icon.ico — multi-resolution
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
$srcBmp.Dispose()

"icon.png  -> $PngOut"
"icon.png  -> $PngPub"
"icon.ico  -> $IcoOut  ($([System.IO.FileInfo]::new($IcoOut).Length) bytes, $($entries.Count) sizes)"
