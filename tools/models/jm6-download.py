"""Download pinned official inputs for available JM6 models; never use mirrors.
HF models remain explicitly blocked until their official files/licenses can be
read in an environment that permits Hugging Face. No substitute variant is used.
"""
import argparse,hashlib,json,os,shutil,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
ASSETS={
 'IllustrationJaNai_V3detail.zip':('https://github.com/the-database/MangaJaNai/releases/download/3.0.0/IllustrationJaNai_V3detail.zip','27749962bc934779f867730cdb10617e3d7475313f920a7a966c56b75dbdbeda'),
 'IllustrationJaNai_V3denoise.zip':('https://github.com/the-database/MangaJaNai/releases/download/3.0.0/IllustrationJaNai_V3denoise.zip','6c26828ad8e142c9e9c7181451257f3f56a0f5c7f897d9c7878ce898404f53e5'),
 'IllustrationJaNai_V3detail_onnx.zip':('https://github.com/the-database/MangaJaNai/releases/download/3.0.0/IllustrationJaNai_V3detail_onnx.zip','839277aca3b3a0ed1e2ea972331622354ef31d214a563f68e08ae42e1067c53c'),
 'IllustrationJaNai_V3denoise_onnx.zip':('https://github.com/the-database/MangaJaNai/releases/download/3.0.0/IllustrationJaNai_V3denoise_onnx.zip','86d393d5c55a7ac0df986cd42e79a0351ecf89b370752f79d4fd0a9cf3f2aa58'),
 '4x_Alchemy.pth':('https://github.com/renarchi/Re-SISR/releases/download/4x_Alchemy/4x_Alchemy.pth','8bafb02ffcbc2fa6f25523f66b9a055bff4b2a851f8bbe34a2f382703eb1c953'),
 '3dlut-classifier.pth':('https://raw.githubusercontent.com/HuiZeng/Image-Adaptive-3DLUT/b491f6df64a588864739a157db271e5c848e1805/pretrained_models/sRGB/classifier.pth','bae9865395625ecae58cfe86147e521093bb1e29e7b2544e02adb238b8035021'),
 '3dlut-LUTs.pth':('https://raw.githubusercontent.com/HuiZeng/Image-Adaptive-3DLUT/b491f6df64a588864739a157db271e5c848e1805/pretrained_models/sRGB/LUTs.pth','c1bb2bc4b7239c1a7e96159f5923123ba796b1fceb0b8c3132b423ea825b821a')}
def sha(file):
 h=hashlib.sha256()
 with file.open('rb') as stream:
  for data in iter(lambda:stream.read(1024*1024),b''):h.update(data)
 return h.hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True);a=p.parse_args();a.cache.mkdir(parents=True,exist_ok=True);results=[]
 for name,(url,expected) in ASSETS.items():
  file=a.cache/name;cached=file.exists() and sha(file)==expected
  if not cached:
   if file.exists():raise RuntimeError('Existing source hash mismatch; preserved: '+str(file))
   temp=file.with_name(file.name+'.download')
   with urllib.request.urlopen(url,timeout=180) as response,temp.open('wb') as stream:shutil.copyfileobj(response,stream)
   if sha(temp)!=expected:raise RuntimeError('Official download checksum mismatch: '+name)
   os.replace(temp,file)
  row={'file':name,'source':url,'sha256':expected,'bytes':file.stat().st_size,'cacheHit':cached};results.append(row);print(json.dumps(row),flush=True)
 (a.cache/'source-audit.json').write_text(json.dumps(results,indent=2)+'\n')
if __name__=='__main__':main()
