import {unzipSync,strFromU8} from 'fflate';
export function validateDocumentBytes(bytes,extension) {
 if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>5*1024*1024)throw Error('Each document must be 1 byte to 5 MB.');
 if(extension==='pdf'){
  const header=new TextDecoder().decode(bytes.slice(0,16)),tail=new TextDecoder().decode(bytes.slice(-2048));
  if(!/^%PDF-\d\.\d/.test(header)||!tail.includes('%%EOF')||bytes.length<40)throw Error('This is not a complete PDF document. Export it again and retry.');return;
 }
 if(extension==='doc'){
  const magic=[208,207,17,224,161,177,26,225];const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
  if(bytes.length<1024||!magic.every((b,i)=>bytes[i]===b)||view.getUint16(28,true)!==65534||![9,12].includes(view.getUint16(30,true))||!new TextDecoder('utf-16le').decode(bytes).includes('WordDocument'))throw Error('This is not a supported Word DOC file. Export it as DOCX or PDF.');return;
 }
 if(extension!=='docx')throw Error('Use PDF, DOC or DOCX.');
 let count=0,total=0,macro=false,files;
 try{files=unzipSync(bytes,{filter:file=>{
  if(++count>2048||(total+=file.originalSize)>32*1024*1024||file.originalSize>16*1024*1024)throw Error('Oversized archive');
  if(/vbaproject|activex|\.\.\//i.test(file.name))macro=true;
  return ['[Content_Types].xml','word/document.xml','_rels/.rels'].includes(file.name);
 }});}catch{throw Error('The DOCX archive is damaged or too large when expanded.');}
 if(macro||!files['[Content_Types].xml']||!files['word/document.xml']||!files['_rels/.rels']||
 !strFromU8(files['[Content_Types].xml']).includes('wordprocessingml.document.main+xml')||
 !/wordprocessingml\/2006\/main|ooxml.org\/wordprocessingml\/main/.test(strFromU8(files['word/document.xml'])))throw Error('The file is not a standard DOCX document. Export it again as DOCX or PDF.');
}
