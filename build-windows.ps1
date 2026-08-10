$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path $Root "windows-build.log"
Start-Transcript -Path $LogFile -Append | Out-Null
$Builder = Join-Path $Root "windows-app"
$Runtime = Join-Path $Root ".windows-build"
$Tools = Join-Path $Builder "tools"
$AppFiles = Join-Path $Builder "app"

function Download-File([string]$Url, [string]$Destination) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

New-Item -ItemType Directory -Force -Path $Runtime, $Tools, $AppFiles | Out-Null

$NodeExe = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeExe) {
    Write-Host "Finding the latest Node.js LTS..."
    $Releases = Invoke-RestMethod "https://nodejs.org/dist/index.json"
    $NodeRelease = $Releases | Where-Object { $_.lts -and $_.files -contains "win-x64-zip" } | Select-Object -First 1
    if (-not $NodeRelease) { throw "Unable to find a Windows x64 Node.js LTS release." }
    $NodeZip = Join-Path $Runtime "node.zip"
    $NodeFolder = "node-$($NodeRelease.version)-win-x64"
    Download-File "https://nodejs.org/dist/$($NodeRelease.version)/$NodeFolder.zip" $NodeZip
    Expand-Archive -Path $NodeZip -DestinationPath $Runtime -Force
    $NodeHome = Join-Path $Runtime $NodeFolder
} else {
    $NodeHome = Split-Path -Parent $NodeExe.Source
}

$Npm = Join-Path $NodeHome "npm.cmd"
if (-not (Test-Path $Npm)) { throw "npm.cmd was not found." }

# npm lifecycle scripts invoke `node` by name. When using the downloaded
# portable runtime, expose it to every child process in this build session.
$env:Path = "$NodeHome;$env:Path"
$env:npm_config_registry = "https://registry.npmmirror.com"
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
Write-Host "Using Node.js from $NodeHome"

$Ytdlp = Join-Path $Tools "yt-dlp.exe"
if (-not (Test-Path $Ytdlp)) {
    Download-File "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" $Ytdlp
}

$Ffmpeg = Join-Path $Tools "ffmpeg.exe"
if (-not (Test-Path $Ffmpeg)) {
    $FfmpegZip = Join-Path $Runtime "ffmpeg.zip"
    $FfmpegExtract = Join-Path $Runtime "ffmpeg"
    Download-File "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" $FfmpegZip
    if (Test-Path $FfmpegExtract) { Remove-Item $FfmpegExtract -Recurse -Force }
    Expand-Archive -Path $FfmpegZip -DestinationPath $FfmpegExtract -Force
    $FoundFfmpeg = Get-ChildItem $FfmpegExtract -Filter ffmpeg.exe -Recurse | Select-Object -First 1
    if (-not $FoundFfmpeg) { throw "ffmpeg.exe was not found in the downloaded archive." }
    Copy-Item $FoundFfmpeg.FullName $Ffmpeg
}

Write-Host "Copying application files..."
# `app` is runtime content, not a nested Electron project. A package.json in
# this directory makes electron-builder select the wrong application root.
$NestedPackage = Join-Path $AppFiles "package.json"
if (Test-Path $NestedPackage) { Remove-Item $NestedPackage -Force }
$RuntimePublic = Join-Path $AppFiles "public"
if (Test-Path $RuntimePublic) { Remove-Item $RuntimePublic -Recurse -Force }
Copy-Item (Join-Path $Root "server.js") $AppFiles -Force
Copy-Item (Join-Path $Root "public") $RuntimePublic -Recurse -Force

Write-Host "Installing Windows packaging dependencies..."
Push-Location $Builder
try {
    & $Npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

    Write-Host "Building installer and portable EXE..."
    $BuildSucceeded = $false
    for ($Attempt = 1; $Attempt -le 3; $Attempt++) {
        if ($Attempt -eq 3) {
            Write-Host "Final attempt: switching back to the official download source..." -ForegroundColor Yellow
            Remove-Item Env:ELECTRON_MIRROR -ErrorAction SilentlyContinue
            Remove-Item Env:ELECTRON_BUILDER_BINARIES_MIRROR -ErrorAction SilentlyContinue
        }
        Write-Host "Packaging attempt $Attempt of 3..."
        & $Npm run dist
        if ($LASTEXITCODE -eq 0) {
            $BuildSucceeded = $true
            break
        }
        if ($Attempt -lt 3) {
            Write-Host "Download connection failed. Retrying in 5 seconds..." -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
    if (-not $BuildSucceeded) { throw "Windows packaging failed after 3 attempts." }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Success: $(Join-Path $Root 'release-windows')" -ForegroundColor Green
Stop-Transcript | Out-Null
