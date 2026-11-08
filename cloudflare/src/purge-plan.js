import {recordStates} from './model.js';
export function planPurge(events,targets){
 const byId=new Map(events.map(e=>[e.id,e])),states=recordStates(events);
 if(!targets.length||new Set(targets).size!==targets.length)throw Error('Choose records in Trash.');
 for(const id of targets)if(!byId.has(id)||byId.get(id).payload.operation||!states.get(id)?.deleted)throw Error('Only records currently in Trash can be permanently deleted.');
 const selected=new Set(targets);
 for(const id of targets){const item=byId.get(id);if(item.kind==='job'&&!item.payload.job_id){
  for(const c of events.filter(e=>e.kind==='candidate'&&e.payload.job_id===id)){
   if(!states.get(c.id)?.deleted)throw Error('Move every candidate linked to this position to Trash before permanently deleting the position.');selected.add(c.id);
  }
 }}
 let changed=true;while(changed){changed=false;for(const e of events){
  if(selected.has(e.id))continue;
  if(selected.has(e.subject_id)||selected.has(e.payload.target_id)||selected.has(e.payload.supersedes)||e.kind==='job'&&selected.has(e.payload.job_id)) {selected.add(e.id);changed=true;}
  if(e.payload.supersedes&&selected.has(e.id)&&!selected.has(e.payload.supersedes)){selected.add(e.payload.supersedes);changed=true;}
 } // Include original versions even when a replacement was the selected entry.
 for(const e of events)if(selected.has(e.id)&&e.payload.supersedes&&!selected.has(e.payload.supersedes)){selected.add(e.payload.supersedes);changed=true;}
 }
 return {event_ids:[...selected],candidate_ids:events.filter(e=>selected.has(e.id)&&e.kind==='candidate').map(e=>e.id),count:targets.length,head:events.at(-1)?.seq||0};
}
