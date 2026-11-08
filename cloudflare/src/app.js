import {validDraft,mergeDrafts,foldCalendarLine} from './record-utils.js';
import guide from './guide.js?v=1d9777a50d5b';
import {
  stages,closed,milestones,checklistItems,dateSL,groupStages,project,attention,
  escape as e,csvCell,stageProblem,newId,scorecardFor,recordStates,visibleEvents
} from './model.js?v=1d9777a50d5b';
import {hiringRole,defaultRoleRecord} from './role.js';
import {checkDocument,uploadDocument} from './documents.js';
import {append,loadEvents,createEventReader,apiBase} from './store.js?v=1d9777a50d5b';

const readUpdates=createEventReader();
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const mode = document.querySelector('#mode');
const sync = document.querySelector('#sync');
const notice = document.querySelector('#notice');
const owners = ['COO','Leadership','Candidate'];
const sources = ['Headhunting','Referral','Inbound','Other'];
const employmentTypes = ['Contract','Full-time','Part-time','Commission-based'];
const pageSize = 25;
let events = [];
let state = {jobs:[],candidates:[]};
let jobNames = new Map();
let candidateIndex = new Map();
let ready = false;
let failure = '';
let refreshing = false;
let saving = false;
let timer;
let focusReturn;
let pendingRecord = null;
let lastDay=dateSL();
let reportDate = lastDay;
let stageFilter = '';
let jobFilter = '';
let attentionFilter = '';
let ownerFilter = '';
let search = '';
let sort = 'recent';
let currentPage = 1;
let guideTrack = 'Client Acquisition & Relations';
let searchTimer;
let noticeTimer;

const page = () => ['overview','coo','role','pipeline','activity','interviews','guide','trash'].includes(location.hash.slice(1)) ?
  location.hash.slice(1) : 'overview';
const btn = (label,action,id = '',primary = false) =>
  '<button type="button" class="btn ' + (primary ? 'primary' : '') +
  '" data-action="' + e(action) + '" data-id="' + e(id) + '">' + e(label) + '</button>';
const tag = (text,type = '') => '<span class="tag ' + type + '">' + e(text) + '</span>';
const empty = text => '<p class="empty">' + e(text) + '</p>';
function options(values,selected = '') {
  return values.map(item => {
    const [value,label] = Array.isArray(item) ? item : [item,item];
    return '<option value="' + e(value) + '"' + (String(value) === String(selected) ? ' selected' : '') +
      '>' + e(label) + '</option>';
  }).join('');
}
function table(head,rows) {
  return '<div class="scroll"><table><thead><tr>' +
    head.map(h => '<th scope="col">' + e(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map((cell,i) =>
      '<td data-label="' + e(head[i]) + '">' + cell + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>';
}
const panel = (title,html,action = '') => '<section class="panel"><div class="section-top"><h2>' +
  e(title) + '</h2>' + action + '</div>' + html + '</section>';
const heading = (title,subtitle,action = '') => '<div class="intro"><div><p class="eyebrow">QuidEdge / Operations</p>' +
  '<h1>' + e(title) + '</h1><p class="sub">' + e(subtitle) + '</p></div>' + action + '</div>';
const eventLabel = event => ({
  job:event.payload.job_id ? 'Position updated' : 'Position opened',
  candidate:'Candidate sourced',stage:event.payload.stage,activity:event.payload.event,
  summary:'Daily summary',score:event.payload.round + ' scorecard'
})[event.kind];
const jobTitle = id => jobNames.get(id) || 'Position unavailable';
const candidateById = id => candidateIndex.get(id);
function storageDrafts() {
  try {
    const saved=JSON.parse(sessionStorage.getItem('qe-recruitment-draft') || 'null');
    return (Array.isArray(saved)?saved:[saved]).filter(validDraft);
  } catch { return []; }
}
function storageRead(kind,id) {
  return storageDrafts().find(d=>!kind || d.kind===kind && d.id===id) || null;
}
function storageWrite(value,kind,id) {
  try {
    const drafts=mergeDrafts(storageDrafts(),value,kind,id);
    if(drafts.length)sessionStorage.setItem('qe-recruitment-draft',JSON.stringify(drafts));
    else sessionStorage.removeItem('qe-recruitment-draft');
  } catch {flash('Browser draft storage is unavailable. Keep this tab open until the server confirms your save.');}
}
function ingest(incoming) {
  if (!incoming.length) return false;
  const known = new Set(events.map(event => event.id));
  const fresh = incoming.filter(event => !known.has(event.id));
  if (!fresh.length) return false;
  events = events.concat(fresh).sort((a,b) => a.seq - b.seq);
  state = project(events);
  state.jobs=state.jobs.filter(j=>!j.deleted);state.candidates=state.candidates.filter(c=>!c.deleted);
  jobNames = new Map(project(events).jobs.map(job => [job.id,job.title]));
  candidateIndex = new Map(state.candidates.map(candidate => [candidate.id,candidate]));
  return true;
}
function candidateTable(candidates,action='stage',label='Update') {
  if(candidates.length>25)return candidateTable(candidates.slice(0,25),action,label)+'<p class="hint">Showing 25 of '+candidates.length+' candidates. Use Pipeline for all records and filters.</p>';
  if (!candidates.length) return empty('No candidates in this view. Add a candidate or adjust the filters.');
  return table(['Candidate','Position','Stage','Next action','Attention','Actions'],candidates.map(candidate => {
    const flag = attention(candidate);
    return [
      '<strong>' + e(candidate.alias) + '</strong><small>' + e(candidate.source) + '</small><small>CV (last receipt/check): '+e(candidate.documents?.cv||'Missing')+' · Cover letter: '+e(candidate.documents?.cover||'Missing')+'</small>',
      e(jobTitle(candidate.job_id)),
      tag(candidate.stage,candidate.stage === 'Hired' ? 'good' : 'blue'),
      e(candidate.action || 'Set the next step') + '<small>' + e(candidate.due || 'No due date') +
        ' · ' + e(candidate.owner || 'No owner') + '</small>',
      tag(flag,['Overdue','Needs decision','Missing next step'].includes(flag) ? 'warn' : ''),
      '<div class="row-actions">' + btn('View record','view',candidate.id) +
        btn(label,action,candidate.id,true) + btn('Delete','delete-record',candidate.id) + '</div>'
    ];
  }));
}
function overview() {
  const candidates = state.candidates;
  const openJobs = state.jobs.filter(job => job.status === 'Open');
  const metrics = groupStages.map(([label,values,tone]) => {
    const count = candidates.filter(candidate => values.includes(candidate.stage)).length;
    return '<button class="metric" type="button" data-action="group" data-id="' + e(label) +
      '" style="--tone:var(--' + tone + ')"><span class="metric-label">' + e(label) +
      '</span><strong>' + count + '</strong><span class="metric-caption">View candidates</span></button>';
  }).join('');
  const active = candidates.filter(candidate => !closed.includes(candidate.stage));
  const queue = active.filter(candidate => attention(candidate) !== 'On track').sort((a,b) =>
    (a.due || '9999').localeCompare(b.due || '9999'));
  const jobRows = state.jobs.map(job => [
    '<strong>' + e(job.title) + '</strong><small>' + e(job.employment || 'Terms to confirm') + '</small>',
    e(job.department) + '<small>' + e(job.location) + '</small>',
    String(candidates.filter(candidate => candidate.job_id === job.id && candidate.stage === 'Hired').length) +
      ' / ' + e(job.headcount || '1') + ' hired',
    e(job.target_date || 'To confirm'),
    tag(job.status,job.status === 'Open' ? 'good' : ''),
    '<div class="row-actions">'+btn('Manage','job',job.id)+btn('Delete','delete-record',job.id)+ (job.profile==='client-acquisition-v1'?btn('Full job description','job',job.id):'')+'</div>'
  ]);
  return heading('Recruitment management','Keep roles, next actions and hiring decisions moving.',
    '<div class="toolbar">' + btn('Trash / restore','trash-view') + btn('Export records','export') + btn('+ Open position','job','',true) + '</div>') +
    '<div class="metrics" aria-label="Current pipeline counts">' + metrics + '</div>' +
    panel('Hiring now',openJobs.length?'<ul>'+openJobs.map(j=>'<li>'+e(j.title)+'</li>').join('')+'</ul>':empty('There are no open positions.'),btn('View role & terms','role-view','',true)) +
    panel('Needs attention',queue.length ? candidateTable(queue.slice(0,5)) :
      empty(active.length ? 'Every active candidate has a next step scheduled.' : 'Add your first candidate to build the action queue.'),
      btn('View all actions','attention')) +
    panel('Positions',jobRows.length ? table(['Role','Department / market','Headcount','Target date','Status','Action'],jobRows) :
      empty('Open a position, define the role requirements, then add candidates.'),
      tag(openJobs.length + ' open · ' + active.length + ' active candidates')) +
    panel('Recent candidates',candidateTable(candidates.slice(0,6)),btn('+ Add candidate','candidate','',true));
}
function filteredCandidates() {
  const group = groupStages.find(([name]) => 'group:' + name === stageFilter);
  const query = search.trim().toLowerCase();
  const list = state.candidates.filter(candidate => {
    const stageMatch = !stageFilter || (group ? group[1].includes(candidate.stage) : candidate.stage === stageFilter);
    const flag = attention(candidate);
    return stageMatch && (!jobFilter || candidate.job_id === jobFilter) &&
      (!ownerFilter || candidate.owner === ownerFilter) &&
      (!attentionFilter || (attentionFilter === 'needs-action' ?
        !['On track','Closed'].includes(flag) : flag === attentionFilter)) &&
      (!query || [candidate.alias,candidate.source,candidate.owner,jobTitle(candidate.job_id)]
        .some(value => String(value || '').toLowerCase().includes(query)));
  });
  if (sort === 'due') list.sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999') || b.revision - a.revision);
  if (sort === 'code') list.sort((a,b) => a.alias.localeCompare(b.alias,undefined,{numeric:true}));
  return list;
}
function candidateResults() {
  const list = filteredCandidates();
  const pages = Math.max(1,Math.ceil(list.length / pageSize));
  currentPage = Math.min(currentPage,pages);
  const start = (currentPage - 1) * pageSize;
  return '<p class="result-count" role="status">' + list.length + ' candidates · page ' + currentPage + ' of ' + pages + '</p>' +
    (list.length?candidateTable(list.slice(start,start + pageSize)):empty(state.candidates.length?'No candidates match these filters. Clear filters to see all candidates.':'No candidates added yet.')+'<div class="toolbar">'+btn('Clear filters','reset')+btn('+ Add candidate','candidate','',true)+'</div>') +
    (pages > 1 ? '<div class="pagination">' +
      (currentPage > 1 ? btn('Previous','previous') : '') +
      (currentPage < pages ? btn('Next','next') : '') + '</div>' : '');
}
function pipeline() {
  return heading('Candidate pipeline','Filter by role, stage, owner or outstanding action.',
    '<div class="toolbar">' + btn('Export CSV','csv') + btn('+ Add candidate','candidate','',true) + '</div>') +
    panel('Candidates','<div class="filters">' +
      '<label class="field">Search<input id="search" type="search" maxlength="100" placeholder="Candidate code, role or source" value="' + e(search) + '"></label>' +
      '<label class="field">Position<select id="job-filter">' + options([['','All positions'],...state.jobs.map(job => [job.id,job.title])],jobFilter) + '</select></label>' +
      '<label class="field">Stage<select id="stage-filter">' + options([['','All stages'],...groupStages.map(([name]) => ['group:' + name,name + ' group']),...stages],stageFilter) + '</select></label>' +
      '<label class="field">Action owner<select id="owner-filter">' + options([['','All owners'],...owners],ownerFilter) + '</select></label>' +
      '<label class="field">Attention<select id="attention-filter">' + options([['','All candidates'],['needs-action','Needs action'],'Overdue','Due today','Needs decision','Missing next step','Closed'],attentionFilter) + '</select></label>' +
      '<label class="field">Sort<select id="sort-filter">' + options([['recent','Newest first'],['due','Due date'],['code','Candidate code']],sort) + '</select></label></div>' +
      '<div id="candidate-results">' + candidateResults() + '</div>',btn('Reset filters','reset'));
}
const loadedReportDates=new Set();
async function loadReport(date){if(loadedReportDates.has(date))return;loadedReportDates.add(date);try{ingest(await loadEvents(0,{date}));if(page()==='activity'&&reportDate===date)render();}catch(err){loadedReportDates.delete(date);flash(err.message);}}
function activity() {
  if(!loadedReportDates.has(reportDate))loadReport(reportDate);
  const daily = visibleEvents(events).filter(event => event.event_date === reportDate).slice().reverse();
  const summaries = daily.filter(event => event.kind === 'summary');
  const entries = daily.filter(event => event.kind !== 'summary');
  const aliases = new Map(state.candidates.map(candidate => [candidate.id,candidate.alias]));
  const metrics = ['Candidate sourced','First outreach','R1 completed','R2 completed','Offer sent','Hired'];
  return heading('Daily activity','Progress, decisions and next workday priorities in Sri Lanka time.',btn('+ Daily summary','summary','',true)) +
    panel('Daily report','<div class="statline">' + metrics.map(label => tag(label + ' · ' +
      entries.filter(event => eventLabel(event) === label).length)).join('') + '</div>',
      '<label class="field">Report date (SL)<input type="date" id="report-date" value="' + e(reportDate) + '"></label>') +
    '<div class="split">' + panel('COO updates',summaries.length ? '<ul class="timeline">' + summaries.map(event =>
      '<li><strong>Progress</strong><p>' + e(event.payload.progress) + '</p><strong>Blockers / decisions</strong><p>' +
      e(event.payload.blockers || 'None recorded') + '</p><strong>Next priorities</strong><p>' + e(event.payload.priorities) +
      '</p><time>' + e(new Date(event.created_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})) + ' SL</time>'+eventControls(event)+'</li>').join('') +
      '</ul>' : empty('No summary for this date. Add one to record the COO handover.')) +
    panel('Event log',entries.length ? '<ul class="timeline">' + entries.slice(0,100).map(event =>
      '<li><strong>' + e(eventLabel(event)) + '</strong><p>' +
      e(aliases.get(event.subject_id || event.id) || event.payload.title || '') +
      (event.payload.note ? ' · ' + e(event.payload.note) : '') + '</p>'+eventControls(event)+'</li>').join('') + '</ul>' +
      (entries.length > 100 ? '<p class="muted">Showing the latest 100 events. Export records for the complete history.</p>' : '') :
      empty('No activity recorded for this date.')) + '</div>';
}
function scheduledInterviews() {
  return state.candidates.flatMap(candidate => {
    const round = candidate.stage === 'R1 Scheduled' ? 'R1' : candidate.stage === 'R2 Scheduled' ? 'R2' : '';
    const slot = round && candidate[round.toLowerCase()];
    return slot ? [{candidate,round,slot}] : [];
  }).sort((a,b) => a.slot.localeCompare(b.slot));
}
function interviews() {
  const bookings = scheduledInterviews();
  return heading('Interview calendar','Bookings in Sri Lanka time (UTC+05:30). Add, reschedule or cancel interviews here.',btn('+ Add candidate','candidate','',true)) +
    panel('Scheduled interviews',bookings.length ? table(['Candidate','Position','Round','Sri Lanka time','Actions'],
      bookings.map(({candidate,round,slot}) => [
        '<strong>' + e(candidate.alias) + '</strong>',e(jobTitle(candidate.job_id)),tag(round,'blue'),
        e(slot.replace('T',' ')) + (slot.slice(0,10) < dateSL() ? '<small>Past date · review the candidate stage</small>' : ''),
        '<div class="row-actions">' + btn('Calendar file','calendar',candidate.id) +
          btn('Reschedule','stage',candidate.id,true)+btn('Cancel interview','cancel-interview',candidate.id) + '</div>'
      ])) : empty('No scheduled interviews. Open a candidate, choose R1 Scheduled or R2 Scheduled and set a time.')) +
    panel('Schedule an interview',state.candidates.some(c=>!closed.includes(c.stage)) ? table(['Candidate','Current stage','Actions'],state.candidates.filter(c=>!closed.includes(c.stage)).map(c=>[e(c.alias),tag(c.stage),'<div class="row-actions">'+btn('Schedule R1','schedule-r1',c.id)+btn('Schedule R2','schedule-r2',c.id)+btn('View record','view',c.id)+'</div>'])) : empty('No active candidates. Add a candidate to schedule an interview.'),btn('+ Add candidate','candidate','',true));
}
const relationsPrompts = [
  ['Opening',3,'Confirm the role, commission or payment structure, client markets and the interview plan.'],
  ['Prospect research',10,'Present six slides on one target account, their likely need, decision maker, outreach angle, follow-up plan and success measures.'],
  ['Defence',10,'Explain the account choice, the evidence behind the proposed need, what AI suggestions you rejected, and the first metric you would track.'],
  ['Client role-play',20,'Handle an unhappy client, an unrealistic promise request, a budget objection, a confidentiality request and an interruption. Agree a concrete next step.'],
  ['Team behaviours',10,'Use four questions from the existing team behaviours question bank.'],
  ['Candidate questions',5,'Discuss the role and ways of working.'],
  ['Close',2,'Confirm references, outstanding checks and the decision timeline.']
];
function guideView() {
  const original = (guideTrack==='Social media'?['R1','R2','Bank','Other']:['Bank','Other']).map(key => {
    const title = {R1:'Screening · 30 min',R2:'Technical · 60 min',Bank:'Team behaviours',Other:'Scoring and workflow'}[key];
    return '<section class="panel"><details' + (key === 'R1' ? ' open' : '') + '><summary>' + title + '</summary>' +
      guide.filter(([round]) => key === 'Other' ? !['R1','R2','Bank'].includes(round) : round === key)
        .map(([,section,minutes,prompt,note]) => '<div class="guide-item"><strong>' + e(section) +
          (minutes ? ' · ' + minutes + ' min' : '') + '</strong><p>' + e(prompt) + '</p>' +
          (note ? '<small>' + e(note) + '</small>' : '') + '</div>').join('') + '</details></section>';
  }).join('');
  return heading('Interview guide','Use consistent prompts and record observable evidence.',
    '<label class="field">Role track<select id="guide-track">' + options(['Social media','Client Acquisition & Relations'],guideTrack) + '</select></label>') +
    (guideTrack === 'Social media' ? original : panel('Client Acquisition & Relations · Screening',hiringRole.screening.map(([label,prompt])=>'<div class="guide-item"><strong>'+e(label)+'</strong><p>'+e(prompt)+'</p></div>').join(''))+panel('Client Acquisition & Relations · Round 2',
      '<p class="muted">Use the screening and team behaviours prompts below, with this role-specific technical brief.</p>' +
      relationsPrompts.map(([label,minutes,prompt]) => '<div class="guide-item"><strong>' + e(label) + ' · ' + minutes +
        ' min</strong><p>' + e(prompt) + '</p></div>').join('')) + original);
}
function render() {
  const activeId = document.activeElement?.id;
  const selection = activeId === 'search' ? [
    document.activeElement.selectionStart,document.activeElement.selectionEnd
  ] : null;
  const view = page();
  for (const link of document.querySelectorAll('#nav a')) {
    const selected = link.hash === '#' + view;
    link.classList.toggle('active',selected);
    if (selected) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
  const screens = {overview,coo:cooView,role:roleView,pipeline,activity,interviews,guide:guideView,trash:trashView};
  const drafts = storageDrafts();
  const draftBanner = drafts.map(draft => '<div class="draft-banner"><span>Unsaved ' + e(draft.kind) + ' draft available.</span>' +
    '<div class="row-actions">' + btn('Resume draft','resume',draft.kind+':'+draft.id) + btn('Discard draft','discard',draft.kind+':'+draft.id) + '</div></div>').join('');
  const alert = failure ? '<p class="banner" role="alert">' + e(failure) +
    ' Existing records remain visible. Use Refresh to retry.</p>' : '';
  app.innerHTML = alert + draftBanner + (!ready && view !== 'guide' ?
    panel('Recruitment workspace',empty(failure ? 'The shared records could not be loaded.' : 'Loading shared records…')) : screens[view]());
  const active = activeId && document.getElementById(activeId);
  if (active && app.contains(active)) {
    active.focus({preventScroll:true});
    if (selection) active.setSelectionRange(...selection);
  }
}
function field(name,label,{kind = 'text',value = '',choices = [],required = false,max = 240,wide = false} = {}) {
  const attributes = 'name="' + e(name) + '"' + (required ? ' required' : '');
  let input;
  if (kind === 'select') input = '<select ' + attributes + '>' + options(choices,value) + '</select>';
  else if (kind === 'textarea') input = '<textarea ' + attributes + ' maxlength="' + max + '">' + e(value) + '</textarea>';
  else input = '<input type="' + e(kind) + '" ' + attributes + ' value="' + e(value) + '"' +
    (kind === 'text' ? ' maxlength="' + max + '"' : '') + (kind === 'number' ? ' min="1" max="999" step="1"' : '') + '>';
  return '<label class="field' + (wide ? ' wide' : '') + '">' + e(label) +
    (required ? ' <span class="required" aria-hidden="true">*</span>' : '') + input + '</label>';
}
const select = (name,label,choices,value) => field(name,label,{kind:'select',choices,value,required:true});
const notes = (name,label,required = false,value = '') => field(name,label,{kind:'textarea',wide:true,required,max:600,value});

function show(html) {
  focusReturn = document.activeElement;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
async function showRecord(candidate) {
  const request=newId();show('<h2 id="dialog-title">Loading candidate history</h2>'+btn('Close','close'));dialog.dataset.recordRequest=request;
  try{ingest(await loadEvents(0,{subject:candidate.id}));}catch(err){if(dialog.open&&dialog.dataset.recordRequest===request)show('<h2 id="dialog-title">History unavailable</h2><p>'+e(err.message)+'</p>'+btn('Close','close'));return;}
  if(!dialog.open||dialog.dataset.recordRequest!==request)return;candidate=candidateById(candidate.id);
  const checklist = checklistItems.map(([key,label]) =>
    '<li><span>' + e(label) + '</span>' + tag(candidate.checklist[key] || 'Pending',
      candidate.checklist[key] === 'Complete' ? 'good' : '') + '</li>').join('');
  const history = candidate.history.slice().reverse().map(event => {
    const labels = {score1:'Criterion 1',score2:'Criterion 2',score3:'Criterion 3',score4:'Criterion 4'};
    const text = Object.entries(event.payload).filter(([key,value]) => value && !['job_id','upload_fingerprint'].includes(key))
      .map(([key,value]) => (labels[key] || key.replaceAll('_',' ')) + ' · ' + value).join('\n');
    return '<li><strong>' + e(eventLabel(event)) + '</strong> <time>' + e(event.event_date) +
      '</time><p class="snapshot">' + e(text) + '</p>'+eventControls(event)+'</li>';
  }).join('');
  show('<div class="section-top"><h2 id="dialog-title">' + e(candidate.alias) + '</h2>' + btn('Close','close') +
    '</div><p class="muted">' + e(jobTitle(candidate.job_id)) + ' · ' + e(candidate.stage) + '</p>' +
    '<p class="muted">Availability · ' + e(candidate.availability || 'To confirm') + ' · Notice · ' +
    e(candidate.notice || 'To confirm') + '</p><div class="toolbar">' +
    btn('Update stage / schedule','stage',candidate.id,true) + btn('Log milestone','activity',candidate.id) +
    btn('Scorecard','score',candidate.id) + btn('Hiring checklist','checklist',candidate.id) + btn('CV & cover letter','documents',candidate.id) + btn('Commission review','commission',candidate.id)+btn('Correct candidate details','correction',candidate.id) + btn('Delete candidate','delete-record',candidate.id) +
    '</div><p class="public-note">Commission-only acknowledgement: '+e(candidate.commission_ack||'Not recorded')+' · CV (last receipt/check): '+e(candidate.documents?.cv||'Missing')+' · Cover letter: '+e(candidate.documents?.cover||'Missing')+'</p><h3>Hiring readiness</h3><ul class="checklist">' + checklist +
    '</ul><h3>Record history</h3><ul class="timeline">' + history + '</ul>');
}
function openForm(kind,id = '',restored = null) {
  saveDraft();
  const existingDraft = storageRead(kind,id);
  if (!restored && existingDraft) return openForm(kind,id,existingDraft);
  const candidate = candidateById(id)||candidateById(events.find(e=>e.id===id)?.subject_id);
  const job = state.jobs.find(item => item.id === id);
  const openJobs = state.jobs.filter(item => item.status === 'Open');
  if(['stage','activity','score','checklist','correction','commission'].includes(kind)&&!candidate){show('<h2 id="dialog-title">Restore the candidate first</h2><p>This candidate is no longer in the active workspace. Restore it from Trash before continuing.</p>'+btn('Open Trash','trash-view')+btn('Close','close'));return;}
  if (kind === 'candidate' && !openJobs.length) {show('<h2 id="dialog-title">Open a position first</h2><p>A candidate must belong to an open position.</p>'+btn('Open a position','job','',true)+btn('Close','close'));return;}
  const required = {required:true};
  const next = (value = {}) => '<fieldset class="form-grid wide" id="next-fields"><legend>Next action</legend>' +
    field('action','Next step',{...required,value:value.action}) +
    field('due','Due date (SL)',{...required,kind:'date',value:value.due}) +
    select('owner','Owner',[['','Choose owner'],...owners],value.owner) +
    field('blocker','Blocker / decision needed',{value:value.blocker}) + '</fieldset>';
  let title;
  let fields;
  if(kind==='recordaction') {
    const target=events.find(event=>event.id===id);
    if(!target)return;
    const deleted=Boolean(recordStates(events).get(id)?.deleted);
    title=(deleted?'Restore':'Delete')+' · '+recordTitle(target);
    fields='<input type="hidden" name="operation" value="'+(deleted?'restore':'delete')+'"><input type="hidden" name="target_id" value="'+e(id)+'">'+notes('note',deleted?'Restoration reason':'Deletion reason',true)+'<p class="hint wide">'+(deleted?'Restoring makes this record available again.':'This moves the record to Trash. You can restore it later. Original files and audit history are preserved.')+'</p>';
  } else if (kind === 'job') {
    title = job ? 'Manage position' : 'Open a position';
    fields = field('title','Job title',{...required,value:job?.title}) +
      field('department','Department',{...required,value:job?.department || 'Client Services'}) +
      field('location','Location / market',{...required,value:job?.location || 'Sri Lanka · Remote'}) +
      select('employment','Engagement type',employmentTypes,job?.employment || 'Contract') +
      field('headcount','Target headcount',{...required,kind:'number',value:job?.headcount || '1'}) +
      field('target_date','Target hiring date',{kind:'date',value:job?.target_date}) +
      notes('brief','Role requirements / success criteria',true,job?.brief || '') +field('description','Full job description (public-safe)',{kind:'textarea',wide:true,max:12000,value:job?.description||''})+
      (job ? select('status','Position status',['Open','Paused','Closed'],job.status) + notes('note','Reason for update',true) : '');
  } else if (kind === 'candidate') {
    title = 'Add a candidate';
    fields = field('alias','Unique candidate code',{...required,max:40}) +
      select('job_id','Position',openJobs.map(item => [item.id,item.title]),openJobs[0].id) +
      select('source','Source',sources,sources[0]) +
      select('availability','Availability',['To confirm','Available now','Within 2 weeks','Within 1 month','Later'], 'To confirm') +
      field('notice','Notice period',{...required,value:'To confirm'}) + field('market','Target client markets',{value:'To confirm'}) + select('commission_plan','Commission structure',['10 / 20 / 30 recurring','Other agreed terms'],'10 / 20 / 30 recurring') + select('commission_ack','Candidate accepts commission-only terms',['Pending','Accepted','Declined'],'Pending') +notes('terms_detail','Agreed commission boundaries / exceptions (required when accepted)',false,'')+ '<p class="hint wide">Save the candidate code first, then open CV & cover letter to enter their private name and upload the application documents. Real names are kept out of the public record.</p>' + next();
  } else if (kind === 'stage' && candidate) {
    title = 'Update · ' + candidate.alias;
    fields = select('stage','Stage',stages,candidate.stage) + next(candidate) +
      field('r1','R1 interview (Sri Lanka time)',{kind:'datetime-local',value:candidate.r1}) +
      field('r2','R2 interview (Sri Lanka time)',{kind:'datetime-local',value:candidate.r2}) +
      '<div class="wide" id="start-field">' + field('start_date','Confirmed start date',{kind:'date',value:candidate.start_date}) + '</div>' +
      notes('note','Reason / decision summary',true) +
      '<div class="hint wide" id="schedule-help" role="status"></div>' +
      (candidate.commission_ack!=='Accepted'||!candidate.terms_detail ? '<div class="wide"><p class="hint">Confirm commission terms before scheduling an interview.</p>'+btn('Review commission terms','commission',candidate.id)+'</div>':'') +
      '<p class="hint wide">To cancel a booking, clear its time and select the next stage. Previous bookings stay in history. Complete the hiring checklist before marking Hired.</p>';
  } else if (kind === 'checklist' && candidate) {
    title = 'Hiring checklist · ' + candidate.alias;
    fields = checklistItems.map(([key,label]) => select(key,label,['Pending','Complete','Waived'],
      candidate.checklist[key] || 'Pending')).join('') +
      notes('note','Evidence summary / reasons for any waiver',true);
  } else if (kind === 'activity' && candidate) {
    title = 'Log milestone · ' + candidate.alias;
    fields = select('event','Milestone',milestones.filter(x=>!['Commission terms reviewed','Candidate details corrected','Document availability checked'].includes(x)),milestones[0]) + notes('note','Public progress summary',true);
  } else if (kind === 'score' && candidate) {
    title = 'Scorecard · ' + candidate.alias;
    fields = select('round','Round',['R1','R2'],'R1') +
      select('reviewer','Reviewer role',['COO','Leadership'],'COO') +
      select('recommendation','Recommendation',['Advance','Hold','Reject'],'Advance') +
      '<div class="form-grid wide" id="round-fields"></div>' + notes('note','Observable evidence',true);
  } else if(kind==='correction' && candidate){
    title='Correct candidate details · '+candidate.alias;
    fields=field('alias','Candidate code',{required:true,max:40,value:candidate.alias})+select('source','Source',sources,candidate.source)+select('availability','Availability',['To confirm','Available now','Within 2 weeks','Within 1 month','Later'],candidate.availability||'To confirm')+field('notice','Notice period',{required:true,value:candidate.notice||'To confirm'})+field('market','Target client markets',{value:candidate.market||''})+notes('note','Correction reason (original history is preserved)',true);
  } else if (kind === 'commission' && candidate) {
    title='Commission review · '+candidate.alias;
    fields=select('commission_plan','Agreed structure',['10 / 20 / 30 recurring','Other agreed terms'],candidate.commission_plan||'10 / 20 / 30 recurring')+select('commission_ack','Candidate acknowledgement',['Pending','Accepted','Declined'],candidate.commission_ack||'Pending')+notes('terms_detail','Agreed boundaries and exceptional terms (including AUD 1,000)',true,candidate.terms_detail||'')+notes('note','Terms explained / next action (public-safe)',true);
  } else if (kind === 'summary') {
    title = 'Daily COO summary';
    fields = notes('progress','Progress today',true) + notes('blockers','Blockers / leadership decisions') +
      notes('priorities','Next workday priorities',true);
  } else return;
  const revision = restored?.revision ?? (kind==='recordaction' ? Math.max(recordStates(events).get(id)?.revision||events.find(e=>e.id===id)?.seq||0,candidateById(id)?.revision||0,state.jobs.find(j=>j.id===id)?.revision||0) : candidate?.revision ?? job?.revision) ?? 0;
  show('<form id="entry" data-kind="' + e(kind) + '" data-id="' + e(id) +
    '" data-request="' + e(restored?.request || newId()) + '" data-revision="' + revision +
    '"><div class="section-top"><h2 id="dialog-title">' + e(title) + '</h2>' + btn('Close','close') +
    '</div><p class="public-note">Public workspace. Use candidate codes and public-safe notes. Fields marked * are required.</p>' +
    '<div class="form-grid">' + field('event_date','Event date (SL)',{kind:'date',required:true,
      value:kind === 'summary' ? reportDate : dateSL()}) + fields + '</div>' +
    '<p class="form-error" role="alert"></p><div class="form-actions">' + btn('Discard draft','discard') +
    '<button class="btn primary" type="submit">Save record</button></div></form>');
  pendingRecord = restored?.pending || null;
  if (kind === 'score') setRoundFields(restored?.values?.round || 'R1');
  if(restored?.values?.supersedes){const hidden=document.createElement('input');hidden.type='hidden';hidden.name='supersedes';hidden.value=restored.values.supersedes;dialog.querySelector('#entry').append(hidden);}
  if (restored?.values) {
    for (const [key,value] of Object.entries(restored.values)) {
      const input = dialog.querySelector('#entry').elements.namedItem(key);
      if (input) input.value = value;
    }
  }
  updateStageFields();
  if (pendingRecord) freezePending();
  const openedForm=dialog.querySelector('#entry');
  openedForm.dataset.baseline=JSON.stringify(draftValues(openedForm));
  openedForm.dataset.restored=restored?'1':'';
  dialog.querySelector('input,select,textarea')?.focus();
}
function setRoundFields(round) {
  const form=dialog.querySelector('#entry');
  const cache=JSON.parse(form.dataset.roundScores||'{}');
  if(form.dataset.scoreRound)cache[form.dataset.scoreRound]=Object.fromEntries([...form.querySelectorAll('#round-fields select')].map(i=>[i.name,i.value]));
  form.dataset.roundScores=JSON.stringify(cache);form.dataset.scoreRound=round;
  const job=state.jobs.find(j=>j.id===(candidateById(form.dataset.id)||candidateById(events.find(e=>e.id===form.dataset.id)?.subject_id))?.job_id);
  dialog.querySelector('#round-fields').innerHTML = scorecardFor(job)[round].map((label,i) =>
    field('score' + (i + 1),label,{kind:'select',value:cache[round]?.['score'+(i+1)]||'',choices:[['','Untested'],'1','2','3','4','5']})).join('');
}
function updateStageFields() {
  const stage = dialog.querySelector('[name="stage"]')?.value;
  if (!stage) return;
  dialog.querySelector('#next-fields').disabled = closed.includes(stage);
  const start = dialog.querySelector('#start-field');
  start.hidden = stage !== 'Hired';
  start.querySelector('input').required = stage === 'Hired';
  const scheduled=stage==='R1 Scheduled'||stage==='R2 Scheduled';
  dialog.querySelector('#schedule-help').textContent=scheduled ? 'This save books the selected interview in the calendar. All times are Sri Lanka time (UTC+05:30).' : 'Interview times are reference details until Stage is R1 Scheduled or R2 Scheduled. Choose a scheduled stage to book the calendar.';
  for (const round of ['r1','r2']) {
    dialog.querySelector('[name="' + round + '"]').required = stage === (round === 'r1' ? 'R1 Scheduled' : 'R2 Scheduled');
  }
}
function draftValues(form) {
  const result = {};
  for (const input of form.querySelectorAll('[name]')) result[input.name] = input.value;
  return result;
}
function saveDraft() {
  if(!dialog.open)return;
  const form = dialog.querySelector('#entry');
  if (!form) return;
  const values=draftValues(form);
  if(!pendingRecord && !form.dataset.restored && JSON.stringify(values)===form.dataset.baseline)return;
  storageWrite({
    kind:form.dataset.kind,id:form.dataset.id,request:form.dataset.request,
    revision:Number(form.dataset.revision),values,pending:pendingRecord
  });
}
function freezePending() {
  for (const input of dialog.querySelectorAll('input,select,textarea')) input.disabled = true;
  const submit = dialog.querySelector('[type="submit"]');
  submit.textContent = 'Retry same save';
}
function flash(text) {
  notice.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.textContent = '' },6000);
}
function download(name,content,type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
function calendar(candidate) {
  const round = candidate.stage === 'R1 Scheduled' ? 'R1' : 'R2';
  const slot = candidate[round.toLowerCase()];
  if (!slot) return;
  const start = new Date(slot + ':00+05:30');
  const end = new Date(+start + (round === 'R1' ? 30 : 60) * 60000);
  const stamp = date => date.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
  const safe = value => String(value).replaceAll('\\','\\\\').replaceAll(';','\\;').replaceAll(',','\\,').replace(/\r?\n/g,'\\n');
  const content = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//QuidEdge//Recruitment//EN','BEGIN:VEVENT',
    'UID:' + candidate.id + '-' + round + '@quidedge','DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(start),'DTEND:' + stamp(end),'SUMMARY:' + safe(candidate.alias + ' ' + round + ' interview'),
    'DESCRIPTION:' + safe(jobTitle(candidate.job_id)),'SEQUENCE:'+candidate.revision,'END:VEVENT','END:VCALENDAR',''].map(foldCalendarLine).join('\r\n');
  download(candidate.alias + '-' + round + '.ics',content,'text/calendar;charset=utf-8');
}
async function refresh() {
  if (refreshing || saving || !navigator.onLine) return;
  refreshing = true;
  sync.disabled = true;
  try {
    const incoming = await readUpdates();
    const changed = ingest(incoming);
    const hadFailure = Boolean(failure);
    failure = '';
    const initial = !ready;
    ready = true;
    mode.textContent = 'Synced · ' + new Date().toLocaleTimeString('en-LK',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Colombo'}) + ' SL';
    sync.className = 'pill live';
    const today=dateSL(),dayChanged=today!==lastDay;
    if(dayChanged){if(reportDate===lastDay)reportDate=today;lastDay=today;}
    if (changed || initial || hadFailure || dayChanged) render();
    else if(page()==='coo')loadMaintenanceStatus();
  } catch (error) {
    failure = error.message;
    mode.textContent = 'Retry sync';
    sync.className = 'pill error';
    render();
  } finally {
    refreshing = false;
    sync.disabled = false;
  }
}
function resetFilters() {
  stageFilter = '';jobFilter = '';ownerFilter = '';attentionFilter = '';search = '';currentPage = 1;
}
app.addEventListener('input',event => {
  if (event.target.id !== 'search') return;
  search = event.target.value;
  currentPage = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const result = app.querySelector('#candidate-results');
    if (result) result.innerHTML = candidateResults();
  },120);
});
app.addEventListener('change',event => {
  const value = event.target.value;
  const key = event.target.id;
  if (key === 'report-date' && value) reportDate = value;
  if (key === 'stage-filter') stageFilter = value;
  if (key === 'job-filter') jobFilter = value;
  if (key === 'attention-filter') attentionFilter = value;
  if (key === 'owner-filter') ownerFilter = value;
  if (key === 'sort-filter') sort = value;
  if (key === 'guide-track') guideTrack = value;
  currentPage = 1;
  render();
});
document.addEventListener('click',async event => {
  if (event.target.closest('.skip')) {
    event.preventDefault();
    app.focus();
    return;
  }
  const control = event.target.closest('[data-action]');
  if (!control || saving) return;
  const {action,id} = control.dataset;
  if(action==='overview-view'){location.hash='overview';render();return;}
  if(action==='trash-view'){if(dialog.open){saveDraft();dialog.close();}location.hash='trash';render();return;}
  if(action==='delete-record'||action==='restore-record'){openForm('recordaction',id);return;}
  if(action==='edit-event'){editEvent(id);return;}
  if(['schedule-r1','schedule-r2','cancel-interview'].includes(action)){
    openForm('stage',id);
    const form=dialog.querySelector('#entry');if(!form||form.dataset.kind!=='stage')return;
    if(action==='cancel-interview'){
      const round=candidateById(id).stage==='R1 Scheduled'?'r1':'r2';
      form.elements.stage.value=round==='r1'?'Replied':'R2 Prep';form.elements[round].value='';
      form.elements.note.value='Interview cancelled';
    }else {const round=action==='schedule-r1'?'R1':'R2';form.elements.stage.value=round+' Scheduled';form.elements.action.value=round+' interview';}
    updateStageFields();saveDraft();return;
  }
  if (action === 'close') { saveDraft();dialog.close();render();return }
  if (action === 'discard') {
    const form=dialog.querySelector('#entry');
    const [kind,recordId]=id ? id.split(':') : [form?.dataset.kind,form?.dataset.id];
    storageWrite(null,kind,recordId);pendingRecord = null;dialog.close();render();return;
  }
  if (action === 'resume') {
    const [kind,recordId]=id.split(':');
    const draft = storageRead(kind,recordId);
    if (draft) openForm(draft.kind,draft.id,draft);
    return;
  }
  if (action === 'group' || action === 'attention') {
    resetFilters();
    if (action === 'group') stageFilter = 'group:' + id;
    else attentionFilter = 'needs-action';
    location.hash = 'pipeline';
    render();
    return;
  }
  if (action === 'reset') { resetFilters();render();return }
  if (action === 'next' || action === 'previous') {
    currentPage += action === 'next' ? 1 : -1;
    render();
    return;
  }
  if (action === 'view') {
    const candidate = candidateById(id);
    if (candidate) showRecord(candidate);
    return;
  }
  if (action === 'role-view') {location.hash='role';render();return;}
  if (action === 'activate-role') {activateRole();return;}
  if(action==='verify-documents'){await verifyDocuments(id,control);return;}
  if (action === 'documents') {saveDraft();showDocuments(candidateById(id));return;}
  if (action === 'calendar') { calendar(candidateById(id));return }
  if (action === 'export') {
    control.disabled=true;flash('Preparing complete history export…');
    try{const all=await loadEvents(0);download('QuidEdge-records-' + dateSL() + '.json',
      JSON.stringify({exported_at:new Date().toISOString(),events:all},null,2),'application/json');}catch(err){flash(err.message);}finally{control.disabled=false;}
    return;
  }
  if (action === 'csv') {
    const rows = [['Code','Position','Stage','Owner','Next action','Due','Attention']];
    for (const candidate of filteredCandidates()) rows.push([
      candidate.alias,jobTitle(candidate.job_id),candidate.stage,candidate.owner,candidate.action,candidate.due,attention(candidate)
    ]);
    download('QuidEdge-candidates-' + dateSL() + '.csv',rows.map(row => row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
    return;
  }
  openForm(action,id);
});
dialog.addEventListener('input',event=>{
  if(event.target.form?.id==='document-entry'){
    if(event.target.name==='private_name'){event.target.form.dataset.cvRequest=newId();event.target.form.dataset.coverRequest=newId();}
    if(['cv','cover'].includes(event.target.name))event.target.form.dataset[event.target.name+'Request']=newId();
    return;
  }
  saveDraft();
});
dialog.addEventListener('change',event => {
  if (event.target.name === 'stage') updateStageFields();
  if (event.target.name === 'round') setRoundFields(event.target.value);
  saveDraft();
});
dialog.addEventListener('cancel',event => {
  if (saving) event.preventDefault();
  else saveDraft();
});
dialog.addEventListener('close',() => {
  if (!saving) render();
  if (focusReturn?.isConnected) focusReturn.focus();
});
dialog.addEventListener('submit',async event => {
  if(event.target.id==='document-entry'){event.preventDefault();saveDocuments(event.target);return;}
  if (event.target.id !== 'entry') return;
  event.preventDefault();
  if (saving) return;
  const form = event.target;
  const errorBox = form.querySelector('.form-error');
  const {kind,id} = form.dataset;
  let record = pendingRecord;
  if (!record) {
    const values = Object.fromEntries([...new FormData(form)].map(([key,value]) => [key,value.trim()]));
    const eventDate = values.event_date;
    delete values.event_date;
    if (kind === 'candidate') values.stage = 'Sourced';
    if (kind === 'job' && id) values.job_id = id;
    if(kind==='correction')values.event='Candidate details corrected';
    if (kind === 'commission') values.event='Commission terms reviewed';
    if (kind === 'checklist') values.event = 'Hiring checklist updated';
    if (kind === 'stage') {
      if (closed.includes(values.stage)) Object.assign(values,{action:'',due:'',owner:'',blocker:''});
      const problem = stageProblem(values,candidateById(id)||candidateById(events.find(e=>e.id===id)?.subject_id),eventDate);
      if (problem) { errorBox.textContent = problem;return }
    }
    record = {
      id:form.dataset.request,kind:kind==='recordaction'?'summary':['checklist','commission','correction'].includes(kind) ? 'activity' : kind,
      subject_id:['job','summary','recordaction'].includes(kind) ? null : values.supersedes ? events.find(e=>e.id===values.supersedes)?.subject_id : id || null,event_date:eventDate,payload:values
    };
    if (id || values.supersedes) record.expected_seq = Number(form.dataset.revision);
  }
  pendingRecord = record;
  saveDraft();
  saving = true;
  const controls = form.querySelectorAll('button,input,select,textarea');
  for (const input of controls) input.disabled = true;
  const submit = form.querySelector('[type="submit"]');
  submit.textContent = 'Saving…';
  errorBox.textContent = '';
  try {
    const saved = await append(record);
    ingest([saved]);
    pendingRecord = null;
    storageWrite(null,kind,id);
    if(kind==='candidate'){resetFilters();location.hash='pipeline';}
    if (kind === 'summary') reportDate = record.event_date;
    dialog.close();
    render();
    flash('Saved to the shared workspace. The original history is preserved.');
  } catch (error) {
    errorBox.textContent = error.message;
    if (error.status && error.status < 500) {
      pendingRecord = null;
      form.dataset.request = newId();
      if (error.status === 409) {
        saving = false;
        await refresh();
        if(kind==='recordaction'){form.dataset.revision=Math.max(recordStates(events).get(id)?.revision||events.find(e=>e.id===id)?.seq||0,project(events).candidates.find(c=>c.id===id)?.revision||0,project(events).jobs.find(j=>j.id===id)?.revision||0);}
        const current = candidateById(id) || candidateById(events.find(e=>e.id===id)?.subject_id) || state.jobs.find(job => job.id === id);
        if (current) {
          form.dataset.revision = current.revision;
          const changes=Object.entries(current).filter(([key,value])=>typeof value==='string'&&key in draftValues(form)).map(([key,value])=>key+': '+value).join('; ');
          const checkboxes=Object.entries(current.checklist||{}).map(([key,value])=>key+': '+value).join('; ');
          errorBox.textContent += ' Latest saved fields: '+changes+(checkboxes?'; checklist: '+checkboxes:'')+'. Your draft is unchanged. Compare these values before saving again. Latest saved status: ' + (current.stage || current.status) +
            '. Next action: ' + (current.action || 'None') + '. Review before saving again.';
        }
      }
      for (const input of controls) input.disabled = false;
      updateStageFields();
      submit.textContent = 'Save record';
      saveDraft();
    } else {
      for (const button of form.querySelectorAll('button')) button.disabled = false;
      freezePending();
      saveDraft();
    }
  } finally {
    saving = false;
  }
});
sync.addEventListener('click',refresh);
window.addEventListener('hashchange',() => { render();app.focus({preventScroll:true}) });
window.addEventListener('online',refresh);
window.addEventListener('offline',() => { mode.textContent = 'Offline · draft kept';sync.className = 'pill error' });
document.addEventListener('visibilitychange',() => { if (!document.hidden && !dialog.open) refresh() });
window.addEventListener('pagehide',() => { saveDraft();clearInterval(timer);timer=null; });
window.addEventListener('pageshow',()=>{if(!timer){startSyncTimer();refresh();}});
render();
refresh();
function startSyncTimer(){clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!dialog.open)refresh();},45000);}
startSyncTimer();

function recordTitle(event){
 const projected=project(events), candidate=projected.candidates.find(c=>c.id===(event.subject_id||event.id));
 return event.kind==='candidate'?candidate?.alias||event.payload.alias:event.kind==='job'?event.payload.title:(candidate?.alias?candidate.alias+' · ':'')+eventLabel(event);
}
function eventControls(event){
 if(event.payload.operation||['Document stored','Document availability checked'].includes(event.payload.event))return '';
 const editable=['stage','score','summary'].includes(event.kind)||event.kind==='activity'&&!['Document stored','Document availability checked'].includes(event.payload.event);
 return '<div class="row-actions">'+(editable?btn('Edit entry','edit-event',event.id):'')+btn('Delete entry','delete-record',event.id)+'</div>';
}
function trashView(){
 const states=recordStates(events),deleted=events.filter(e=>!e.payload.operation&&states.get(e.id)?.deleted);
 return heading('Trash','Restore deleted candidates, positions and entries. Original records and files are preserved.',btn('Back to overview','overview-view'))+
 panel('Deleted records',deleted.length?table(['Record','Type','Actions'],deleted.map(e=>[escapeTitle(e),e.kind,btn('Restore','restore-record',e.id,true)])):empty('Trash is empty.'));
}
function escapeTitle(event){return e(recordTitle(event));}
function editEvent(id){
 const target=events.find(e=>e.id===id);if(!target)return;
 const kind=target.kind==='activity'?({'Hiring checklist updated':'checklist','Commission terms reviewed':'commission','Candidate details corrected':'correction'}[target.payload.event]||'activity'):target.kind;
 const old=storageRead(kind,id);
 if(old){openForm(kind,id,old);return;}
 const parent=candidateById(target.subject_id);
 const revision=parent?.revision||recordStates(events).get(id)?.revision||target.seq;
 openForm(kind,id,{kind,id,request:newId(),revision,values:{...target.payload,event_date:target.event_date,supersedes:id}});
}
