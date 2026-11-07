const kinds = new Set(['job','candidate','stage','activity','summary','score']);
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function validEvent(event) {
  return Boolean(event && typeof event==='object' && Number.isSafeInteger(event.seq) && event.seq>0 &&
    typeof event.id==='string' && idPattern.test(event.id) && kinds.has(event.kind) &&
    (event.subject_id===null || typeof event.subject_id==='string' && idPattern.test(event.subject_id)) &&
    typeof event.event_date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(event.event_date) &&
    event.payload && typeof event.payload==='object' && !Array.isArray(event.payload));
}
export function validDraft(value) {
  return Boolean(value && typeof value==='object' && !Array.isArray(value) &&
    ['job','candidate','stage','activity','score','checklist','commission','summary','correction'].includes(value.kind) &&
    typeof value.id==='string' && (!value.id || idPattern.test(value.id)) &&
    typeof value.request==='string' && idPattern.test(value.request) &&
    Number.isSafeInteger(value.revision) && value.revision>=0 && value.values &&
    typeof value.values==='object' && !Array.isArray(value.values) &&
    Object.values(value.values).every(v=>typeof v==='string') &&
    (value.kind!=='score' || ['R1','R2'].includes(value.values.round)) &&
    (!value.pending || typeof value.pending==='object' && value.pending.id===value.request && kinds.has(value.pending.kind)));
}
export function foldCalendarLine(line) {
  const encoder=new TextEncoder();const lines=[];let current='',size=0;
  for(const char of line){const bytes=encoder.encode(char).length;
    if(size+bytes>75){lines.push(current);current=' ';size=1;}
    current+=char;size+=bytes;
  }
  lines.push(current);return lines.join('\r\n');
}

// One draft per form and candidate; switching tools must not block or erase work.
export function mergeDrafts(drafts,value,kind=value?.kind,id=value?.id) {
  const remaining=drafts.filter(d=>d.kind!==kind || d.id!==id);
  return value ? [...remaining,value] : remaining;
}
