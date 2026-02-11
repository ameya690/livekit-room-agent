# Download LiveKit Server for Windows
$version = "v1.9.11"
$downloadUrl = "https://github.com/livekit/livekit/releases/download/$version/livekit_${version}_windows_amd64.zip"
$outputZip = "livekit-server.zip"
$extractPath = "livekit-server"

Write-Host "Downloading LiveKit Server $version for Windows..." -ForegroundColor Green
Invoke-WebRequest -Uri $downloadUrl -OutFile $outputZip

Write-Host "Extracting..." -ForegroundColor Green
Expand-Archive -Path $outputZip -DestinationPath $extractPath -Force

Write-Host "Cleaning up..." -ForegroundColor Green
Remove-Item $outputZip

Write-Host "`nLiveKit Server installed successfully!" -ForegroundColor Green
Write-Host "Location: $extractPath" -ForegroundColor Cyan
Write-Host "`nTo start the server, run:" -ForegroundColor Yellow
Write-Host "  cd $extractPath" -ForegroundColor White
Write-Host "  .\livekit-server.exe --dev" -ForegroundColor White
