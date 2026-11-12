"""Prepare and reference-test only the requested JM6 model (3 images).
Official source hashes are checked before safetensors / weights_only loading.
This is CPU functional validation, not a hardware benchmark.
"""
import argparse,hashlib,importlib.util,json,math,os,subprocess,sys,zipfile,copy,types
from pathlib import Path
import numpy as np
import torch
import onnx
from onnx import numpy_helper
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
CATALOG=json.loads((ROOT/'common/pipeline-models.json').read_text(encoding='utf-8'))
ARCHIVES={
 'IllustrationJaNai_V3detail.zip':'27749962bc934779f867730cdb10617e3d7475313f920a7a966c56b75dbdbeda',
 'IllustrationJaNai_V3denoise.zip':'6c26828ad8e142c9e9c7181451257f3f56a0f5c7f897d9c7878ce898404f53e5',
 'IllustrationJaNai_V3detail_onnx.zip':'839277aca3b3a0ed1e2ea972331622354ef31d214a563f68e08ae42e1067c53c',
 'IllustrationJaNai_V3denoise_onnx.zip':'86d393d5c55a7ac0df986cd42e79a0351ecf89b370752f79d4fd0a9cf3f2aa58'}
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def checked(p,want):
 if sha(p)!=want:raise RuntimeError('Original checksum mismatch: '+str(p))
 return p

def promote_bfloat(message):
 if isinstance(message,onnx.TensorProto) and message.data_type==onnx.TensorProto.BFLOAT16:
  message.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(message).astype(np.float32),name=message.name));return
 if isinstance(message,onnx.TypeProto.Tensor) and message.elem_type==onnx.TensorProto.BFLOAT16:message.elem_type=onnx.TensorProto.FLOAT
 if isinstance(message,onnx.NodeProto) and message.op_type=='Cast':
  for a in message.attribute:
   if a.name=='to' and a.i==onnx.TensorProto.BFLOAT16:a.i=onnx.TensorProto.FLOAT
 for field,value in message.ListFields():
  if field.message_type is None:continue
  if field.is_repeated:
   for item in value:promote_bfloat(item)
  else:promote_bfloat(value)

def extract(archive,name,destination):
 with zipfile.ZipFile(archive) as z:
  matches=[n for n in z.namelist() if Path(n).name==name]
  if len(matches)!=1:raise RuntimeError('Exact original file not found: '+name)
  destination.write_bytes(z.read(matches[0]))
 return destination

def build_fdat(cache,work,id,model_file):
 from safetensors.torch import load_file
 detail='v3detail' in id;variant='detail' if detail else 'denoise';step='27k' if detail else '32k'
 weights_name=f'4x_IllustrationJaNai_V3{variant}_FDAT_XL_{step}_bf16.safetensors'
 for suffix in ['', '_onnx']:
  f=f'IllustrationJaNai_V3{variant}{suffix}.zip';checked(cache/f,ARCHIVES[f])
 weights=extract(cache/f'IllustrationJaNai_V3{variant}.zip',weights_name,work/weights_name);checked(weights,CATALOG[id]['sourceSha256'])
 graph_name=f'4x_IllustrationJaNai_V3{variant}_FDAT_XL_{step}_bf16_1x3xHxW_dyn-HW_strong_bf16_op23_dynamo.onnx'
 graph=extract(cache/f'IllustrationJaNai_V3{variant}_onnx.zip',graph_name,work/graph_name)
 wanted='2977da028b27424a17a9b3bfbd732033e9e02062d6849280fa67f334985e1245' if detail else '1b41dc4d040ce50cdfb168dc75e43418817742390fdb4eb2dc3ac844a4e2d77f';checked(graph,wanted)
 m=onnx.load(graph,load_external_data=False)
 if any(t.external_data for t in m.graph.initializer):raise RuntimeError('Unexpected external data references in official graph.')
 promote_bfloat(m);onnx.checker.check_model(m)
 converter=ROOT/'tools/models/fdat-directml-graph.py';spec_graph=importlib.util.spec_from_file_location('jm6_fdat_dml_graph',converter);graph_module=importlib.util.module_from_spec(spec_graph);spec_graph.loader.exec_module(graph_module)
 m,graph_audit=graph_module.lower(m);onnx.save(m,model_file);(work/'graph-audit.json').write_text(json.dumps(graph_audit,indent=2),encoding='utf-8')
 code=ROOT/'tools/models/reference/fdat/fdat.py';checked(code,'db8966706b1b9f2dcb201ba334cdc3e25824767580b653a5bf64f019afe45e28')
 spec=importlib.util.spec_from_file_location('jm6_fdat_reference',code);module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
 state=load_file(str(weights));_,index,scale,dim,out_ch,mid,_=map(int,state['upsampler.MetaUpsample'].tolist());groups=len({k.split('.')[1] for k in state if k.startswith('groups.')});blocks=len({k.split('.')[3] for k in state if k.startswith('groups.0.blocks.')});heads,_,area=state['groups.0.blocks.0.attn.bias'].shape
 model=module.FDAT(num_in_ch=3,num_out_ch=out_ch,scale=scale,embed_dim=dim,num_groups=groups,depth_per_group=blocks//2,num_heads=heads,window_size=math.isqrt(area),ffn_expansion_ratio=state['groups.0.blocks.0.ffn.fc1.weight'].shape[0]/dim,aim_reduction_ratio=dim//state['groups.0.blocks.0.inter.cg.1.weight'].shape[0],upsampler_type=module.SampleMods3.__args__[index],mid_dim=mid)
 model.load_state_dict(state,strict=True);model.eval().float();return model,'input','output','Original BF16 values promoted losslessly to FP32; exact erf GELU and constant reduction axes adapted to ONNX 17. All original FP32 initializers are bitwise unchanged; no architecture or learned-weight replacement.'

def build_alchemy(cache,model_file):
 from spandrel import ModelLoader
 weights=checked(cache/'4x_Alchemy.pth',CATALOG['4x-alchemy']['sourceSha256']);state=torch.load(weights,map_location='cpu',weights_only=True);model=ModelLoader().load_from_state_dict(state['params']).model.eval().float()
 # Export-only correction: the original torch.tensor([W,H]) freezes traced
 # spatial sizes. Preserve every DySample equation/weight; derive this tensor
 # from ONNX Shape instead. Reference inference below uses the untouched model.
 exported=copy.deepcopy(model)
 def dynamic_dysample(self,x):
  import torch.nn.functional as F
  offset=self.offset(x)*self.scope(x).sigmoid()*.5+self.init_pos
  B,_,H,W=offset.shape;offset=offset.view(B,2,-1,H,W)
  coords_h=torch.arange(H)+.5;coords_w=torch.arange(W)+.5
  coords=torch.stack(torch.meshgrid([coords_w,coords_h],indexing='ij')).transpose(1,2).unsqueeze(1).unsqueeze(0).type(x.dtype).to(x.device)
  shape=torch._shape_as_tensor(x);normalizer=torch.stack((shape[-1],shape[-2])).to(dtype=x.dtype,device=x.device).view(1,2,1,1,1)
  coords=2*(coords+offset)/normalizer-1
  coords=F.pixel_shuffle(coords.reshape(B,-1,H,W),self.scale).view(B,2,-1,self.scale*H,self.scale*W).permute(0,2,3,4,1).contiguous().flatten(0,1)
  out=F.grid_sample(x.reshape(B*self.groups,-1,H,W),coords,mode='bilinear',align_corners=False,padding_mode='border').view(B,-1,self.scale*H,self.scale*W)
  return self.end_conv(out) if self.end_convolution else out
 for module in exported.modules():
  if module.__class__.__name__=='DySample':module.forward=types.MethodType(dynamic_dysample,module)
 torch.onnx.export(exported,torch.rand(1,3,32,32),str(model_file),opset_version=17,input_names=['input'],output_names=['output'],dynamic_axes={'input':{2:'height',3:'width'},'output':{2:'out_height',3:'out_width'}},dynamo=False)
 return model,'input','output','Original RealPLKSR weights; shape-safe FP32 DySample export with dynamic normalizer, original equations and weights.'

def build_lut(cache,work,model_file,lut_file):
 from torch import nn
 if (cache/'3dlut-classifier.pth').exists() and (cache/'3dlut-LUTs.pth').exists():
  for name in ['classifier.pth','LUTs.pth']:(work/name).write_bytes((cache/('3dlut-'+name)).read_bytes())
 else:
  with zipfile.ZipFile(cache/'lut-source.zip') as z:
   for name in ['classifier.pth','LUTs.pth']:
    candidates=[n for n in z.namelist() if n.endswith('/pretrained_models/sRGB/'+name)]
    if len(candidates)!=1:raise RuntimeError('Missing exact paired sRGB original weights')
    (work/name).write_bytes(z.read(candidates[0]))
 checked(work/'classifier.pth',CATALOG['adaptive-3d-lut-srgb']['sourceSha256']);checked(work/'LUTs.pth','c1bb2bc4b7239c1a7e96159f5923123ba796b1fceb0b8c3132b423ea825b821a')
 class Classifier(nn.Module):
  def __init__(self):
   super().__init__();layers=[nn.Upsample(size=(256,256),mode='bilinear',align_corners=False),nn.Conv2d(3,16,3,stride=2,padding=1),nn.LeakyReLU(.2),nn.InstanceNorm2d(16,affine=True)]
   for a,b,norm in [(16,32,True),(32,64,True),(64,128,True),(128,128,False)]:
    layers.extend([nn.Conv2d(a,b,3,stride=2,padding=1),nn.LeakyReLU(.2)])
    if norm:layers.append(nn.InstanceNorm2d(b,affine=True))
   layers.extend([nn.Dropout(.5),nn.Conv2d(128,3,8)]);self.model=nn.Sequential(*layers)
  def forward(self,x):return self.model(x)
 model=Classifier();model.load_state_dict(torch.load(work/'classifier.pth',map_location='cpu',weights_only=True),strict=True);model.eval()
 state=torch.load(work/'LUTs.pth',map_location='cpu',weights_only=True);luts=np.stack([state[str(i)]['LUT'].numpy() for i in range(3)]).astype('<f4');assert luts.shape==(3,3,33,33,33);luts.tofile(lut_file)
 torch.onnx.export(model,torch.rand(1,3,256,256),str(model_file),opset_version=17,input_names=['input'],output_names=['weights'],dynamo=False)
 return model,'input','weights','Original paired sRGB predictor + original three LUT bases; original trilinear binsize and axis order.',luts

def input_image(index,width,height):
 files=['digital-art-4x','high-fidelity-4x','upscayl-standard-4x'];p=ROOT/'renderer/public/model-comparison'/files[index%3]/'before.webp'
 a=Image.open(p).convert('RGB').resize((width,height),Image.Resampling.BICUBIC);return np.asarray(a).copy()

def reference_upscale(model,rgb,tile,multiple,minimum,halo,scale):
 h,w,_=rgb.shape;out=np.empty((h*scale,w*scale,3),dtype=np.uint8)
 with torch.inference_mode():
  for y in range(0,h,tile):
   for x in range(0,w,tile):
    cw,ch=min(tile,w-x),min(tile,h-y);left,top=max(0,x-halo),max(0,y-halo);right,bottom=min(w,x+cw+halo),min(h,y+ch+halo);part=rgb[top:bottom,left:right];ph=max(minimum,math.ceil(part.shape[0]/multiple)*multiple);pw=max(minimum,math.ceil(part.shape[1]/multiple)*multiple);part=np.pad(part,((0,ph-part.shape[0]),(0,pw-part.shape[1]),(0,0)),mode='symmetric');v=model(torch.from_numpy(part.transpose(2,0,1).copy()).float().unsqueeze(0)/255).squeeze(0).permute(1,2,0).numpy();v=np.floor(np.clip(v,0,1)*255+.5).astype(np.uint8);sx,sy=(x-left)*scale,(y-top)*scale;out[y*scale:(y+ch)*scale,x*scale:(x+cw)*scale]=v[sy:sy+ch*scale,sx:sx+cw*scale]
 return out

def reference_lut(model,luts,rgb,strength,style):
 with torch.inference_mode():weights=model(torch.from_numpy(rgb.transpose(2,0,1).copy()).float().unsqueeze(0)/255).flatten().numpy()
 lut=(weights[:,None,None,None,None]*luts).sum(axis=0).astype(np.float32).reshape(3,-1);flat=rgb.reshape(-1,3).astype(np.float64);p=flat/255/(1.000001/32);ix=np.floor(p).astype(np.int64);f=p-ix;value=np.zeros_like(flat)
 for z in range(2):
  for y in range(2):
   for x in range(2):
    index=ix[:,0]+x+(ix[:,1]+y)*33+(ix[:,2]+z)*33*33;weight=(f[:,0] if x else 1-f[:,0])*(f[:,1] if y else 1-f[:,1])*(f[:,2] if z else 1-f[:,2]);value+=lut[:,index].T*weight[:,None]
 chroma=flat.max(axis=1)-flat.min(axis=1);alpha=strength*(.75 if style=='natural' else 1)*chroma/(chroma+8)*np.clip((255-flat.min(axis=1))/24,0,1);out=np.floor(np.clip(flat*(1-alpha[:,None])+np.clip(value*255,0,255)*alpha[:,None],0,255)+.5).astype(np.uint8).reshape(rgb.shape);return out,weights

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--id',required=True,choices=[k for k,v in CATALOG.items() if v['sourceSha256']]);parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--destination',type=Path,required=True);parser.add_argument('--accept-model-license',action='store_true',required=True);args=parser.parse_args();torch.set_num_threads(2)
 id=args.id;meta=CATALOG[id];dest=args.destination.resolve();dest.mkdir(parents=True,exist_ok=True);
 if (dest/(id+'.model.json')).exists():raise RuntimeError('Use a fresh destination; an existing verified model is preserved.')
 work=dest/(id+'.validation');work.mkdir(exist_ok=True);model_file=dest/(id+'.onnx');luts=None
 if 'fdat-xl' in id:model,inp,out,transformation=build_fdat(args.cache,work,id,model_file)
 elif id=='4x-alchemy':model,inp,out,transformation=build_alchemy(args.cache,model_file)
 else:model,inp,out,transformation,luts=build_lut(args.cache,work,model_file,dest/(id+'.luts.f32'))
 files={'model':{'name':model_file.name,'sha256':sha(model_file)}}
 if luts is not None:files['luts']={'name':id+'.luts.f32','sha256':sha(dest/(id+'.luts.f32'))}
 license_name='FDAT-CC-BY-NC-4.0.txt' if 'fdat-xl' in id else 'Alchemy-LICENSE.md' if id=='4x-alchemy' else 'Adaptive-3DLUT-Apache-2.0.txt'
 license_file=dest/(id+'.LICENSE.txt');license_file.write_bytes((ROOT/'tools/models/licenses'/license_name).read_bytes());files['license']={'name':license_file.name,'sha256':sha(license_file)}
 attribution=dest/(id+'.ATTRIBUTION.txt');attribution.write_text(meta['fullName']+'\nAuthor: '+meta['author']+'\nSource: '+meta['source']+'\nLicense: '+meta['license']+'\nOriginal SHA-256: '+meta['sourceSha256']+'\nChanges: '+transformation+'\n',encoding='utf-8');files['attribution']={'name':attribution.name,'sha256':sha(attribution)}
 manifest={'version':2,'id':id,'modelVersion':meta['version'],'engine':'onnx','task':meta['task'],'nativeScale':meta['nativeScale'],'inputMultiple':meta['inputMultiple'],'sourceSha256':meta['sourceSha256'],'license':meta['license'],'licenseAccepted':True,'files':files,'input':inp,'output':out,'transformation':transformation,'validation':{'pipeline':'jm6-onnx-v1','passed':False,'images':3,'provider':'cpu','cases':[]}}
 if meta.get('graphVersion'):
  audit=json.loads((work/'graph-audit.json').read_text(encoding='utf-8'));manifest.update(graphVersion=meta['graphVersion'],opset=17,spatialSymbols=audit['spatialSymbols'])
 if luts is not None:manifest['lutSize']=33
 (work/'draft.json').write_text(json.dumps({'manifest':manifest,'metadata':meta},indent=2),encoding='utf-8')
 cases=[]
 for i,(w,h,tile) in enumerate([(32,32,64),(35,33,32),(12,97,64)]):
  if luts is not None and i==2:h=70200
  rgb=input_image(i,w,h);source=work/f'input-{i}.png';expected=work/f'expected-{i}.png';Image.fromarray(rgb).save(source);strength=.35 if i!=1 else .65;style='natural' if i!=1 else 'vivid'
  if luts is None:result=reference_upscale(model,rgb,tile,meta['inputMultiple'],meta['minimum'],meta['halo'],meta['nativeScale'])
  else:result,weights=reference_lut(model,luts,rgb,strength,style);(work/f'weights-{i}.json').write_text(json.dumps(weights.tolist()),encoding='utf-8')
  Image.fromarray(result).save(expected);cases.append({'source':str(source),'expected':str(expected),'width':w,'height':h,'tile':tile,'strength':strength,'style':style});print('Reference image',id,i,w,h,flush=True)
 (work/'cases.json').write_text(json.dumps(cases,indent=2),encoding='utf-8');subprocess.run(['node',str(ROOT/'tools/models/jm6-validate.cjs'),str(work)],check=True,cwd=ROOT,timeout=900)
if __name__=='__main__':main()
