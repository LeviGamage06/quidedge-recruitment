#!/usr/bin/env python3
"""Verify private Drive event backups and generate SQL for a NEW recovery database.
This command never connects to or modifies a live database.
"""
import argparse, hashlib, json, re
from pathlib import Path

def restore(paths):
    rows, sequences = {}, {}
    for path in paths:
        raw=path.read_bytes()
        match=re.fullmatch(r'events-\d+-\d+-([0-9a-f]{64})\.json',path.name)
        if match and hashlib.sha256(raw).hexdigest()!=match.group(1):
            raise ValueError('Backup checksum mismatch: '+path.name)
        batch=json.loads(raw)
        if batch.get('schema')!=1 or not isinstance(batch.get('events'),list) or not batch['events']:
            raise ValueError('Invalid backup: '+path.name)
        if batch['first']!=batch['events'][0]['seq'] or batch['last']!=batch['events'][-1]['seq']:
            raise ValueError('Backup range mismatch')
        for row in batch['events']:
            if not isinstance(row.get('seq'),int) or row['seq']<1 or row.get('kind') not in {'job','candidate','stage','activity','summary','score'} or not isinstance(row.get('payload'),dict):
                raise ValueError('Invalid event')
            if row['id'] in rows and rows[row['id']]!=row: raise ValueError('Conflicting event IDs')
            if row['seq'] in sequences and sequences[row['seq']]!=row['id']: raise ValueError('Conflicting sequences')
            rows[row['id']]=row;sequences[row['seq']]=row['id']
    quote=lambda v:'NULL' if v is None else "'"+str(v).replace("'","''")+"'"
    root=Path(__file__).resolve().parents[1]
    output=(root/'migrations/0001_initial.sql').read_text()+(root/'migrations/0002_operations.sql').read_text()+(root/'migrations/0003_permanent_trash.sql').read_text()
    output+='\nBEGIN;\n'
    for row in sorted(rows.values(),key=lambda r:r['seq']):
        values=[row['seq'],row['id'],row['kind'],row['subject_id'],row['event_date'],json.dumps(row['payload'],ensure_ascii=False,separators=(',',':')),row['created_at']]
        output+='INSERT INTO recruitment_events(seq,id,kind,subject_id,event_date,payload,created_at) VALUES ('+','.join(quote(v) for v in values)+');\n'
    output+='COMMIT;\n'
    return output,len(rows)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backups',type=Path,nargs='+')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    paths=[p for item in args.backups for p in (sorted(item.glob('events-*.json')) if item.is_dir() else [item])]
    if not paths: parser.error('No event backup files found')
    sql,count=restore(paths)
    with args.output.open('x',encoding='utf8') as destination: destination.write(sql)
    print(f'Verified {count} events. Recovery SQL is for a NEW database only: {args.output}')
