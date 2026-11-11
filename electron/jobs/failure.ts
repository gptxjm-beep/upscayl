import path from 'path';
import type { BatchFailure } from '../../common/types/batch-ui';
export function describeFailure(details:string,image?:string,stage?:string,code?:string):BatchFailure {
  const nativeCode=code&&Number.isFinite(Number(code))?(Number(code)>>>0).toString(16):'';
  const evidence=details+' '+nativeCode;
  let reason='Processing could not finish. Your completed images and recovery progress have been kept.';
  if(/ENOSPC|EDQUOT|80070070|80030070|80070027|disk full/i.test(evidence)||stage==='disk'||code==='-28'&&['encode','checkpoint'].includes(stage||''))reason='The output disk is full. Free space before resuming the job.';
  else if(stage==='model')reason='The AI model could not be loaded. Processing stopped to protect the job.';
  else if(stage==='validation-global')reason='Repeated image validation failures stopped the job. Your completed files and recovery data were preserved.';
  else if(stage==='encode-global'||stage==='destination')reason='Repeated output or destination failures stopped the job. Check free space and write permissions.';
  else if(stage==='dimensions')reason=details.replace(/^Error:\s*/,'').slice(0,300);
  else if(stage==='inference-global')reason='Repeated GPU processing failures stopped the job. Check the selected GPU and available memory.';
  else if(/88982f51/i.test(evidence))reason='The image encoder rejected invalid or unsupported output dimensions.';
  else if(/out of memory|malloc|allocation failed/i.test(details))reason='There was not enough memory to finish this image.';
  else if(stage==='stageone')reason='The first AI model could not process this image.';
  else if(stage==='stagetwo')reason='The second AI model could not process this image.';
  else if(stage==='checkpoint')reason='The intermediate image could not be saved or validated.';
  else if(code==='SOURCE_CHANGED')reason='The source changed during processing. Its result was not saved.';
  else if(stage==='decode'||stage==='source')reason='The input image could not be read.';
  else if(stage==='encode')reason='The output image could not be saved.';
  else if(stage==='resize')reason='The output dimensions or resize allocation could not be completed safely.';
  else if(stage==='inference')reason='The image could not finish processing on the selected GPU.';
  else if(/dimensions\/format|corrupt|decode/i.test(details))reason='The output did not pass image validation.';
  else if(/Engine\/model changed|Saved settings changed|Source changed|older Pause protocol/i.test(details))reason=details.replace(/^Error:\s*/,'').slice(0,300);
  return {image:image?path.basename(image):undefined,stage,code,reason,details:details.slice(-6000)};
}
export function significantEngineLine(line:string) {
  return /\[(two-stage|model|job|JM6)\]/i.test(line) || /\b(error|warning|failed|failure|invalid|cannot|couldn't|HRESULT|WIC|PNG|out of memory|dimensions|not found)\b/i.test(line);
}
