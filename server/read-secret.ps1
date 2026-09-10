$ErrorActionPreference = 'Stop'
$secretPath = Join-Path $PSScriptRoot '.secrets\google-key.dpapi'
$secureKey = (Get-Content -LiteralPath $secretPath -Raw).Trim() | ConvertTo-SecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureKey.Dispose() }
