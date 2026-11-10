"""Actual Windows engine/reference compatibility, on private software Vulkan.
Downloads official original assets; no physical GPU benchmark is performed.
"""
import json,os,shutil,subprocess,sys,tempfile,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def download(url,file):
 with urllib.request.urlopen(url,timeout=120) as response,open(file,'wb') as output:shutil.copyfileobj(response,output)
def main():
 if sys.platform!='win32':raise SystemExit('Windows-only compatibility runner; no silent platform substitution.')
 destination=ROOT/'.test-artifacts/optional-models';destination.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='jm5-model-ci-') as temp:
  work=Path(temp);runtime=work/'runtime';runtime.mkdir()
  for file in (ROOT/'resources/win/bin').iterdir():
   if file.name=='upscayl-jm.exe' or file.suffix.lower()=='.dll':shutil.copy2(file,runtime/file.name)
  shutil.copy2(ROOT/'node_modules/electron/dist/vk_swiftshader.dll',runtime/'vulkan-1.dll')
  optimizer_zip=work/'ncnn.zip';download('https://github.com/Tencent/ncnn/releases/download/20240410/ncnn-20240410-windows-vs2022.zip',optimizer_zip)
  with zipfile.ZipFile(optimizer_zip) as archive:
   candidates=[name for name in archive.namelist() if name.endswith('/bin/ncnnoptimize.exe') and any(part=='x64' for part in name.split('/'))]
   if len(candidates)!=1:raise RuntimeError('Expected one x64 optimizer; found '+str(candidates))
   optimizer=work/'ncnnoptimize.exe';optimizer.write_bytes(archive.read(candidates[0]))
  environment={**os.environ,'VK_ICD_FILENAMES':str(ROOT/'node_modules/electron/dist/vk_swiftshader_icd.json'),'VK_DRIVER_FILES':str(ROOT/'node_modules/electron/dist/vk_swiftshader_icd.json')}
  pairs=[('IllustrationJaNai_V1_ModelsOnly.zip','4x_IllustrationJaNai_V1_ESRGAN_135k.pth','4x-illustrationjanai-v1-esrgan'),('MangaJaNai_V1_ModelsOnly.zip','2x_MangaJaNai_1600p_V1_ESRGAN_90k.pth','2x-mangajanai-1600p-v1-esrgan')]
  for asset,weight,id in pairs:
   file=work/asset;download('https://github.com/the-database/MangaJaNai/releases/download/1.0.0/'+asset,file)
   with zipfile.ZipFile(file) as archive:
    names=[name for name in archive.namelist() if name.split('/')[-1]==weight]
    if len(names)!=1:raise RuntimeError('Original asset did not contain the exact expected weight.')
    weights=work/weight;weights.write_bytes(archive.read(names[0]))
   subprocess.run([sys.executable,str(ROOT/'tools/models/prepare.py'),'--id',id,'--weights',str(weights),'--optimizer',str(optimizer),'--engine',str(runtime/'upscayl-jm.exe'),'--destination',str(destination),'--accept-noncommercial-sharealike-license'],check=True,env=environment,timeout=1800)
   manifest=json.loads((destination/(id+'.model.json')).read_text());evidence={k:manifest[k] for k in ['id','sourceSha256','license','validation']}
   print('::notice title=Windows optional-model compatibility::'+json.dumps(evidence),flush=True)
  # Keep derived optional models, their licenses and evidence together. They
  # are separate artifacts and never injected into the default app package.
  shutil.copy2(ROOT/'tools/models/README.md',destination/'README.md')
if __name__=='__main__':main()
