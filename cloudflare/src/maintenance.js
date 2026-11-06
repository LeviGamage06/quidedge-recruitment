async function rateLimit(request,env,path){
 const ip=request.headers.get('CF-Connecting-IP');if(!ip||!env.DB)return null;
 const category=path==='/api/documents'?'upload':path==='/api/events'?'write':'drive';
 const span=category==='upload'?600:60,limit=category==='upload'?20:category==='write'?60:30;
 const hash=await uploadFingerprint({candidate_id:'rate',document_type:category,name:ip,extension:'',data:''},env.DRIVE_WEB_APP_SECRET||'local-development-rate-limit-key');
 const bucket=category+':'+hash+':'+Math.floor(Date.now()/1000/span);
 const row=await env.DB.prepare('INSERT INTO request_buckets(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket).first();
 if(row.count>limit){const response=error('Too many requests. Please wait and retry. Your existing records are preserved.',429);response.headers.set('Retry-After',String(span));return response;}
 return null;
}
async function bridgeRequest(env,body,timeout=20000){
 if(!driveConfigured(env))throw Error('Drive is not configured.');
 const response=await fetch(env.DRIVE_WEB_APP_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,secret:env.DRIVE_WEB_APP_SECRET}),redirect:'follow',signal:AbortSignal.timeout(timeout)});
 let result;try{result=await response.json();}catch{throw Error('Drive returned an invalid response.');}
 if(!response.ok||result?.ok!==true)throw Error(result?.code==='PUBLIC_FOLDER'?'Restrict the Drive destination before uploading.':result?.code==='LOCATION_CHANGED'?'The candidate folder moved outside the recruitment destination. Restore its location before uploading.':'Drive did not confirm this operation. Check authorization and folder permissions.');
 return result;
}
async function candidateRecord(db,id){
 const rows=await db.prepare('SELECT * FROM recruitment_events WHERE id=? OR subject_id=? ORDER BY seq').bind(id,id).all();
 return project(rows.results.map(toEvent)).candidates[0];
}
async function finalizeDocument(db,job){
 await db.prepare('INSERT INTO recruitment_events (id,kind,subject_id,event_date,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(job.id,'activity',job.candidate_id,job.event_date,job.payload).run();
 const saved=await db.prepare('SELECT * FROM recruitment_events WHERE id=?').bind(job.id).first();
 if(!saved||saved.kind!=='activity'||saved.subject_id!==job.candidate_id||toEvent(saved).payload.document_type!==job.document_type||toEvent(saved).payload.upload_fingerprint!==job.fingerprint)throw Error('Receipt conflict; contact the owner.');
 await db.prepare("UPDATE document_outbox SET state='complete' WHERE id=?").bind(job.id).run();
 return toEvent(saved);
}
async function documentStatus(request,env,url){
 if(!['GET','POST'].includes(request.method))return error('Use GET or POST.',405);
 const input=request.method==='POST'?await boundedJson(request,1500):{candidate_id:url.searchParams.get('candidate_id')};
 if(!input||!uuid.test(input.candidate_id||'')||request.method==='POST'&&!uuid.test(input.id||''))return error('Choose a candidate.');
 const db=env.DB.withSession('first-primary'),candidate=await candidateRecord(db,input.candidate_id);
 if(!candidate)return error('Candidate not found.',404);
 let result;try{result=await bridgeRequest(env,{action:'status',candidate_id:candidate.id});}catch(err){return error(err.message,502);}
 if(!['Available','Missing'].includes(result.cv)||!['Available','Missing'].includes(result.cover))return error('Drive status could not be verified.',502);
 const response={cv:result.cv,cover:result.cover,checked_at:new Date().toISOString()};
 if(request.method==='POST'){
  const payload={event:'Document availability checked',cv_state:result.cv,cover_state:result.cover,note:'Private storage checked; these are statuses at the recorded check time.'};
  await db.prepare('INSERT INTO recruitment_events (id,kind,subject_id,event_date,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(input.id,'activity',candidate.id,dateSL(),JSON.stringify(payload)).run();
  const row=await db.prepare('SELECT * FROM recruitment_events WHERE id=?').bind(input.id).first();
  if(!row||row.subject_id!==candidate.id||row.kind!=='activity'||toEvent(row).payload.event!=='Document availability checked')return error('Status request ID conflict.',409);
  response.event=toEvent(row);
 }
 return json(response);
}
async function maintenance(env){
 if(!env.DB||!driveConfigured(env))return;
 const db=env.DB.withSession('first-primary');
 const scan=await db.prepare("SELECT value FROM maintenance_state WHERE key='outbox_scan_cursor'").first();
 let jobs=await db.prepare("SELECT * FROM document_outbox WHERE state='pending' AND id>? ORDER BY id LIMIT 10").bind(scan?.value||'').all();
 if(!jobs.results.length)jobs=await db.prepare("SELECT * FROM document_outbox WHERE state='pending' ORDER BY id LIMIT 10").all();
 for(const job of jobs.results){
  try{const receipt=await bridgeRequest(env,{action:'receipt',id:job.id,candidate_id:job.candidate_id,fingerprint:job.fingerprint});
   if(receipt.uploaded===true&&receipt.document_type===job.document_type)await finalizeDocument(db,job);
  }catch{console.warn('Document reconciliation will retry.');}
 }
 if(jobs.results.length)await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('outbox_scan_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(jobs.results.at(-1).id).run();
 const state=await db.prepare("SELECT value FROM maintenance_state WHERE key='backup_cursor'").first();
 const cursor=Number(state?.value||0);
 const rows=await db.prepare('SELECT * FROM recruitment_events WHERE seq>? ORDER BY seq LIMIT 500').bind(cursor).all();
 if(rows.results.length){
  const records=rows.results.map(toEvent),last=records.at(-1).seq;
  const receipt=await bridgeRequest(env,{action:'backup',first:records[0].seq,last,records},60000);
  if(receipt.saved!==true||receipt.last!==last)throw Error('Backup receipt mismatch; cursor was not advanced.');
  await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('backup_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(last)).run();
 }
 await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('last_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date().toISOString()).run();
}

async function maintenanceStatus(request,env){
 if(request.method!=='GET')return error('Use GET.',405);
 const rows=await env.DB.prepare('SELECT key,value FROM maintenance_state').all();
 const values=Object.fromEntries(rows.results.map(r=>[r.key,r.value]));
 const pending=await env.DB.prepare("SELECT COUNT(*) AS count FROM document_outbox WHERE state='pending'").first();
 return json({last_success:values.last_success||null,backup_cursor:Number(values.backup_cursor||0),pending_receipts:pending.count});
}
