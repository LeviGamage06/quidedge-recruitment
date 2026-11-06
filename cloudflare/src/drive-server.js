// Private document payloads are forwarded only to the owner's Google deployment.
// Do not log request bodies, candidate names, document bytes or credentials.
const validDriveEndpoint = value => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value || '');
const driveConfigured = env => validDriveEndpoint(env.DRIVE_WEB_APP_URL) && typeof env.DRIVE_WEB_APP_SECRET==='string' && env.DRIVE_WEB_APP_SECRET.length>=32;
async function boundedJson(request,limit) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return null;
  const reader=request.body?.getReader(); if (!reader) return null;
  const chunks=[]; let size=0;
  for (;;) {const {done,value}=await reader.read(); if(done)break; size+=value.byteLength;
    if(size>limit){await reader.cancel();return null;} chunks.push(value);}
  try{return JSON.parse(await new Blob(chunks).text());}catch{return null;}
}
async function driveHealth(env,candidateId) {
  if(!driveConfigured(env))return json({drive_ready:false,configured:false});
  try {
    const response=await fetch(env.DRIVE_WEB_APP_URL,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'health',candidate_id:candidateId||undefined,secret:env.DRIVE_WEB_APP_SECRET}),redirect:'follow',signal:AbortSignal.timeout(15000)});
    const result=await response.json();
    return json({drive_ready:response.ok && result.ok===true && result.ready===true && result.protocol===3,configured:true});
  } catch {return json({drive_ready:false,configured:true});}
}
async function uploadFingerprint(input,secret) {
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify([input.candidate_id,input.document_type,input.name.trim(),input.extension,input.data])));
  return Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
}
async function documentApi(request,env) {
  if(request.method!=='POST')return error('Use POST to upload a document.',405);
  if(!driveConfigured(env))return error('Google Drive upload needs owner setup. Your candidate record is safe; no document has been uploaded.',503);
  if(!env.DB)return error('Shared storage is unavailable.',503);
  const input=await boundedJson(request,7.1*1024*1024);
  if(!input || !uuid.test(input.id||'') || !uuid.test(input.candidate_id||'') ||
    !['cv','cover'].includes(input.document_type) || !['pdf','doc','docx'].includes(input.extension) ||
    typeof input.name!=='string' || input.name.trim().length<2 || input.name.trim().length>120 ||
    /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(input.name) ||
    typeof input.data!=='string' || input.data.length>6990508 ||
    (input.data.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))) {
    return error('Enter the candidate name and choose a valid PDF, DOC or DOCX up to 5 MB.');
  }
  let raw;try {raw=atob(input.data);} catch {return error('Invalid document encoding.');}
  const fingerprint=await uploadFingerprint(input,env.DRIVE_WEB_APP_SECRET);
  if(raw.length===0 || raw.length>5*1024*1024)return error('Each document must be 1 byte to 5 MB.');
  try{validateDocumentBytes(Uint8Array.from(raw,c=>c.charCodeAt(0)),input.extension);}catch(err){return error(err.message);}
  const db=env.DB.withSession('first-primary');
  const candidate=await candidateRecord(db,input.candidate_id);
  if(!candidate)return error('Save the candidate before uploading documents.',404);
  const duplicate=await db.prepare('SELECT * FROM recruitment_events WHERE id=?').bind(input.id).first();
  if(duplicate) {
    const saved=toEvent(duplicate);
    return saved.kind==='activity' && saved.subject_id===input.candidate_id && saved.payload.event==='Document stored' && saved.payload.document_type===input.document_type && saved.payload.upload_fingerprint===fingerprint?
      json({event:saved,uploaded:true}):error('This upload request ID is already in use.',409);
  }
  const position=await jobHistory(db,candidate.job_id);
  if(!position || position.profile!=='client-acquisition-v1')return error('This upload is for the Client Acquisition & Client Relations position.');
  const payload={event:'Document stored',upload_fingerprint:fingerprint,document_type:input.document_type,note:(input.document_type==='cv'?'CV':'Cover letter')+' stored in private Drive. Verify current availability before relying on this receipt.'};
  await db.prepare('INSERT INTO document_outbox (id,candidate_id,fingerprint,document_type,event_date,payload) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
   .bind(input.id,input.candidate_id,fingerprint,input.document_type,dateSL(),JSON.stringify(payload)).run();
  const job=await db.prepare('SELECT * FROM document_outbox WHERE id=?').bind(input.id).first();
  if(job.fingerprint!==fingerprint)return error('This request belongs to a different document. Reopen the panel to create a new upload.',409);
  try {
   const result=await bridgeRequest(env,{...input,alias:candidate.alias,fingerprint},60000);
   if(result.document_type!==input.document_type)throw Error('Drive returned a mismatched document receipt.');
   const event=await finalizeDocument(db,job);return json({event,uploaded:true},201);
  }catch(err){return error(err.message+' Keep this file selected and retry. Confirmed Drive uploads are also reconciled automatically.',502);}
}
