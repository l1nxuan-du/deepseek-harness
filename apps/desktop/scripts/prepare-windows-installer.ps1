<# Rasterize the wizard sidebar both NSIS wizards embed beside their welcome and finish pages. #>
[CmdletBinding()]
param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$installerRoot = Join-Path $PSScriptRoot '../installer'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $PSScriptRoot '../.desktop-build/targets/win-x64/installer-ui' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force $output | Out-Null
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile((Join-Path $installerRoot 'assets/uninstaller-sidebar.png'))
try {
    $bitmap = [Drawing.Bitmap]::new($image.Width, $image.Height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::White)
            $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height)
        } finally { $graphics.Dispose() }
        $bitmap.Save((Join-Path $output 'uninstaller-sidebar.bmp'), [Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $bitmap.Dispose() }
} finally { $image.Dispose() }
Write-Output "Prepared wizard sidebar: $output"