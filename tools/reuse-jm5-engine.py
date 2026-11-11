"""Reuse the already verified JM5 NCNN binary only for its exact source tree.
The new ONNX worker is built separately by TypeScript. No binary is trusted
without both the original portable ZIP and inner engine checksums.
"""
import argparse,hashlib,json,subprocess,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ZIP_SHA='b8a71e1333e2675c9bc6234905faca6555132257037eb13a5b7449ab735ef7d9'
ENGINE_SHA='c3deb7e1b90458622e2f1ce5f40910f51739c0e98b4d5bc14579726b30be70fe'
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('artifact',type=Path);a=p.parse_args()
 for file,want in [('vendor/upscayl-ncnn','d63f4390aad4d7f8a2be11d3a97aa10e749dd4bf'),('tools/build-enhanced-engine.py','8a243ed6a0b3495717ce813e1a1ae93e49163128')]:
  actual=subprocess.check_output(['git','rev-parse','HEAD:'+file],cwd=ROOT,text=True).strip()
  if actual!=want:raise RuntimeError('Native source changed: compile and validate a new engine instead of reusing JM5.')
 candidates=list(a.artifact.glob('*.zip'));assert len(candidates)==1,'Expected one verified JM5 portable ZIP'
 archive=candidates[0];assert hashlib.sha256(archive.read_bytes()).hexdigest()==ZIP_SHA,'JM5 archive checksum mismatch'
 with zipfile.ZipFile(archive) as z:
  names=[n for n in z.namelist() if n.replace('\\','/').endswith('resources/bin/upscayl-jm.exe')];assert len(names)==1
  data=z.read(names[0]);assert hashlib.sha256(data).hexdigest()==ENGINE_SHA,'Modified engine checksum mismatch'
  target=ROOT/'resources/win/bin/upscayl-jm.exe';target.write_bytes(data)
 proof={'sourceCommit':'7f0fbb74119c265854f243cf9929c63aa2217bd1','sourceRun':'https://github.com/gptxjm-beep/upscayl/actions/runs/42980218956','engineSha256':ENGINE_SHA,'sourceTreeMatched':True,'portableSha256':ZIP_SHA}
 out=ROOT/'.test-artifacts/jm6';out.mkdir(parents=True,exist_ok=True);(out/'native-provenance.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof))
if __name__=='__main__':main()
