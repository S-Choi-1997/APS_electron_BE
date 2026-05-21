param(
    [string]$BackendUrl = "https://backend.apsconsulting.kr",
    [string]$AccountFile = ".local/aps-test-account.md",
    [int]$TranslateEmailId = 657,
    [switch]$SkipTranslation
)

$ErrorActionPreference = "Stop"

function Get-TestAccount {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        throw "Test account file not found: $Path"
    }

    $raw = Get-Content $Path -Raw
    if ($raw -notmatch '(?im)^\s*(email|user|username|id)\s*[:=]\s*(\S+)') {
        throw "Could not parse test account email/id from $Path"
    }
    $email = $Matches[2]

    if ($raw -notmatch '(?im)^\s*(password|pass|pw)\s*[:=]\s*(\S+)') {
        throw "Could not parse test account password from $Path"
    }
    $password = $Matches[2]

    return [PSCustomObject]@{
        Email = $email
        Password = $password
    }
}

function Invoke-CurlJson {
    param(
        [string]$Method = "GET",
        [string]$Url,
        [hashtable]$Headers = @{},
        [object]$Body = $null,
        [string]$TempDir
    )

    $out = Join-Path $TempDir ("response-" + [Guid]::NewGuid().ToString("N") + ".json")
    $args = @("-sS", "-o", $out, "-w", "%{http_code}", "-X", $Method)
    foreach ($key in $Headers.Keys) {
        $args += @("-H", "$key`: $($Headers[$key])")
    }

    if ($null -ne $Body) {
        $bodyPath = Join-Path $TempDir ("body-" + [Guid]::NewGuid().ToString("N") + ".json")
        $Body | ConvertTo-Json -Depth 10 | Set-Content -Path $bodyPath -Encoding utf8
        $args += @("-H", "Content-Type: application/json", "--data-binary", "@$bodyPath")
    }

    $args += $Url
    $status = & curl.exe @args
    if ($LASTEXITCODE -ne 0) {
        throw "curl failed for $Method $Url"
    }

    $content = if (Test-Path $out) { Get-Content $out -Raw } else { "" }
    return [PSCustomObject]@{
        Status = [int]$status
        Body = $content
    }
}

function Add-Result {
    param(
        [System.Collections.Generic.List[object]]$Results,
        [string]$Name,
        [int]$Status,
        [bool]$Pass,
        [string]$Evidence
    )

    $Results.Add([PSCustomObject]@{
        Name = $Name
        Status = $Status
        Pass = $Pass
        Evidence = $Evidence
    })
}

$tempDir = Join-Path $env:TEMP ("aps-backend-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null

try {
    $account = Get-TestAccount -Path $AccountFile
    $results = [System.Collections.Generic.List[object]]::new()

    $health = Invoke-CurlJson -Url "$BackendUrl/" -TempDir $tempDir
    Add-Result $results "GET /" $health.Status ($health.Status -eq 200 -and $health.Body.Contains('"status":"ok"')) "health response length=$($health.Body.Length)"

    $login = Invoke-CurlJson -Method "POST" -Url "$BackendUrl/auth/login" -Body @{
        email = $account.Email
        password = $account.Password
    } -TempDir $tempDir
    $loginJson = $login.Body | ConvertFrom-Json
    $token = $loginJson.accessToken
    Add-Result $results "POST /auth/login" $login.Status ($login.Status -eq 200 -and -not [string]::IsNullOrWhiteSpace($token)) "accessToken returned"

    $authHeaders = @{ Authorization = "Bearer $token" }

    $checks = @(
        @{ Name = "GET /inquiries?limit=1"; Method = "GET"; Path = "/inquiries?limit=1"; Expect = 200 },
        @{ Name = "GET /inquiries/stats"; Method = "GET"; Path = "/inquiries/stats"; Expect = 200 },
        @{ Name = "GET /inquiries/all?limit=1"; Method = "GET"; Path = "/inquiries/all?limit=1"; Expect = 200 },
        @{ Name = "GET /schedules?limit=1"; Method = "GET"; Path = "/schedules?limit=1"; Expect = 200 },
        @{ Name = "GET /web-form-inquiries?limit=1"; Method = "GET"; Path = "/web-form-inquiries?limit=1"; Expect = 200 },
        @{ Name = "GET /email-inquiries?limit=1"; Method = "GET"; Path = "/email-inquiries?limit=1"; Expect = 200 },
        @{ Name = "GET /email-inquiries/stats"; Method = "GET"; Path = "/email-inquiries/stats"; Expect = 200 }
    )

    foreach ($check in $checks) {
        $res = Invoke-CurlJson -Method $check.Method -Url "$BackendUrl$($check.Path)" -Headers $authHeaders -TempDir $tempDir
        Add-Result $results $check.Name $res.Status ($res.Status -eq $check.Expect -and $res.Body.Length -gt 0) "body length=$($res.Body.Length)"
    }

    $sms = Invoke-CurlJson -Method "POST" -Url "$BackendUrl/sms/send" -Headers $authHeaders -Body @{} -TempDir $tempDir
    Add-Result $results "POST /sms/send validation" $sms.Status ($sms.Status -eq 400 -and $sms.Body.Contains("invalid_receiver")) "expected validation error"

    if (-not $SkipTranslation) {
        $translation = Invoke-CurlJson -Method "POST" -Url "$BackendUrl/email-inquiries/$TranslateEmailId/translate" -Headers $authHeaders -Body @{} -TempDir $tempDir
        Add-Result $results "POST /email-inquiries/$TranslateEmailId/translate" $translation.Status ($translation.Status -eq 200 -and $translation.Body.Contains("translationStatus")) "translationStatus returned"
    }

    $results | Format-Table -AutoSize

    $failed = $results | Where-Object { -not $_.Pass }
    if ($failed) {
        throw "Backend smoke check failed: $($failed.Count) failing route(s)"
    }
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
