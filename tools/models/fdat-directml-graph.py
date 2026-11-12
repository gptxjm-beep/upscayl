"""Lower the reviewed FP32 FDAT graph to ONNX 17 without changing weights.
No relabel-only downgrade: Gelu is expanded to its exact erf definition and
Reduce axes inputs are converted to the opset-17 attribute form. Other operators
are restricted to this reviewed FLOAT/INT64 graph's unchanged schema semantics.
"""
import copy,json
import numpy as np
import onnx
from onnx import helper,numpy_helper
PROFILE='fdat-dml17-v1'
ALLOWED={'Cast','Shape','Squeeze','Conv','Mul','Reshape','Concat','Transpose','LayerNormalization','Mod','Sub','Add','Div','MatMul','Slice','Softmax','Gelu','ReduceMean','Sigmoid','ReduceL2','Clip','Expand','ConvTranspose'}
def lower(source):
 m=copy.deepcopy(source)
 if [(x.domain,x.version) for x in m.opset_import]!=[('',23)]:raise ValueError('Expected the exact reviewed opset-23 FDAT graph')
 if any(n.domain or n.op_type not in ALLOWED for n in m.graph.node):raise ValueError('Unexpected operator; review before lowering')
 originals={t.name:t.SerializeToString() for t in m.graph.initializer}
 if any(t.data_type not in [onnx.TensorProto.FLOAT,onnx.TensorProto.INT64] or t.external_data for t in m.graph.initializer):raise ValueError('Expected embedded FP32/INT64 data only')
 tensors={t.name:numpy_helper.to_array(t) for t in m.graph.initializer};names=set(originals)|{o for n in m.graph.node for o in n.output}
 prefix='__jm6_fdat17_'
 if any(n.startswith(prefix) for n in names):raise ValueError('Reserved graph name collision')
 for name,value in [('half',.5),('one',1.),('sqrt2',2**.5)]:m.graph.initializer.append(numpy_helper.from_array(np.asarray(value,dtype=np.float32),name=prefix+name))
 nodes=[];gelu=0;reductions=0
 for index,node in enumerate(m.graph.node):
  attrs={a.name:helper.get_attribute_value(a) for a in node.attribute}
  if node.op_type=='Cast' and (set(attrs)!={'to'} or attrs['to']!=onnx.TensorProto.FLOAT):raise ValueError('Unreviewed Cast conversion')
  if node.op_type=='Gelu':
   if attrs.get('approximate',b'none')!=b'none' or len(node.input)!=1 or len(node.output)!=1:raise ValueError('Unreviewed Gelu approximation')
   p=prefix+str(index);x=node.input[0]
   nodes.extend([helper.make_node('Div',[x,prefix+'sqrt2'],[p+'_scaled'],name=p+'_div'),helper.make_node('Erf',[p+'_scaled'],[p+'_erf'],name=p+'_erf'),helper.make_node('Add',[p+'_erf',prefix+'one'],[p+'_plus'],name=p+'_add'),helper.make_node('Mul',[x,prefix+'half'],[p+'_half'],name=p+'_half'),helper.make_node('Mul',[p+'_half',p+'_plus'],list(node.output),name=p+'_output')]);gelu+=1;continue
  if node.op_type in ['ReduceMean','ReduceL2']:
   if len(node.input)!=2 or node.input[1] not in tensors or attrs.get('noop_with_empty_axes',0)!=0:raise ValueError('Reduction axes are not a reviewed constant')
   axes=tensors[node.input[1]]
   if axes.dtype!=np.int64 or axes.ndim!=1 or not axes.size:raise ValueError('Invalid reduction axes')
   keepdims=attrs.get('keepdims',1);del node.input[1:];del node.attribute[:];node.attribute.extend([helper.make_attribute('axes',axes.tolist()),helper.make_attribute('keepdims',keepdims)]);reductions+=1
  # FLOAT/INT64 forms of these nodes have the same numerical semantics at 17.
  onnx.defs.get_schema(node.op_type,17,'')
  nodes.append(node)
 if gelu!=181 or reductions!=108:raise ValueError('Unexpected FDAT architecture; do not silently transform another model')
 del m.graph.node[:];m.graph.node.extend(nodes);m.opset_import[0].version=17
 onnx.checker.check_model(m,full_check=True)
 after={t.name:t.SerializeToString() for t in m.graph.initializer}
 if any(after.get(name)!=data for name,data in originals.items()):raise AssertionError('Original initializer changed')
 symbols=[d.dim_param for d in m.graph.input[0].type.tensor_type.shape.dim[-2:]]
 if len(symbols)!=2 or not all(symbols):raise ValueError('Expected two named dynamic spatial dimensions')
 report={'profile':PROFILE,'originalOpset':23,'opset':17,'precision':'float32','originalInitializers':len(originals),'originalInitializersBitwiseUnchanged':True,'geluExpanded':gelu,'reductionsAdapted':reductions,'nodesBefore':len(source.graph.node),'nodesAfter':len(m.graph.node),'spatialSymbols':symbols,'irVersionUnchanged':m.ir_version}
 prop=m.metadata_props.add();prop.key='upscayl.graph.profile';prop.value=PROFILE
 return m,report
if __name__=='__main__':
 import argparse
 from pathlib import Path
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('source',type=Path);p.add_argument('destination',type=Path);a=p.parse_args()
 if a.destination.exists():raise SystemExit('Destination exists; original and previous outputs are preserved')
 graph,report=lower(onnx.load(a.source,load_external_data=False));onnx.save(graph,a.destination);print(json.dumps(report,indent=2))
