import {config} from './config.js?v=1d9777a50d5b';
import {validEvent} from './record-utils.js';

export const apiBase = config.eventsUrl.replace(/\/events$/,'');
export const connected = Boolean(config.eventsUrl);
async function request(path = '', options = {}) {
  let response;
  try {
    response = await fetch(config.eventsUrl + path, {
      cache:'no-store',signal:AbortSignal.timeout(20000),...options
    });
  } catch {
    throw new Error('Connection interrupted. Your draft is kept. Retry to confirm the same save.');
  }
  let body;
  try {body=await response.json();} catch {
    throw new Error('The server response could not be confirmed. Your draft is kept; retry the same save.');
  }
  if (!response.ok) {
    const error = new Error(body?.error || 'Storage request failed. Try again.');
    error.status = response.status;
    throw error;
  }
  if(body&&typeof body==='object')body.purgeEpoch=response.headers.get('X-Purge-Epoch')||'';
  return body;
}
export async function loadEvents(after = 0,filters = {}) {
  const events = [];
  let cursor = after;
  for (;;) {
    const batch = await request('?'+new URLSearchParams({...filters,after:String(cursor)}));
    if (!Array.isArray(batch)) throw new Error('The server returned an invalid event list.');
    events.purgeEpoch=batch.purgeEpoch||'';
    if (!batch.length) return events;
    let previous=cursor;const ids=new Set();
    if (batch.some(event => {
      if(!validEvent(event)||event.seq<=previous||ids.has(event.id))return true;
      previous=event.seq;ids.add(event.id);return false;
    })) {
      throw new Error('The event cursor is invalid. Refresh to retry.');
    }
    events.push(...batch);
    cursor = batch.at(-1).seq;
    if (batch.length < 500) return events;
  }
}
export async function append(event) {
  const saved=await request('',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)
  });
  if(!validEvent(saved)||saved.id!==event.id||saved.kind!==event.kind||saved.subject_id!==event.subject_id) {
    throw new Error('The saved record was not confirmed. Your draft is kept; retry the same save.');
  }
  return saved;
}

// Advance only after reading the ordered server feed, never from a local save receipt.
export function createEventReader() {
 let cursor=0,started=false,epoch='';
 return async function read(){
  if(!started){
   const response=await fetch(apiBase+'/bootstrap',{cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!response.ok){const events=await loadEvents(0);cursor=events.at(-1)?.seq||0;started=true;return events;}
   const snapshot=await response.json();
   if(!Number.isSafeInteger(snapshot.cursor)||snapshot.cursor<0||!Array.isArray(snapshot.events)||snapshot.events.some(e=>!validEvent(e)||e.seq>snapshot.cursor))throw Error('Invalid recruitment snapshot. Retry sync.');
   epoch=response.headers.get('X-Purge-Epoch')||'';cursor=snapshot.cursor;started=true;return snapshot.events;
  }
  const incoming=await loadEvents(cursor);if((incoming.purgeEpoch||'')!==epoch){started=false;const all=await read();all.reset=true;return all;}if(incoming.length)cursor=incoming.at(-1).seq;return incoming;
 };
}
