import path from 'path';
import { fileURLToPath } from 'url';
// Native picker / webUtils paths are already filesystem paths. A literal '%' or
// '%20' in a filename must never be decoded as a second URI layer.
export default function decodePath(filePath:string):string {
 return path.normalize(filePath.startsWith('file:')?fileURLToPath(filePath):filePath);
}
