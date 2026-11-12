# Read-only, no administrator privileges or system changes. No machine/user IDs.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$result = [ordered]@{}
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
  $result.os = @{caption=$os.Caption;version=$os.Version;build=$os.BuildNumber;revision=$cv.UBR;displayVersion=$cv.DisplayVersion;architecture=$os.OSArchitecture;productType=$os.ProductType}
  $result.displayDrivers = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{name=$_.Name;driverVersion=$_.DriverVersion;driverDate=[string]$_.DriverDate;status=$_.Status} })
} catch { $result.osProbeError = $_.Exception.Message }
try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class JmDxgiProbe {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Desc {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string Name;
  public uint Vendor,Device,Subsystem,Revision;
  public UIntPtr Video,System,Shared;
  public uint LuidLow; public int LuidHigh; public uint Flags;
 }
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid id,out IntPtr factory);
 [DllImport("d3d12.dll")] static extern int D3D12CreateDevice(IntPtr adapter,int level,ref Guid id,out IntPtr device);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumAdapters(IntPtr self,uint index,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetDesc(IntPtr self,out Desc desc);
 static T Fn<T>(IntPtr obj,int slot) {return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj),slot*IntPtr.Size),typeof(T));}
 public static object[] Read() {
  var list=new List<object>(); Guid fid=new Guid("770aae78-f26f-4dba-a829-253c83d1b387"); IntPtr f;
  Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref fid,out f));
  try {var en=Fn<EnumAdapters>(f,12); for(uint i=0;i<32;i++) {IntPtr a; int hr=en(f,i,out a);if(hr==unchecked((int)0x887a0002))break;Marshal.ThrowExceptionForHR(hr);
   try {Desc d;Marshal.ThrowExceptionForHR(Fn<GetDesc>(a,10)(a,out d)); Guid did=new Guid("189819f1-1db6-4b57-be54-1821339b85f7");IntPtr device; int dh=D3D12CreateDevice(a,0xb000,ref did,out device);if(device!=IntPtr.Zero)Marshal.Release(device);
    list.Add(new {deviceIndex=i,name=d.Name,vendorId=d.Vendor,deviceId=d.Device,dedicatedVideoBytes=d.Video.ToUInt64(),software=(d.Flags&2)!=0,d3d12FeatureLevel11Supported=dh>=0,d3d12Hresult="0x"+dh.ToString("X8")});
   }finally{Marshal.Release(a);}
  }}finally{Marshal.Release(f);}return list.ToArray();
 }
}
'@
  $result.dxgiAdapters = @([JmDxgiProbe]::Read())
} catch { $result.dxgiProbeError = $_.Exception.Message }
try {
  $target = Get-Process -Id ([int]$env:JM6_DIAGNOSTIC_PROCESS_ID)
  $result.loadedModules = @($target.Modules | Where-Object { $_.ModuleName -in @('onnxruntime.dll','DirectML.dll','dxcompiler.dll','onnxruntime_binding.node') } | ForEach-Object {
    $origin = 'other'
    if ($env:JM6_DIAGNOSTIC_DLL_DIRECTORY -and $_.FileName.StartsWith($env:JM6_DIAGNOSTIC_DLL_DIRECTORY,[StringComparison]::OrdinalIgnoreCase)) {$origin='bundled'}
    elseif ($_.FileName.StartsWith($env:WINDIR,[StringComparison]::OrdinalIgnoreCase)) {$origin='system'}
    @{name=$_.ModuleName;version=$_.FileVersionInfo.FileVersion;origin=$origin;sha256=(Get-FileHash -LiteralPath $_.FileName -Algorithm SHA256).Hash.ToLowerInvariant()}
  })
} catch { $result.modulesProbeError = $_.Exception.Message }
$result | ConvertTo-Json -Depth 8 -Compress
