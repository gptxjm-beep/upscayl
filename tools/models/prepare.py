"""Import pinned original ESRGAN weights, convert, and validate on the actual engine.
No model is installed or selectable before reference comparisons pass. This is a
functional compatibility test, not a GPU performance benchmark.
"""
import argparse, hashlib, json, math, os, platform, re, shutil, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / 'common/optional-models.json').read_text())
def sha(file):
    h = hashlib.sha256()
    with open(file, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()
def run(command, log, timeout=900):
    with open(log, 'wb') as f:
        subprocess.run(list(map(str, command)), stdout=f, stderr=subprocess.STDOUT, check=True, timeout=timeout)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--id', choices=CATALOG, required=True)
    p.add_argument('--weights', type=Path, required=True)
    p.add_argument('--optimizer', type=Path, required=True, help='ncnnoptimize from official NCNN 20240410 release')
    p.add_argument('--engine', type=Path, required=True, help='built jm.5 upscayl-jm executable')
    p.add_argument('--destination', type=Path, required=True)
    p.add_argument('--accept-noncommercial-sharealike-license', action='store_true', required=True)
    p.add_argument('--gpu', default='0')
    p.add_argument('--existing-conversion', type=Path, help='Repeat validation of an existing conversion; original weights and all comparisons remain mandatory.')
    a = p.parse_args(); meta = CATALOG[a.id]
    if sha(a.weights) != meta['sourceSha256']: p.error('Original weight SHA-256 differs from the pinned official source.')
    import torch, numpy as np, pnnx
    from PIL import Image
    from spandrel import ModelLoader
    torch.set_num_threads(2)
    descriptor = ModelLoader().load_from_state_dict(torch.load(a.weights, map_location='cpu', weights_only=True))
    if descriptor.architecture.id != 'ESRGAN' or descriptor.scale != meta['nativeScale'] or descriptor.input_channels != 3 or descriptor.output_channels != 3:
        p.error('Architecture, RGB channels or native scale does not match the reviewed metadata.')
    class NativeRRDB(torch.nn.Module):
        def __init__(self):
            super().__init__(); self.layers = descriptor.model.model
            self.unshuffle = descriptor.model.shuffle_factor or 1
        def forward(self, x):
            if self.unshuffle > 1: x = torch.nn.functional.pixel_unshuffle(x, self.unshuffle)
            return self.layers(x)
    model = NativeRRDB().eval()
    if model.unshuffle != meta['inputMultiple']: p.error('Input alignment does not match reviewed metadata.')
    a.destination.mkdir(parents=True, exist_ok=True)
    for suffix in ['.param', '.bin', '.model.json', '.LICENSE.txt']:
        if (a.destination / (a.id + suffix)).exists(): p.error('Destination already contains this model; choose a new folder.')
    with tempfile.TemporaryDirectory(prefix='jm5-model-') as folder:
        work = Path(folder); old_cwd = Path.cwd()
        if a.existing_conversion:
            for suffix in ['.param','.bin']:
                shutil.copy2(a.existing_conversion/(a.id+suffix),work/(a.id+suffix))
        else:
            os.chdir(work)
            try:
                pnnx.export(model, 'rrdb.pt', inputs=torch.rand(1,3,16,16), inputs2=torch.rand(1,3,20,24), fp16=True, check_trace=False)
            finally: os.chdir(old_cwd)
            graph = (work / 'rrdb.ncnn.param').read_text()
            graph = re.sub(r'\bin0\b', 'data', graph); graph = re.sub(r'\bout0\b', 'output', graph)
            (work / 'input.param').write_text(graph)
            run([a.optimizer.resolve(), work/'input.param', work/'rrdb.ncnn.bin', work/(a.id+'.param'), work/(a.id+'.bin'), '65536'], work/'optimizer.log')
        evidence=a.destination/(a.id+'.validation'); evidence.mkdir(exist_ok=True)
        for suffix in ['.param','.bin']: shutil.copy2(work/(a.id+suffix),evidence/('candidate'+suffix))
        scale = meta['nativeScale']; alignment = meta['inputMultiple']
        def reflect(indices, length):
            if length == 1: return np.zeros_like(indices)
            values = indices % (2*(length-1)); return np.where(values < length, values, 2*(length-1)-values)
        def reference(array, tile, tta):
            h,w,_ = array.shape; result = np.zeros((h*scale,w*scale,3),np.float32)
            for y in range(0,h,tile):
                for x in range(0,w,tile):
                    th,tw = min(tile,h-y),min(tile,w-x)
                    ph,pw = th+20,tw+20
                    ph += (-ph)%alignment; pw += (-pw)%alignment
                    padded = array[reflect(np.arange(y-10,y-10+ph),h)[:,None],reflect(np.arange(x-10,x-10+pw),w)[None,:],:]
                    tensor = torch.from_numpy(padded.copy()).permute(2,0,1)[None].float()/255
                    predictions=[]
                    with torch.inference_mode():
                        for transpose in ([False,True] if tta else [False]):
                            for flip in ([(),(-1,),(-2,-1),(-2,)] if tta else [()]):
                                value=tensor.transpose(-2,-1) if transpose else tensor
                                if flip: value=value.flip(flip)
                                output=model(value)
                                if flip: output=output.flip(flip)
                                if transpose: output=output.transpose(-2,-1)
                                predictions.append(output)
                    mean=torch.stack(predictions).mean(0)[0,:,10*scale:(10+th)*scale,10*scale:(10+tw)*scale]
                    result[y*scale:(y+th)*scale,x*scale:(x+tw)*scale] = mean.permute(1,2,0).numpy()
            return np.floor(np.clip(result,0,1)*255+.5).astype(np.uint8)
        reports=[]
        for index,(width,height,tta) in enumerate([(32,32,False),(17,13,False),(35,33,False),(8,8,False),(17,19,True)]):
            yy,xx=np.mgrid[:height,:width]
            rgb=np.stack([(xx*7+yy*3)%256,(xx*2+yy*11)%256,(xx*13+yy*5)%256],axis=-1).astype(np.uint8)
            inp=work/f'case-{index}.png'; out=work/f'result-{index}.png'; Image.fromarray(rgb).save(inp)
            command=[a.engine.resolve(),'-i',inp,'-o',out,'-m',work,'-n',a.id,'-z',scale,'-a',alignment,'-g',a.gpu,'-t',32,'-f','png','-c',6]
            if meta.get('fullPrecision'): command+=['-F','1']
            if tta: command+=['-x']
            run(command,work/f'engine-{index}.log')
            with Image.open(out) as decoded:
                decoded.load(); actual=np.array(decoded.convert('RGB'))
            expected=reference(rgb,32,tta)
            if actual.shape != expected.shape: raise RuntimeError('Native output dimensions differ from reference.')
            delta=actual.astype(np.float64)-expected.astype(np.float64); mse=float((delta**2).mean())
            metrics={'input':[width,height],'output':[width*scale,height*scale],'tile':32,'tta':tta,'maxAbs':float(abs(delta).max()),'mae':float(abs(delta).mean()),'psnrDb':100 if mse==0 else 20*math.log10(255/math.sqrt(mse))}
            metrics['passed']=metrics['psnrDb']>=40 and metrics['mae']<=2 and metrics['maxAbs']<=24
            reports.append(metrics); print(json.dumps(metrics),flush=True)
            # Preserve evidence even if the compatibility gate rejects a model.
            evidence=a.destination/(a.id+'.validation'); evidence.mkdir(exist_ok=True)
            shutil.copy2(work/f'engine-{index}.log',evidence/f'engine-{index}.log')
            Image.fromarray(expected).save(evidence/f'reference-{index}.png');shutil.copy2(out,evidence/f'actual-{index}.png')
            if not metrics['passed']: raise RuntimeError('Reference comparison failed; no selectable model was installed.')
        manifest={'version':1,'id':a.id,**meta,'licenseAccepted':True,'files':{'param':sha(work/(a.id+'.param')),'bin':sha(work/(a.id+'.bin'))},'validation':{'pipeline':'jm5-model-api-v1','passed':True,'engineSha256':sha(a.engine),'platform':platform.platform(),'torch':torch.__version__,'conversionReused':bool(a.existing_conversion),'optimizerSha256':sha(a.optimizer),'cases':reports,'scope':'Synthetic RGB functional compatibility only; real page quality and GPU performance remain to be measured.'}}
        for suffix in ['.param','.bin']: shutil.copy2(work/(a.id+suffix),a.destination/(a.id+suffix))
        shutil.copy2(ROOT/'tools/models/LICENSE-CC-BY-NC-SA-4.0.txt',a.destination/(a.id+'.LICENSE.txt'))
        (a.destination/(a.id+'.ATTRIBUTION.txt')).write_text(meta['name']+' by '+meta['author']+'\nSource: '+meta['source']+'\nLicense: '+meta['license']+'\nChanges: converted to NCNN FP16 with native padding/alignment; see model manifest for validation scope.\n')
        # Manifest is the activation gate; publish it only after every check passed.
        temp=a.destination/(a.id+'.model.json.pending');temp.write_text(json.dumps(manifest,indent=2)+'\n');temp.replace(a.destination/(a.id+'.model.json'))
        print('Verified optional import ready:',a.destination,flush=True)
if __name__=='__main__': main()
