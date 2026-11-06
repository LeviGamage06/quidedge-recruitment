function roleView() {
  const r=hiringRole,job=state.jobs.find(j=>j.id===r.id),active=Boolean(job);
  if(job?.description)return heading(job.title,job.status,tag(job.status,job.status==='Open'?'good':''))+panel('Full job description','<div class="snapshot">'+e(job.description)+'</div>')+panel('Approved compensation reference','<p>'+e(r.compensation)+'</p><p>'+e(r.boundary)+'</p>');
  return heading(job?.title||r.title,'QuidEdge · Client Services · '+(job?.status||'Not added'),active?tag('Position added','good'):btn('Add this hiring position','activate-role','',true))+
    panel('Commission-only opportunity','<p class="commission-lead">No fixed salary</p><p>'+e(r.compensation)+'</p><p>'+e(r.important)+'</p><div class="commission-grid">'+r.tiers.map(([rate,range])=>'<div><strong>'+e(rate)+'</strong><span>'+e(range)+'</span></div>').join('')+'</div><p>'+e(r.payment)+'</p><p class="hint">'+e(r.boundary)+'</p>')+
    (job?panel('Saved role requirements','<p>'+e(job.brief||'')+'</p>'):'')+panel('Role details',table(['Company','Location','Engagement','Industry'],[[e(r.company),e(r.location),e(r.employment),e(r.industry)]]))+
    '<div class="split">'+panel('About QuidEdge',r.about.map(p=>'<p>'+e(p)+'</p>').join(''))+panel('About the role',r.overview.map(p=>'<p>'+e(p)+'</p>').join(''))+'</div>'+
    panel('Key responsibilities','<ol class="role-list">'+r.responsibilities.map(p=>'<li>'+e(p)+'</li>').join('')+'</ol>')+
    panel('Why join QuidEdge?','<div class="benefit-grid">'+r.benefits.map(([title,text])=>'<article><h3>'+e(title)+'</h3><p>'+e(text)+'</p></article>').join('')+'</div>');
}
async function activateRole() {
  if(saving)return; saving=true;
  try {const saved=await append(defaultRoleRecord(dateSL()));ingest([saved]);render();flash('Client Acquisition & Client Relations position added.');}
  catch(err){flash(err.message);}finally{saving=false;}
}
function cooView() {
  queueMicrotask(()=>loadMaintenanceStatus());
  const relatedJobs=state.jobs.filter(j=>j.profile==='client-acquisition-v1'||j.id===hiringRole.id);
  const ids=new Set(relatedJobs.map(j=>j.id));
  const candidates=state.candidates.filter(c=>ids.has(c.job_id));
  const active=candidates.filter(c=>!closed.includes(c.stage));
  const due=active.filter(c=>c.due && c.due<=dateSL()).sort((a,b)=>a.due.localeCompare(b.due));
  const documents=active.filter(c=>c.documents?.cv!=='Available'||c.documents?.cover!=='Available');
  const terms=active.filter(c=>c.commission_ack!=='Accepted');
  const review=active.filter(c=>['R1 Review','R2 Review','Reference Check','Offer / Agreement'].includes(c.stage));
  const stats=[['Active candidates',active.length],['Due / overdue',due.length],['Documents incomplete',documents.length],['Terms to confirm',terms.length]];
  const summaries=events.filter(x=>x.kind==='summary'&&x.event_date===dateSL());
  return heading('COO recruitment workspace','Client Acquisition & Client Relations · Daily priorities and review queue',
    '<div class="toolbar">'+btn('Role & commission terms','role-view')+btn('+ Add candidate','candidate','',true)+'</div>')+
    '<div class="coo-stats">'+stats.map(([title,total])=>'<div class="panel"><span>'+e(title)+'</span><strong>'+total+'</strong></div>').join('')+'</div>'+
    panel('Today’s next actions',candidateTable(due))+
    '<div class="split">'+panel('Ready for COO review',candidateTable(review))+panel('Commission acknowledgement',candidateTable(terms))+'</div>'+
    panel('CV & cover letter checklist',documents.length?table(['Candidate','CV','Cover letter','Action'],documents.map(c=>[
      '<strong>'+e(c.alias)+'</strong>',tag(c.documents?.cv||'Missing',c.documents?.cv==='Available'?'good':'warn'),
      tag(c.documents?.cover||'Missing',c.documents?.cover==='Available'?'good':'warn'),btn('Upload / view documents','documents',c.id,true)
    ])):empty(active.length?'All active candidates have both application documents.':'No candidates added yet. Upload status will appear here.'))+
    panel('Daily COO handover',summaries.length?'<p>'+e(summaries.at(-1).payload.progress)+'</p><p><strong>Blockers / decisions:</strong> '+e(summaries.at(-1).payload.blockers||'None recorded')+'</p><p><strong>Next priorities:</strong> '+e(summaries.at(-1).payload.priorities)+'</p>':empty('Add today’s progress, blockers and next priorities.'),btn('+ Daily summary','summary','',true))+
    panel('Storage maintenance','<p id="maintenance-state">Checking recovery and backup status…</p>')+panel('Private application files','<p>Candidate names, CVs and cover letters belong in the restricted recruitment Drive folder. This public workspace displays candidate codes and upload status.</p><a class="btn" target="_blank" rel="noopener noreferrer" href="https://drive.google.com/drive/folders/'+driveRoot+'">Open recruitment Drive folder</a>');
}
function showDocuments(candidate) {
  if(!candidate)return;
  const job=state.jobs.find(j=>j.id===candidate.job_id);
  if(job?.profile!=='client-acquisition-v1'){flash('Use the Client Acquisition & Client Relations position for this upload workflow.');return;}
  const stateMarkup='<div class="statline">'+tag('CV: '+(candidate.documents?.cv||'Missing'))+tag('Cover letter: '+(candidate.documents?.cover||'Missing'))+'</div>';
  show('<div class="section-top"><h2 id="dialog-title">Application documents · '+e(candidate.alias)+'</h2>'+btn('Close','close')+'</div>'+stateMarkup+
    '<p class="public-note">The full name and document contents go to Google Drive. They are not saved to the public candidate record or browser draft.</p>'+
    '<p class="hint">Search results are not an exact folder link. Check the complete candidate code before opening files.</p><p id="drive-connection" class="hint" role="status">Checking Google Drive connection…</p>'+
    '<form id="document-entry" data-candidate="'+e(candidate.id)+'"><div class="form-grid">'+
    field('private_name','Candidate’s full name (private)',{required:true,max:120,wide:true})+
    '<label class="field">CV<input type="file" name="cv" accept=".pdf,.doc,.docx"></label><label class="field">Cover letter<input type="file" name="cover" accept=".pdf,.doc,.docx"></label></div>'+
    '<p class="hint">PDF, DOC or DOCX · up to 5 MB per file. New versions are preserved; identical retries reuse the existing file.</p>'+
    '<button class="btn" type="button" data-action="verify-documents" data-id="'+e(candidate.id)+'">Verify current file availability</button><p id="upload-progress" role="status"></p><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit" disabled>Upload to Google Drive</button></div></form>'+
    '<p><a class="btn" href="'+e(privateFolderSearch(candidate.alias))+'" target="_blank" rel="noopener noreferrer">Search private Drive by candidate code</a></p>');
  const form=dialog.querySelector('#document-entry');
  form.dataset.cvRequest=newId();form.dataset.coverRequest=newId();
  fetch(apiBase+'/integrations?candidate_id='+encodeURIComponent(candidate.id),{cache:'no-store',signal:AbortSignal.timeout(20000)}).then(async response=>{
    if(!response.ok)throw new Error('Connection check failed.');
    const status=await response.json(); if(!form.isConnected)return;
    const text=dialog.querySelector('#drive-connection');
    text.textContent=status.drive_ready?'Private Drive destination verified. A named folder is created on first upload. Corrected names rename only that folder; original files remain preserved.':'Google Drive is not verified. Ask the owner to check authorization and the private destination folder, then reopen this dialog. Candidate records remain available.';
    form.querySelector('[type=submit]').disabled=!status.drive_ready;
  }).catch(()=>{if(form.isConnected)dialog.querySelector('#drive-connection').textContent='Could not check Drive. Close and reopen this panel to retry.';});
}
async function saveDocuments(form) {
  if(saving)return;
  const errorBox=form.querySelector('.form-error'),progress=form.querySelector('#upload-progress');errorBox.textContent='';
  const candidate=candidateById(form.dataset.candidate), name=form.elements.private_name.value.trim();
  const tasks=['cv','cover'].map(type=>({type,file:form.elements[type].files[0]})).filter(t=>t.file);
  if(name.length<2){errorBox.textContent='Enter the candidate’s full name.';return;}
  if(!tasks.length){errorBox.textContent='Choose a CV, cover letter, or both.';return;}
  try{for(const task of tasks)await checkDocument(task.file);}catch(err){errorBox.textContent=err.message;return;}
  if(saving)return;
  saving=true;const controls=dialog.querySelectorAll('button,input');for(const el of controls)el.disabled=true;
  try {
    for(const task of tasks){
      progress.textContent='Uploading '+(task.type==='cv'?'CV':'cover letter')+'…';
      const result=await uploadDocument(apiBase,candidate,name,task.file,task.type,form.dataset[task.type+'Request']);
      ingest([result.event]);form.elements[task.type].value='';form.dataset[task.type+'Request']=newId();
    }
    progress.textContent='Saved to Google Drive. Original files are preserved.';
    form.elements.private_name.value='';render();flash('Application documents saved to the candidate’s private Drive folder.');
  } catch(err){errorBox.textContent=err.message;progress.textContent='Completed files remain saved. Retry the remaining selected document.';}
  finally{saving=false;for(const el of controls)el.disabled=false;}
}

async function verifyDocuments(id,control){
 if(saving)return;control.disabled=true;
 try{const response=await fetch(apiBase+'/document-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate_id:id,id:newId()}),signal:AbortSignal.timeout(25000)});const result=await response.json();if(!response.ok)throw Error(result.error||'Verification failed.');ingest([result.event]);dialog.querySelector('#upload-progress').textContent='Checked now · CV: '+result.cv+' · Cover letter: '+result.cover+'. These are statuses at this check time.';render();}
 catch(err){flash(err.message);}finally{control.disabled=false;}
}

async function loadMaintenanceStatus(){
 const target=document.querySelector('#maintenance-state');if(!target)return;
 try{const response=await fetch(apiBase+'/maintenance',{cache:'no-store'});const status=await response.json();if(!response.ok)throw Error();if(target.isConnected)target.textContent='Last successful maintenance: '+(status.last_success?new Date(status.last_success).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})+' SL':'Not yet run')+' · Private event backup through record '+status.backup_cursor+' · Pending document confirmations: '+status.pending_receipts+'. File availability is verified separately.';}catch{if(target.isConnected)target.textContent='Maintenance status unavailable. Ask the owner to check the scheduled Worker.';}
}
