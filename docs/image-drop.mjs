// Pure file-drop helpers shared by the editor and its regression tests.
const IMAGE_MIME_TYPES=new Set(['image/png','image/jpeg','image/webp']);
export function hasDraggedFiles(dataTransfer){
 if(!dataTransfer)return false;
 return Array.from(dataTransfer.items||[]).some(item=>item.kind==='file')||
  Array.from(dataTransfer.types||[]).includes('Files')||
  Boolean(dataTransfer.files?.length);
}
export function imageFilesFromDrop(dataTransfer){
 const files=Array.from(dataTransfer?.files||[]);
 if(!files.length)for(const item of Array.from(dataTransfer?.items||[])){
  if(item.kind==='file'){const file=item.getAsFile?.();if(file)files.push(file);}
 }
 if(!files.length)throw Error('Keine Bilddatei gefunden. Bitte PNG, JPG oder WebP hineinziehen.');
 if(files.length>10)throw Error('Bitte maximal 10 Bilder gleichzeitig hineinziehen.');
 if(files.some(file=>!IMAGE_MIME_TYPES.has(file?.type)))throw Error('Bitte nur PNG, JPG oder WebP hineinziehen.');
 if(files.some(file=>file.size>6_000_000))throw Error('Bild zu groß (max. 6 MB Quelldatei).');
 return files;
}
export function imageDropPoint(rect,clientX,clientY,width=350,height=195){
 if(!rect||!rect.width||!rect.height)return {x:40,y:40};
 const x=(clientX-rect.left)/rect.width*1000-width/2;
 const y=(clientY-rect.top)/rect.height*560-height/2;
 const clamp=(v,maximum)=>Math.max(0,Math.min(maximum,Math.round(v/10)*10));
 return {x:clamp(x,1000-width),y:clamp(y,560-height)};
}
