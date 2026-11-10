import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
export type OpenImageResult={ok:true;path:string;width:number;height:number}|{ok:false;code:string;error:string};
export async function inspectImage(value:unknown):Promise<OpenImageResult>{
 const reject=(code:string,error:string):OpenImageResult=>({ok:false,code,error:error.slice(0,400)});
 if(typeof value!=='string'||!value||value.includes('\0')||!path.isAbsolute(value)||(/^[a-z][a-z0-9+.-]*:/i.test(value)&&! /^[a-z]:[\\/]/i.test(value)))return reject('path','A local absolute image path is required.');
 const ext=path.extname(value).slice(1).toLowerCase(),formats:Record<string,string>={png:'png',jpg:'jpeg',jpeg:'jpeg',jfif:'jpeg',webp:'webp'};
 if(!formats[ext])return reject('format','Unsupported image extension.');
 try{
  const canonical=await fs.promises.realpath(value),stat=await fs.promises.stat(canonical);
  if(!stat.isFile())return reject('file','The dropped item is not a file.');
  await fs.promises.access(canonical,fs.constants.R_OK);
  const image=sharp(await fs.promises.readFile(canonical),{failOn:'warning',limitInputPixels:false}),info=await image.metadata();
  if(!info.width||!info.height||info.format!==formats[ext])return reject('format','Image contents do not match its supported file extension.');
  await image.stats();
  return {ok:true,path:canonical,width:info.width,height:info.height};
 }catch(error){return reject('read',String(error));}
}
