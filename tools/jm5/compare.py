"""Windows/NVIDIA-only engine regression measurement. Never run on software Vulkan.
Raw engine time and full-output verification are measured separately. Original
inputs are copied into a fresh isolated dataset and their hashes rechecked.
"""
import argparse,csv,ctypes,hashlib,json,os,platform,shutil,subprocess,time
from pathlib import Path
from PIL import Image
Image.MAX_IMAGE_PIXELS=None

def sha(file):
 h=hashlib.sha256()
 with open(file,'rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 return h.hexdigest()
def gpu(index):
 out=subprocess.check_output(['nvidia-smi','-i',str(index),'--query-gpu=name,driver_version,memory.total','--format=csv,noheader,nounits'],text=True,timeout=10).strip()
 return out

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['baseline-engine','candidate-engine','models','input','report']:p.add_argument('--'+name,type=Path,required=True)
 p.add_argument('--model',default='upscayl-standard-4x');p.add_argument('--scale',type=int,default=2);p.add_argument('--tile',type=int,default=200);p.add_argument('--gpu',default='0',help='NCNN GPU ID, may differ from nvidia-smi adapter index');p.add_argument('--nvidia-index',default='0')
 p.add_argument('--format',choices=['png','jpg','webp'],default='png');p.add_argument('--compression',default='0');p.add_argument('--tta',action='store_true');p.add_argument('--repeats',type=int,default=3);p.add_argument('--count',type=int,default=100);p.add_argument('--mode',choices=['batch','single'],default='batch');p.add_argument('--confirm-gpu-benchmark',action='store_true',required=True)
 a=p.parse_args()
 if platform.system()!='Windows':p.error('This acceptance benchmark must run on Windows with a physical NVIDIA GPU.')
 if a.repeats<3:p.error('At least three repetitions are required.')
 if not 1<=a.scale<=16 or a.count<1:p.error('Invalid scale/count.')
 if os.environ.get('VK_ICD_FILENAMES') or os.environ.get('VK_DRIVER_FILES'):p.error('Unset software/override Vulkan ICD variables before measuring.')
 device=gpu(a.nvidia_index)
 if 'RTX 3060 Ti' not in device:p.error('Expected RTX 3060 Ti; adapter identity is '+device)
 builtins=json.loads((Path(__file__).resolve().parents[2]/'package.json').read_text()) # records app version alongside explicit engine hashes
 if a.model not in ['upscayl-standard-4x','upscayl-lite-4x','high-fidelity-4x','digital-art-4x','ultramix-balanced-4x','ultrasharp-4x','remacri-4x']:p.error('Regression comparison accepts shipped 4X models only; legacy Windows misidentifies other native scales.')
 if a.report.exists():p.error('Choose a new report directory; existing results are never replaced.')
 files=sorted(f for f in a.input.iterdir() if f.is_file() and f.suffix.lower() in ['.png','.jpg','.jpeg','.jfif','.webp'])[:a.count]
 if len(files)<a.count:p.error('Input folder contains fewer images than --count.')
 a.report.mkdir(parents=True);dataset=a.report/'inputs';dataset.mkdir();originals=[];expected={}
 for index,file in enumerate(files):
  name=f'{index:05}'+file.suffix.lower();dest=dataset/name;digest=sha(file);shutil.copy2(file,dest)
  if sha(dest)!=digest:raise RuntimeError('Input changed while copying.')
  with Image.open(dest) as image:image.load();size=image.size
  originals.append({'source':str(file.resolve()),'copy':name,'sha256':digest,'size':size});expected[f'{index:05}.'+a.format]=(size[0]*a.scale,size[1]*a.scale)
 model_hashes={ext:sha(a.models/(a.model+'.'+ext)) for ext in ['param','bin']}
 report={'gpu':device,'os':platform.platform(),'appVersion':builtins['version'],'settings':{'model':a.model,'scale':a.scale,'tile':a.tile,'gpu':a.gpu,'tta':a.tta,'format':a.format,'compression':a.compression,'mode':a.mode},'models':model_hashes,'inputs':originals,'cache':'Not flushed; first and subsequent runs retained separately. OS/driver/model disk caches may be warm.','memory':'No reliable per-process WDDM VRAM collected; use the external observer and label adapter-wide values.','initialization':'Not separated: engine has no stable model-ready timestamp on both revisions.','runs':[]}
 engines={'baseline':a.baseline_engine.resolve(),'candidate':a.candidate_engine.resolve()};report['engines']={name:{'file':str(file),'sha256':sha(file)}for name,file in engines.items()}
 for repetition in range(a.repeats):
  for name in (['baseline','candidate'] if repetition%2==0 else ['candidate','baseline']):
   output=a.report/f'{repetition+1}-{name}';output.mkdir();log=output/'engine.log';codes=[]
   options=['-m',str(a.models.resolve()),'-n',a.model,'-z','4','-s',str(a.scale),'-g',a.gpu,'-t',str(a.tile),'-f',a.format,'-c',a.compression]+(['-x'] if a.tta else [])
   start=time.perf_counter()
   with open(log,'wb') as stream:
    if a.mode=='batch':codes.append(subprocess.run([str(engines[name]),'-i',str(dataset.resolve()),'-o',str(output.resolve()),*options],stdout=stream,stderr=subprocess.STDOUT).returncode)
    else:
     for original in originals:
      source=dataset/original['copy'];out=output/(source.stem+'.'+a.format)
      codes.append(subprocess.run([str(engines[name]),'-i',str(source.resolve()),'-o',str(out.resolve()),*options],stdout=stream,stderr=subprocess.STDOUT).returncode)
   raw=time.perf_counter()-start;verify_start=time.perf_counter();valid=0;failures=[];output_hashes={}
   for filename,dimensions in expected.items():
    file=output/filename
    try:
     with Image.open(file) as image:
      image.load()
      if image.size!=dimensions or image.format!={'jpg':'JPEG','png':'PNG','webp':'WEBP'}[a.format]:raise ValueError('Wrong dimensions/format')
     output_hashes[filename]=sha(file);valid+=1
    except Exception as error:failures.append({'file':filename,'error':str(error)})
   verification=time.perf_counter()-verify_start
   decoded_valid=valid;valid_run=not failures and all(code==0 for code in codes)
   if not valid_run:valid=0 # preserve decoded count separately; do not compare an errored run as successful throughput
   row={'revision':name,'repetition':repetition+1,'firstForRevision':repetition==0,'rawSeconds':raw,'verificationSeconds':verification,'totalSeconds':raw+verification,'meanRawSecondsPerInput':raw/len(files),'decodedValidImages':decoded_valid,'validRun':valid_run,'validImages':valid,'validPerMinuteRaw':valid*60/raw if valid_run else None,'validPerMinuteIncludingVerification':valid*60/(raw+verification) if valid_run else None,'exitCodes':codes,'failures':failures,'outputHashes':output_hashes}
   report['runs'].append(row);(a.report/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({k:v for k,v in row.items() if k not in ['outputHashes','exitCodes','failures']}),flush=True)
 for original in originals:
  if sha(original['source'])!=original['sha256']:raise RuntimeError('An original source changed during the benchmark; comparison invalid.')
 fields=['revision','repetition','firstForRevision','rawSeconds','verificationSeconds','totalSeconds','meanRawSecondsPerInput','decodedValidImages','validRun','validImages','validPerMinuteRaw','validPerMinuteIncludingVerification']
 with open(a.report/'summary.csv','w',newline='',encoding='utf-8-sig') as stream:
  writer=csv.DictWriter(stream,fieldnames=fields,extrasaction='ignore');writer.writeheader();writer.writerows(report['runs'])
 print('Finished. Share report.json, summary.csv and engine logs. Original images need not be shared.')
if __name__=='__main__':main()
