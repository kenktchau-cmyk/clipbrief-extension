$ErrorActionPreference = 'Stop'
$secretDirectory = Join-Path $PSScriptRoot '.secrets'
New-Item -ItemType Directory -Path $secretDirectory -Force | Out-Null
$secureKey = Read-Host 'Google API Key (stored encrypted for this Windows account)' -AsSecureString
try {
  $encrypted = ConvertFrom-SecureString -SecureString $secureKey
  Set-Content -LiteralPath (Join-Path $secretDirectory 'google-key.dpapi') -Value $encrypted -Encoding ASCII
  Write-Output 'Backend key saved. Restart the backend to apply.'
} finally { $secureKey.Dispose() }
