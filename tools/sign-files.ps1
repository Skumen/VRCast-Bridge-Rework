# Signs files with a certificate that is already in Cert:\CurrentUser\My and
# fails loudly if any file ends up unsigned or signed by another key. Used by
# the release workflow; tools/sign.ps1 remains for local builds.
#   pwsh tools/sign-files.ps1 -Thumbprint <thumbprint> -Files a.exe, b.exe
param(
  [Parameter(Mandatory)] [string] $Thumbprint,
  [Parameter(Mandatory)] [string[]] $Files
)
$ErrorActionPreference = 'Stop'
$cert = Get-Item "Cert:\CurrentUser\My\$Thumbprint"
if (-not $cert.HasPrivateKey) { throw "Certificate $Thumbprint has no private key" }

foreach ($file in $Files) {
  if (-not (Test-Path $file)) { throw "Nothing to sign: $file" }
  try {
    # A timestamp keeps the signature valid after the certificate expires.
    Set-AuthenticodeSignature -FilePath $file -Certificate $cert -HashAlgorithm SHA256 `
      -TimestampServer 'http://timestamp.digicert.com' -ErrorAction Stop | Out-Null
  } catch {
    Write-Warning "Timestamp server unavailable, signing $file without a timestamp: $_"
    Set-AuthenticodeSignature -FilePath $file -Certificate $cert -HashAlgorithm SHA256 -ErrorAction Stop | Out-Null
  }
  $check = Get-AuthenticodeSignature -LiteralPath $file
  # A self-signed certificate reports UnknownError until it is trusted; the
  # signature itself is intact. Anything else (HashMismatch, NotSigned) is fatal.
  if ($check.Status -notin 'Valid', 'UnknownError' -or $check.SignerCertificate.Thumbprint -ne $Thumbprint) {
    throw "$file is not signed correctly: $($check.Status) $($check.StatusMessage)"
  }
  '{0,-48} signed ({1})' -f $file, $check.Status
}
