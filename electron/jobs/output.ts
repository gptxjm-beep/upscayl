import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
export async function validateOutput(file:string,width:number,height:number,format:string){
 const bytes=await fs.promises.readFile(file); // close file before libvips; prevents Windows JPEG mappings
 const image=sharp(bytes,{failOn:'warning',limitInputPixels:false});const info=await image.metadata();
 if(info.width!==width||info.height!==height||info.format!==({jpg:'jpeg',jpeg:'jpeg',png:'png',webp:'webp'}[format]))throw Error('Output dimensions or format do not match the requested image.');
 await image.stats();
}
export function temporaryOutput(final:string){return path.join(path.dirname(final),'.upscayl-output-'+crypto.randomUUID()+path.extname(final));}
export function adoptOutput(temporary:string,final:string,overwrite=false){
 if(path.dirname(temporary)!==path.dirname(final)||!path.basename(temporary).startsWith('.upscayl-output-'))throw Error('Unsafe temporary output path.');
 const fd=fs.openSync(temporary,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(overwrite)fs.renameSync(temporary,final);
 else{fs.linkSync(temporary,final);fs.unlinkSync(temporary);}
 try{const dir=fs.openSync(path.dirname(final),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}catch{}
}
