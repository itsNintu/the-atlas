"""Export only affected original-fiction source evidence; raw databases/traces stay private."""
import hashlib,json,pathlib
root=pathlib.Path('/home/alex/work/projects/the-atlas');out=root/'evidence/original-truth-repair';private=root/'.private/original-truth-repair'
snapshot=json.loads((out/'READONLY-CURRENT.json').read_text());originals={r['event_id'] for r in snapshot['originals']}
attempts=[]
for label in ['exhaustive-v1','directional-v2','directional-v3','final-replay','final-integrated']:
 p=private/label/'trace.json';raw=p.read_bytes();t=json.loads(raw);calls=[]
 for c in t['calls']:
  i=c['input'];assert i['event']['event_id'] in originals
  sources=[s for s in i.get('sources',[]) if s['event_id'] in originals];keys={s['key'] for s in sources}
  candidates=[]
  for candidate in i.get('candidates',[]):
   proof=[s for s in candidate.get('sources',[]) if (s.get('event_id') in originals if isinstance(s,dict) else s in keys)]
   if proof:candidates.append({**candidate,'sources':proof})
  ids={c['id'] for c in candidates};output=c.get('output')
  if output:
   output=dict(output)
   if 'candidate_identities' in output:output['candidate_identities']=[b for b in output['candidate_identities'] if b['id'] in ids]
   if 'assessments' in output:output['assessments']=[a for a in output['assessments'] if a['id'] in ids]
   if 'items' in output:
    output['items']=[{**r,'duplicate_ids':[id for id in r.get('duplicate_ids',[]) if id in ids],'unaffected_ids':[id for id in r.get('unaffected_ids',[]) if id in ids]} for r in output['items']]
  calls.append({'phase':c['phase'],'input_tokens':c['input_tokens'],'raw_private_input_sha256':hashlib.sha256(json.dumps(i,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'original_only_input_view':{'event':{k:v for k,v in i['event'].items() if k not in ['metadata_excerpt','metadata_truncated']},'incoming':i.get('incoming'),'response_contract':i.get('response_contract'),'candidates':candidates,'sources':sources,'omitted_unrelated_candidate_count':len(i.get('candidates',[]))-len(candidates)},'scoped_real_output':output,'usage':c.get('usage'),'reused_actual_output_sha256':c.get('reused_actual_output_sha256'),'recorded_output_hashes':c.get('recorded_output_hashes'),'actual_native':c.get('actual_native',False),'error':c.get('error')})
 attempts.append({'label':label,'raw_private_trace_sha256':hashlib.sha256(raw).hexdigest(),'method':t.get('method'),'jobs':t['jobs'],'errors':t['errors'],'calls':calls,'actual_provider_calls':sum(bool(c.get('usage')) for c in t['calls']),'phase_visits':len(t['calls'])})
summary={'source_copy_not_production_acceptance':True,'private_prestate_sha256':snapshot['private_snapshot_sha256'],'method':'Exact current copied originals/candidates. Outputs scoped to original fictional evidence; unrelated inputs/assessments omitted. Raw private hashes retain custody. Final integration structurally projects real per-candidate responses across final token partitions and pins generated IDs by exact claim fingerprints; it does not change semantic values or add a product fallback.','attempts':attempts,'actual_provider_calls':sum(a['actual_provider_calls'] for a in attempts),'max_product_tokens':max(c['input_tokens'] for a in attempts for c in a['calls']),'failures_preserved':['exhaustive-v1: ambiguous duplicate plus superseded_by on same ID correctly rejected invalid_reconciliation','directional-v2: real extractor invented prior start from through-date; same-claim correction correctly rejected curator_correction_repeats_target; no committed copied facts from failed transaction','final-replay: harness assumed unchanged window partitions; added precision contract changed packing, assertions caused curation_error; corrected final-integrated harness projects existing per-candidate values by exact source/claim/ID with raw hashes; no new model calls']}
(out/'LUNA-ATTEMPTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:summary[k] for k in ['actual_provider_calls','max_product_tokens','private_prestate_sha256']}));print(json.dumps([{'label':a['label'],'calls':a['phase_visits'],'actual':a['actual_provider_calls'],'jobs':a['jobs']} for a in attempts],indent=2))
