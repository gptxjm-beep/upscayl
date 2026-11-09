$ErrorActionPreference = 'Stop'
$version = '1.3.280.0'
$sdk = "C:\VulkanSDK\$version"
$installer = Join-Path $env:RUNNER_TEMP "VulkanSDK-$version-Installer.exe"
$url = "https://sdk.lunarg.com/sdk/download/$version/windows/VulkanSDK-$version-Installer.exe"
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
