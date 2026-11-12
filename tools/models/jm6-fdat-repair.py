"""Repair only FDAT using the verified JM6 baseline and original-weight refs.
Other five packaged models are copied byte-for-byte. No new weights or PyTorch
checkpoint are loaded. Passed validation is written only by real ORT inference.
"""
import argparse,copy,hashlib,importlib.util,json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
CATALOG=json.loads((ROOT/'common/pipeline-models.json').read_text(encoding='utf-8'))
OPTIONAL=json.loads((ROOT/'common/optional-models.json').read_text(encoding='utf-8'))
BASELINE={'4x-illustrationjanai-v3detail-fdat-xl':'79539970414475953946fc58e474f5ac94200391fa7a387d4a2b55ecd1e67a5b','4x-illustrationjanai-v3denoise-fdat-xl':'3306ea3dd51da95c0b05602b0021da62f59eda59502289b52107dc2b22ee2998'}
def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def read(file):return json.loads(file.read_text(encoding='utf-8-sig'))
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline-models',required=True,type=Path);p.add_argument('--reference-root',required=True,type=Path);p.add_argument('--destination',required=True,type=Path);a=p.parse_args();source=a.baseline_models.resolve();dest=a.destination.resolve()
 if dest.exists() and any(dest.iterdir()):raise RuntimeError('Destination is not empty; existing work was preserved')
 dest.mkdir(parents=True,exist_ok=True);ids=set(OPTIONAL)|{'4x-alchemy','adaptive-3d-lut-srgb'}|set(BASELINE);unchanged=[];reports=[]
 for id in sorted(ids):
  m=read(source/(id+'.model.json'));meta=CATALOG.get(id) or OPTIONAL[id]
  if m['id']!=id or m['sourceSha256']!=meta['sourceSha256'] or m['license']!=meta['license'] or not m['licenseAccepted'] or not m['validation']['passed']:raise RuntimeError('Unverified baseline identity: '+id)
  if m['version']==1:
   for role in ['param','bin']:
    if sha(source/(id+'.'+role))!=m['files'][role]:raise RuntimeError('Baseline file changed: '+id)
  else:
   for role,f in m['files'].items():
    if Path(f['name']).name!=f['name'] or not f['name'].startswith(id+'.') or sha(source/f['name'])!=f['sha256']:raise RuntimeError('Baseline file changed: '+id+' '+role)
  for file in source.iterdir():
   if file.is_file() and file.name.startswith(id+'.'):
    if id in BASELINE and file.name in [id+'.onnx',id+'.model.json',id+'.ATTRIBUTION.txt']:continue
    shutil.copy2(file,dest/file.name)
  if id not in BASELINE:
   for file in source.iterdir():
    if file.is_file() and file.name.startswith(id+'.'):
     assert sha(file)==sha(dest/file.name);unchanged.append({'name':file.name,'sha256':sha(file)})
 for id,expected in BASELINE.items():
  import onnx
  original=source/(id+'.onnx')
  if sha(original)!=expected:raise RuntimeError('Expected the exact reviewed dev.1 FP32 graph: '+id)
  spec=importlib.util.spec_from_file_location('fdat_dml_lower',ROOT/'tools/models/fdat-directml-graph.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  graph,report=module.lower(onnx.load(original,load_external_data=False));onnx.save(graph,dest/(id+'.onnx'))
  report.update(id=id,baselineGraphSha256=expected,graphSha256=sha(dest/(id+'.onnx')),originalWeightSha256=CATALOG[id]['sourceSha256'])
  audit=dest/(id+'.GRAPH-AUDIT.json');audit.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
  m=read(source/(id+'.model.json'));m.update(graphVersion=module.PROFILE,opset=17,spatialSymbols=report['spatialSymbols']);m['files']['model']['sha256']=report['graphSha256'];m['files']['graph-audit']={'name':audit.name,'sha256':sha(audit)}
  attribution=dest/(id+'.ATTRIBUTION.txt');attribution.write_text((source/attribution.name).read_text(encoding='utf-8-sig')+'\nRepair profile: '+module.PROFILE+'. Exact erf GELU + constant reduction axes lowered to ONNX 17; all original FP32 initializers bitwise unchanged. GPU validation on Windows 10 RTX 3060 Ti remains required.\n',encoding='utf-8');m['files']['attribution']={'name':attribution.name,'sha256':sha(attribution)}
  m['transformation']='Original BF16 values promoted losslessly to FP32, followed by '+module.PROFILE+' semantic graph lowering. No learned weights or architecture replaced.';m['validation']['passed']=False
  work=dest/(id+'.validation');work.mkdir();matches=[d for d in a.reference_root.resolve().rglob(id+'.validation') if (d/'cases.json').is_file()]
  if len(matches)!=1:raise RuntimeError('Expected one original-weight reference directory for '+id)
  refs=matches[0];cases=read(refs/'cases.json')
  if len(cases)!=3:raise RuntimeError('Unexpected reference count')
  for index,case in enumerate(cases):
   for key,name in [('source',f'input-{index}.png'),('expected',f'expected-{index}.png')]:
    file=refs/name
    if not file.is_file():raise RuntimeError('Missing original-weight reference pixels: '+str(file))
    target=work/name;shutil.copy2(file,target);case[key]=str(target)
  (work/'cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8');(work/'draft.json').write_text(json.dumps({'manifest':m,'metadata':CATALOG[id]},indent=2),encoding='utf-8')
  subprocess.run(['node',str(ROOT/'tools/models/jm6-validate.cjs'),str(work)],cwd=ROOT,check=True,timeout=600);reports.append(report)
 proof={'baselineRun':'https://github.com/gptxjm-beep/upscayl/actions/runs/43151751265','repaired':reports,'unchangedFiles':unchanged,'referenceSource':'Original-weight PyTorch expected PNGs from the previously verified JM6 run, reused unchanged.','gpuFixProven':False}
 (dest.parent/'fdat-repair-proof.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8');print('::notice title=FDAT semantic graph repair::'+json.dumps(proof,separators=(',',':')))
if __name__=='__main__':main()
