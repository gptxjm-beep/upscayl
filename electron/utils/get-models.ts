import {app} from 'electron';
import settings from 'electron-settings';
import {FEATURE_FLAGS} from '../../common/feature-flags';
import {discoverModels} from './model-discovery';
import logit from './logit';
const getModels=async(folderPath:string|undefined):Promise<string[]>=>{
 if(!folderPath)return [];
 let closeAccess:(()=>void)|undefined;
 try{
  const bookmark=await settings.get('custom-models-bookmarks');
  if(FEATURE_FLAGS.APP_STORE_BUILD&&bookmark)closeAccess=app.startAccessingSecurityScopedResource(bookmark as string) as ()=>void;
  const result=await discoverModels(folderPath);
  for(const issue of result.issues.slice(0,50))logit('Model import unavailable',issue.file,issue.reason);
  if(result.issues.length>50)logit('Additional unavailable models',String(result.issues.length-50));
  return result.models;
 }catch(error){logit('Custom model folder unavailable',String(error));return [];}
 finally{closeAccess?.();}
};
export default getModels;
