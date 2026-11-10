import path from 'path';
import type { BatchFailure } from '../../common/types/batch-ui';
export function describeFailure(details:string,image?:string,stage?:string,code?:string):BatchFailure {
  const nativeCode=code&&Number.isFinite(Number(code))?(Number(code)>>>0).toString(16):'';
  const evidence=details+' '+nativeCode;
  let reason='Processing could not finish. Your completed images and recovery progress have been kept.';
  if(/88982f51/i.test(evidence))reason='The image encoder rejected invalid or unsupported output dimensions.';
  else if(/out of memory|malloc|allocation failed/i.test(details))reason='There was not enough memory to finish this image.';
  else if(stage==='decode')reason='The input image could not be read.';
  else if(stage==='encode')reason='The output image could not be saved.';
  else if(stage==='resize')reason='The output dimensions or resize allocation could not be completed safely.';
  else if(stage==='inference')reason='The image could not finish processing on the selected GPU.';
  else if(/dimensions\/format|corrupt|decode/i.test(details))reason='The output did not pass image validation.';
  else if(/Engine\/model changed|Saved settings changed|Source changed|older Pause protocol/i.test(details))reason=details.replace(/^Error:\s*/,'').slice(0,300);
  return {image:image?path.basename(image):undefined,stage,code,reason,details:details.slice(-6000)};
}
export function significantEngineLine(line:string) {
  return /\b(error|warning|failed|failure|invalid|cannot|couldn't|HRESULT|WIC|out of memory|dimensions|not found)\b/i.test(line);
}
