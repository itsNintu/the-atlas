"""Export only original fictional phase evidence; never publish copied DB or unrelated native data."""
import hashlib,json,pathlib
root=pathlib.Path('/home/alex/work/projects/the-atlas');out=root/'evidence/native-phase-repair'
originals={r['event_id'] for r in json.loads((out/'READONLY-CURRENT.json').read_text())['originals']}
labels=['baseline-ldn7','baseline-fen9','baseline-ldn7-second','corrected-fen9','corrected-ldn7','corrected-final-fen9','corrected-ldn7-chain']
traces=[]
for label in labels:
 p=root/'.private/native-phase-repair'/label/'trace.json';raw=p.read_bytes();r=json.loads(raw);calls=[]
 for c in r['calls']:
  i=c['input'];assert i['event']['event_id'] in originals
  sources=[s for s in i.get('sources',[]) if s['event_id'] in originals];keys={s['key'] for s in sources}
  candidates=[{**x,'sources':[k for k in x.get('sources',[]) if (k.get('event_id') in originals if isinstance(k,dict) else k in keys)]} for x in i.get('candidates',[]) if any(k.get('event_id') in originals if isinstance(k,dict) else k in keys for k in x.get('sources',[]))]
  calls.append({'phase':c['phase'],'input_tokens':c['input_tokens'],'parsed_input_python_json_sha256':hashlib.sha256(json.dumps(i,ensure_ascii=False,separators=(',',':')).encode()).hexdigest(),'original_only_input_view':{'event':{k:v for k,v in i['event'].items() if k not in ['metadata_excerpt','metadata_truncated']},'incoming':i.get('incoming'),'response_contract':i.get('response_contract'),'source_relations':i.get('source_relations'),'candidates':candidates,'sources':sources,'omitted_unrelated_candidate_count':len(i.get('candidates',[]))-len(candidates)},'output':c.get('output'),'usage':c.get('usage'),'transport_error':c.get('error')})
 traces.append({'label':label,'private_raw_trace_sha256':hashlib.sha256(raw).hexdigest(),'job_outcome':r.get('jobs',r.get('job')),'calls':calls,'worker_validation_errors':r['errors']})
summary={'method':'Actual unchanged native Luna bridge on private SQLite copies only. Original-only input views omit unrelated/private candidates; raw private traces retained with hash. Outputs are real provider responses, not manually corrected.','attempts':traces,'calls':sum(len(t['calls']) for t in traces),'max_product_tokens':max(c['input_tokens'] for t in traces for c in t['calls']),'failures_preserved':['baseline FEN9 invalid_identity literal candidate binding','baseline LDN7 first embed-model mismatch is fixture configuration, not product failure','intermediate corrected FEN9 invalid_reconciliation change.type superseded','initial final-replay curator_target_violation from reusing generated IDs against a different prestate; fixed harness starts from recorded real first-state DB; prior failed report retained']}
(out/'LUNA-ATTEMPTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({'calls':summary['calls'],'max_product_tokens':summary['max_product_tokens'],'labels':labels}))
