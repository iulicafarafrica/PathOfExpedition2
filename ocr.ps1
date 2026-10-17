Add-Type -AssemblyName System.Runtime.WindowsRuntime
# stdout MUSTI fie UTF-8: altfel PowerShell 5.1 scrie in codepage-ul OEM (ex. CP437,
# unde bullet-ul "•" = byte 0x07) si Node primeste caractere de control care rup JSON-ul.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function AwaitWinRt([object]$a, [type]$t) {
  $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $m.MakeGenericMethod($t).Invoke($null, @($a))
  $task.Wait()
  return $task.Result
}
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { Write-Error "No OCR engine"; exit 1 }
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Trim()
  if ($p -eq "") { continue }
  try {
    $file = AwaitWinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($p)) ([Windows.Storage.StorageFile])
    $stream = AwaitWinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = AwaitWinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bmp = AwaitWinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try { [void]$stream.Dispose() } catch {}
    if ($bmp.BitmapPixelFormat -ne [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8) {
      $bmp = [Windows.Graphics.Imaging.SoftwareBitmap]::Convert($bmp, [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)
    }
    $result = AwaitWinRt ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    $lines = @()
    foreach ($ln in $result.Lines) {
      # BoundingRect la Lines e NULL; folosim Words pentru Y
      $ys = @(); $xs = @()
      foreach ($w in $ln.Words) {
        if ($w.BoundingRect) { $ys += $w.BoundingRect.Y; $xs += $w.BoundingRect.X }
      }
      $minY = if ($ys.Count -gt 0) { [math]::Round(($ys | Measure-Object -Minimum).Minimum, 1) } else { 0 }
      $minX = if ($xs.Count -gt 0) { [math]::Round(($xs | Measure-Object -Minimum).Minimum, 1) } else { 0 }
      # sanitizeaza textul: elimina control chars care rupe JSON-ul
      # IMPORTANT: backslash-urile din regex-uri sunt dublate intentional;
      # acest string e un template literal JS, altfel ar fi interpretat de JS.
      $cleanText = ($ln.Text -replace "[\x00-\x08\x0B\x0C\x0E-\x1F]", " ") -replace "\s+", " "
      $lines += [ordered]@{ text = $cleanText; y = $minY; x = $minX }
    }
    $resp = [ordered]@{ ok = $true; lines = $lines }
  } catch {
    $resp = [ordered]@{ ok = $false; error = $_.Exception.Message }
  }
  Write-Output ($resp | ConvertTo-Json -Depth 4 -Compress)
  [Console]::Out.Flush()
}
