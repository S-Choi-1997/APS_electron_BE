# Shared validation helpers for Electron update artifacts.

function ConvertTo-ApsBase64Sha512 {
    param(
        [Parameter(Mandatory=$true)]
        [string]$HexHash
    )

    $clean = $HexHash.Trim()
    if ($clean.Length % 2 -ne 0) {
        throw "Invalid SHA512 hex length"
    }

    $bytes = New-Object byte[] ($clean.Length / 2)
    for ($i = 0; $i -lt $bytes.Length; $i++) {
        $bytes[$i] = [Convert]::ToByte($clean.Substring($i * 2, 2), 16)
    }

    return [Convert]::ToBase64String($bytes)
}

function Get-ApsFileSha512Base64 {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    $hash = Get-FileHash -LiteralPath $Path -Algorithm SHA512
    return ConvertTo-ApsBase64Sha512 $hash.Hash
}

function Get-ApsYamlScalar {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Content,

        [Parameter(Mandatory=$true)]
        [string]$Name
    )

    $match = [regex]::Match($Content, "(?m)^$([regex]::Escape($Name)):\s*(.+?)\s*$")
    if (-not $match.Success) {
        return $null
    }

    return $match.Groups[1].Value.Trim().Trim("'").Trim('"')
}

function Read-ApsLatestYmlContent {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Content,

        [string]$Source = "latest.yml"
    )

    $version = Get-ApsYamlScalar -Content $Content -Name "version"
    $path = Get-ApsYamlScalar -Content $Content -Name "path"
    $sha512 = Get-ApsYamlScalar -Content $Content -Name "sha512"

    if ([string]::IsNullOrWhiteSpace($version)) { throw "$Source is missing version" }
    if ([string]::IsNullOrWhiteSpace($path)) { throw "$Source is missing path" }
    if ([string]::IsNullOrWhiteSpace($sha512)) { throw "$Source is missing sha512" }

    $fileMatches = [regex]::Matches(
        $Content,
        "(?ms)^\s*-\s+url:\s*(?<url>.+?)\s*\r?\n\s+sha512:\s*(?<sha512>.+?)\s*\r?\n\s+size:\s*(?<size>\d+)\s*$"
    )

    if ($fileMatches.Count -eq 0) {
        throw "$Source is missing files[] entries"
    }

    $files = foreach ($match in $fileMatches) {
        [pscustomobject]@{
            Url = $match.Groups["url"].Value.Trim().Trim("'").Trim('"')
            Sha512 = $match.Groups["sha512"].Value.Trim().Trim("'").Trim('"')
            Size = [int64]$match.Groups["size"].Value
        }
    }

    return [pscustomobject]@{
        Version = $version
        Path = $path
        Sha512 = $sha512
        Files = @($files)
    }
}

function Read-ApsLatestYml {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "latest.yml not found: $Path"
    }

    $content = Get-Content -LiteralPath $Path -Raw
    return Read-ApsLatestYmlContent -Content $content -Source $Path
}

function Test-ApsUpdateArtifactSet {
    param(
        [Parameter(Mandatory=$true)]
        [string]$ArtifactRoot
    )

    if (-not (Test-Path -LiteralPath $ArtifactRoot)) {
        throw "artifact root not found: $ArtifactRoot"
    }

    $latestPath = Join-Path $ArtifactRoot "latest.yml"
    $latest = Read-ApsLatestYml -Path $latestPath
    $installerPath = Join-Path $ArtifactRoot $latest.Path

    if (-not (Test-Path -LiteralPath $installerPath)) {
        throw "latest.yml path target not found: $installerPath"
    }

    $installerItem = Get-Item -LiteralPath $installerPath
    $installerSha512 = Get-ApsFileSha512Base64 -Path $installerPath

    if ($latest.Sha512 -ne $installerSha512) {
        throw "top-level sha512 mismatch for $($latest.Path)"
    }

    $pathFile = $latest.Files | Where-Object { $_.Url -eq $latest.Path } | Select-Object -First 1
    if (-not $pathFile) {
        throw "files[] does not contain path target: $($latest.Path)"
    }

    foreach ($file in $latest.Files) {
        $filePath = Join-Path $ArtifactRoot $file.Url
        if (-not (Test-Path -LiteralPath $filePath)) {
            throw "files[] target not found: $filePath"
        }

        $item = Get-Item -LiteralPath $filePath
        if ($item.Length -ne $file.Size) {
            throw "size mismatch for $($file.Url): latest.yml=$($file.Size), actual=$($item.Length)"
        }

        $actualSha512 = Get-ApsFileSha512Base64 -Path $filePath
        if ($actualSha512 -ne $file.Sha512) {
            throw "sha512 mismatch for $($file.Url)"
        }
    }

    if ($installerItem.Length -ne $pathFile.Size) {
        throw "top-level path size mismatch for $($latest.Path)"
    }

    $blockmapPath = "$installerPath.blockmap"
    if (-not (Test-Path -LiteralPath $blockmapPath)) {
        throw "blockmap not found for latest.yml path: $blockmapPath"
    }

    return [pscustomobject]@{
        LatestPath = $latestPath
        Version = $latest.Version
        InstallerPath = $installerPath
        InstallerName = $installerItem.Name
        InstallerSize = $installerItem.Length
        BlockmapPath = $blockmapPath
        Files = $latest.Files
    }
}

function Resolve-ApsUpdateUri {
    param(
        [Parameter(Mandatory=$true)]
        [string]$LatestUrl,

        [Parameter(Mandatory=$true)]
        [string]$Reference
    )

    return [Uri]::new([Uri]$LatestUrl, $Reference).AbsoluteUri
}

function Test-ApsRemoteFile {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Url,

        [Nullable[Int64]]$ExpectedSize = $null
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec 15
    } catch {
        $response = Invoke-WebRequest -Uri $Url -Method Get -Headers @{ Range = "bytes=0-0" } -UseBasicParsing -TimeoutSec 15
    }

    $statusCode = [int]$response.StatusCode
    if ($statusCode -lt 200 -or $statusCode -ge 400) {
        throw "remote artifact returned HTTP ${statusCode}: $Url"
    }

    $contentLength = $response.Headers["Content-Length"]
    if ($contentLength -is [array]) {
        $contentLength = $contentLength[0]
    }

    if ($ExpectedSize -ne $null -and -not [string]::IsNullOrWhiteSpace($contentLength)) {
        $length = [int64]$contentLength
        if ($length -ne $ExpectedSize -and $statusCode -ne 206) {
            throw "remote artifact size mismatch for $Url`: latest.yml=$ExpectedSize, remote=$length"
        }
    }

    return [pscustomobject]@{
        Url = $Url
        StatusCode = $statusCode
        ContentLength = $contentLength
    }
}

function Test-ApsRemoteUpdateChannel {
    param(
        [Parameter(Mandatory=$true)]
        [string]$LatestUrl
    )

    $latestResponse = Invoke-WebRequest -Uri $LatestUrl -Method Get -UseBasicParsing -TimeoutSec 15
    if ([int]$latestResponse.StatusCode -lt 200 -or [int]$latestResponse.StatusCode -ge 400) {
        throw "remote latest.yml returned HTTP $($latestResponse.StatusCode): $LatestUrl"
    }

    $latestContent = $latestResponse.Content
    if ($latestContent -is [byte[]]) {
        $latestContent = [System.Text.Encoding]::UTF8.GetString($latestContent)
    } else {
        $latestContent = [string]$latestContent
    }

    $latest = Read-ApsLatestYmlContent -Content $latestContent -Source $LatestUrl
    $checks = New-Object System.Collections.Generic.List[object]

    foreach ($file in $latest.Files) {
        $url = Resolve-ApsUpdateUri -LatestUrl $LatestUrl -Reference $file.Url
        $checks.Add((Test-ApsRemoteFile -Url $url -ExpectedSize $file.Size))
    }

    $blockmapUrl = Resolve-ApsUpdateUri -LatestUrl $LatestUrl -Reference "$($latest.Path).blockmap"
    $checks.Add((Test-ApsRemoteFile -Url $blockmapUrl))

    return [pscustomobject]@{
        LatestUrl = $LatestUrl
        Version = $latest.Version
        Path = $latest.Path
        Checks = $checks.ToArray()
    }
}
