async function purgeHash(id){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function purgeActive(db){return db.prepare("SELECT value FROM maintenance_state WHERE key='purge_active'").first();}
async function purgeEpoch(db){return (await db.prepare("SELECT value FROM maintenance_state WHERE key='purge_epoch'").first())?.value||'';}
async function runPurge(env){
 const db=env.DB.withSession('first-primary'),row=await purgeActive(db);if(!row)return null;
 let job=JSON.parse(row.value);
 const lease=JSON.stringify({id:crypto.randomUUID(),until:Date.now()+120000});
 const runner=await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('purge_runner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(maintenance_state.value,'$.until')<? RETURNING value").bind(lease,Date.now()).first();
 if(!runner)return {state:'cleaning',id:job.id};
 try{
 // Retrying a timed-out Drive request is safe: the bridge repeats the same scoped cleanup.
 const result=await bridgeRequest(env,{action:'purge',request_id:job.id,event_ids:job.event_ids,candidate_ids:job.candidate_ids,reminder_ids:job.reminder_ids||[],head:job.head},60000);
 if(result.cleaned!==true)throw Error('Private files and backups have not confirmed deletion. Cleanup will retry.');
 job={...job,phase:'database'};await db.prepare("UPDATE maintenance_state SET value=? WHERE key='purge_active'").bind(JSON.stringify(job)).run();
 const revoked=JSON.stringify(await Promise.all(job.event_ids.map(async id=>'purged-event:'+await purgeHash(id))));
 const ids=JSON.stringify(job.event_ids),candidates=JSON.stringify(job.candidate_ids),receipt={id:job.id,state:'complete',records:job.count,events:job.event_ids.length,completed_at:new Date().toISOString()};
 await db.batch([
  db.prepare("INSERT INTO maintenance_state(key,value) SELECT value,'1' FROM json_each(?) WHERE true ON CONFLICT(key) DO NOTHING").bind(revoked),
  db.prepare('DELETE FROM document_outbox WHERE candidate_id IN (SELECT value FROM json_each(?)) OR id IN (SELECT value FROM json_each(?))').bind(candidates,ids),
  db.prepare("DELETE FROM maintenance_state WHERE key LIKE 'interview:%' AND substr(key,11) IN (SELECT value FROM json_each(?))").bind(candidates),
  db.prepare('DELETE FROM recruitment_events WHERE id IN (SELECT value FROM json_each(?))').bind(ids),
  db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('backup_cursor',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(maintenance_state.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").bind(String(job.head)),
  db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('purge_epoch',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(job.id),
  db.prepare('INSERT INTO maintenance_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('purge_receipt:'+job.id,JSON.stringify(receipt)),
  db.prepare("DELETE FROM maintenance_state WHERE key IN ('purge_active','purge_runner')")
 ]);
 return receipt;
 }catch(err){await db.prepare("DELETE FROM maintenance_state WHERE key='purge_runner' AND value=?").bind(lease).run();throw err;}
}
async function trashApi(request,env,url){
 const db=env.DB.withSession('first-primary');
 if(request.method==='GET'){
  const active=await purgeActive(db);if(active)return json({state:'cleaning',id:JSON.parse(active.value).id});
  const id=url.searchParams.get('request_id');if(id&&uuid.test(id)){const receipt=await db.prepare('SELECT value FROM maintenance_state WHERE key=?').bind('purge_receipt:'+id).first();if(receipt)return json(JSON.parse(receipt.value));}
  return json({state:'idle'});
 }
 if(request.method!=='POST')return error('Use GET or POST.',405);
 const p=await boundedJson(request,32000);if(!p||!uuid.test(p.id||'')||p.confirm!=='DELETE PERMANENTLY'||!Array.isArray(p.targets)||p.targets.length>500&&p.all!==true||p.targets.some(id=>!uuid.test(id||''))||!Number.isSafeInteger(p.expected_head))return error('Type DELETE PERMANENTLY to confirm the records currently in Trash.');
 const prior=await db.prepare('SELECT value FROM maintenance_state WHERE key=?').bind('purge_receipt:'+p.id).first();if(prior)return json(JSON.parse(prior.value));
 const active=await purgeActive(db);if(active)return json({state:'cleaning',id:JSON.parse(active.value).id},202);
 const rows=await db.prepare('SELECT * FROM recruitment_events ORDER BY seq').all(),events=rows.results.map(toEvent);let plan;
 try{plan=planPurge(events,p.all===true?events.filter(e=>!e.payload.operation&&recordStates(events).get(e.id)?.deleted).map(e=>e.id):p.targets);}catch(err){return error(err.message);}
 if(plan.event_ids.length>10000)return error('This cleanup contains too much history for one operation. Permanently delete smaller groups first.');
 if(plan.head!==p.expected_head)return error('The workspace changed. Refresh Trash and review the selection again.',409);
 if(!driveConfigured(env))return error('Private storage must be connected before permanent cleanup.',503);
 const schema=await db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='recruitment_events_purge_freeze'").first();if(!schema)return error('Permanent cleanup needs the database upgrade. No records have been removed.',503);
 const health=await bridgeRequest(env,{action:'health',purge:true});if(health.purge_ready!==true)return error('Permanent private-file deletion needs owner setup. No records have been removed.',503);
 const meetings=await db.prepare("SELECT key,value FROM maintenance_state WHERE key LIKE 'interview:%'").all();
 const reminder_ids=meetings.results.map(r=>JSON.parse(r.value)).filter(m=>plan.candidate_ids.includes(m.candidate_id)).map(m=>m.version);
 const job={...plan,reminder_ids,id:p.id,phase:'drive'};
 const lock=await db.prepare("INSERT INTO maintenance_state(key,value) SELECT 'purge_active',? WHERE COALESCE((SELECT MAX(seq) FROM recruitment_events),0)=? ON CONFLICT(key) DO NOTHING RETURNING key").bind(JSON.stringify(job),plan.head).first();
 if(!lock)return error('The workspace changed. Refresh Trash and review again.',409);
 try{return json(await runPurge(env));}catch{return json({state:'cleaning',id:p.id,message:'Cleanup is still processing. Records cannot be restored while cleanup finishes. The server will retry automatically.'},202);}
}
