$ErrorActionPreference = 'Stop'
$version = '1.4.363.1'
$sdk = "C:\VulkanSDK\$version"
$installer = Join-Path $env:RUNNER_TEMP "vulkansdk-windows-X64-$version.exe"
$url = "https://sdk.lunarg.com/sdk/download/latest/windows/vulkan-sdk.exe"
# LunarG's official metadata supplies the published version. Refuse a silent toolchain update.
$metadata = Invoke-RestMethod -Uri 'https://vulkan.lunarg.com/sdk/latest/windows.json'
$metadataText = $metadata | ConvertTo-Json -Compress
Write-Output "Official SDK metadata: $metadataText"
if ($metadata.windows -ne $version) { throw "Published SDK $($metadata.windows) differs from pinned $version" }
Write-Output "Pinned SDK download: $url"
Invoke-WebRequest -Uri $url -OutFile $installer
$signature = Get-AuthenticodeSignature -FilePath $installer
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'LunarG') {
    throw "Vulkan SDK signature/publisher verification failed: $($signature.Status) / $($signature.SignerCertificate.Subject)"
}
Write-Output "Verified SDK publisher: $($signature.SignerCertificate.Subject)"
Get-FileHash -Algorithm SHA256 $installer | Format-List
$process = Start-Process -FilePath $installer -ArgumentList @('--root', $sdk, '--accept-licenses', '--default-answer', '--confirm-command', 'install') -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Vulkan SDK installer returned $($process.ExitCode)" }
foreach ($required in @('Include\vulkan\vulkan.h', 'Lib\vulkan-1.lib', 'Bin\glslangValidator.exe')) {
    if (!(Test-Path (Join-Path $sdk $required))) { throw "Vulkan SDK missing $required" }
}
"VULKAN_SDK=$sdk" >> $env:GITHUB_ENV
"$sdk\Bin" >> $env:GITHUB_PATH
$coreHeader = Get-Content (Join-Path $sdk 'Include\vulkan\vulkan_core.h') -Raw
if ($coreHeader -notmatch '#define\s+VK_HEADER_VERSION\s+363\b') { throw 'Unexpected Vulkan header version' }
