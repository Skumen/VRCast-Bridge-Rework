# Creates the code signing certificate for GitHub releases. Run ONCE on Windows:
#   powershell -ExecutionPolicy Bypass -File tools/new-signing-cert.ps1
# It makes a self-signed certificate, saves it with its private key to a .pfx
# protected by a password you type, and copies the .pfx as Base64 to the
# clipboard - ready to paste into the SIGNING_CERT_PFX repository secret.
#
# Every release must be signed with this same certificate: the app only
# installs an update signed by the same key as itself. Keep the .pfx and its
# password somewhere safe (a password manager, a backup drive). If you lose
# them, installed copies can no longer update automatically.
$ErrorActionPreference = 'Stop'
$subject = 'CN=VRCast Bridge, O=VRCast Bridge'
$pfx = Join-Path (Get-Location) 'vrcast-signing.pfx'

if (Test-Path $pfx) {
  throw "$pfx already exists. The release certificate must stay the same - reuse it instead of creating a new one."
}

$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject `
  -CertStoreLocation Cert:/CurrentUser/My -KeyExportPolicy Exportable `
  -KeyUsage DigitalSignature -NotAfter (Get-Date).AddYears(10) `
  -FriendlyName 'VRCast Bridge code signing'

$password = Read-Host -AsSecureString 'Password for the .pfx (you will paste it into SIGNING_CERT_PASSWORD)'
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password | Out-Null
[Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx)) | Set-Clipboard

Write-Host ''
Write-Host "Certificate created. Thumbprint: $($cert.Thumbprint)"
Write-Host "Saved with its private key to: $pfx  <- back this file up, never commit it"
Write-Host ''
Write-Host 'The .pfx is now in your clipboard as Base64. On GitHub open'
Write-Host '  Settings -> Secrets and variables -> Actions -> New repository secret'
Write-Host 'and add two secrets:'
Write-Host '  SIGNING_CERT_PFX       paste from the clipboard'
Write-Host '  SIGNING_CERT_PASSWORD  the password you just typed'
