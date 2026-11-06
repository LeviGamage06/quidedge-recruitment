import {validateDocumentBytes} from './binary.js';
import {validEvent} from './record-utils.js';
export const maxDocumentBytes = 5 * 1024 * 1024;
export async function checkDocument(file) {
  if (!file || !file.size) throw new Error('Choose a non-empty document.');
  if (file.size > maxDocumentBytes) throw new Error('Each document must be 5 MB or smaller.');
  const ext = file.name.split('.').at(-1).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateDocumentBytes(bytes,ext);
  const pdf=ext==='pdf',doc=ext==='doc';
  return {extension:ext,mime:pdf?'application/pdf':doc?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
}
export async function uploadDocument(apiBase,candidate,fullName,file,type,requestId) {
  const metadata = await checkDocument(file);
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary='';
  for (let i=0;i<buffer.length;i+=32768) binary+=String.fromCharCode(...buffer.subarray(i,i+32768));
  let response;
  try {
    response=await fetch(apiBase+'/documents',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:requestId,candidate_id:candidate.id,name:fullName,document_type:type,
        extension:metadata.extension,data:btoa(binary)}),signal:AbortSignal.timeout(90000)});
  } catch {throw new Error('Upload interrupted. Retry with the same file. The candidate record is already saved.');}
  const result=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(result?.error || 'Document upload failed. Retry with the same file.');
  if(result?.uploaded!==true || !validEvent(result.event) || result.event.id!==requestId ||
    result.event.subject_id!==candidate.id || result.event.kind!=='activity' ||
    result.event.payload.event!=='Document stored' || result.event.payload.document_type!==type) {
    throw new Error('Drive did not confirm the saved document. Keep the file selected and retry.');
  }
  return result;
}
