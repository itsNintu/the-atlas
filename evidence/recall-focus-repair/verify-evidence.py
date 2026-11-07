from pathlib import Path
import json, hashlib, re, subprocess, datetime
root=Path(__file__).resolve().parents[2]; d=Path(__file__).resolve().parent
r=json.loads((d/'READONLY-COMPARISON.json').read_text()); cs={c['case']:c for c in r['comparisons']}
native=json.loads(Path('/mnt/d/Work/Operations/hermes/atlas-native/activation/selection/OUTCOME-RECEIPT.json').read_text())
old=next(c for c in native['native'] if c['case']=='FEN9-capture')
pre=cs['FEN9-original-pre-capture']
checks={
 'exact_original_five_ids_reproduced':pre['baseline']['ids']==old['memory_ids'],
 'exact_original_context_hash_reproduced':pre['baseline']['context_sha256']==old['context_sha256'],
 'exact_original_tokens_reproduced':pre['baseline']['tokens']==old['tokens']==732,
 'corrected_pre_capture_zero':pre['corrected']['tokens']==0 and pre['corrected']['ids']==[],
 'qzx8_remains_empty':cs['QZX8-exact']['baseline']['tokens']==cs['QZX8-exact']['corrected']['tokens']==0,
 'response_history_denial_retained':'memory_82368b12-fc76-40a8-a22b-9ed7989d281e' in cs['response-history']['corrected']['ids'],
 'ves8_original_fact_retained':all('memory_d4448fb8-7e9a-4304-bb67-4f67b7205ce0' in cs[name]['corrected']['ids'] for name in ['VES8-use','VES8-paraphrase']),
 'fen9_all_original_facts_retained':all(set(['memory_612a3c05-5de4-4f3f-9659-bea3e64d0a03','memory_901e61d4-8318-485a-9520-a71f3ec4dad5','memory_af209b35-88bf-4387-99df-1e75153e98c5']).issubset(cs[name]['corrected']['ids']) for name in ['FEN9-current-intake','FEN9-current-use','FEN9-paraphrase']),
 'ldn7_current_prior_correction_reporting_review_retained':set(['memory_274595ea-c981-419c-8da9-db7c6fe13e9b','memory_b8ec8735-522f-4e9e-ab4b-bd293d821df5','memory_2d4241ab-1aea-41d4-a69e-e8e28bbd87d8','memory_5e3927a1-fc1d-4c52-bb58-30b0bb82d4de','memory_875228bc-41be-4023-856b-5f0b4352a550']).issubset(cs['LDN7-use']['corrected']['ids']),
 'zero_pending_transcript':all(c[side]['pending']==0 for c in cs.values() for side in ['baseline','corrected']),
 'case_counts_reconcile':len(cs)==len(r['comparisons'])==10 and r['receipt_writes_intercepted']==20 and r['curation_calls']==0,
}
assert all(checks.values()), checks
log=(d/'tests.log').read_text(); totals={k:int(re.search(pattern,log).group(1)) for k,pattern in [('tests',r'\n (\d+) pass'),('failed',r'\n (\d+) fail'),('assertions',r'\n (\d+) expect\(\) calls'),('files',r'Ran \d+ tests across (\d+) files')]}
assert totals['failed']==0
files=['src/recall-query.ts','tests/recall-focus-repair.test.ts']
out={'task':'t_f373a2cd','source_commit':subprocess.check_output(['git','log','-1','--format=%H','--',files[0]],cwd=root,text=True).strip(),'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_only':True,'file_sha256':{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files},'checks':checks,'verification':{'frozen_install':'pass','typecheck':'pass','full_tests':totals,'full_tests_note':'Shared working tree includes in-progress sibling curation changes. This evidence covers unchanged helper bytes, not a frozen final sibling commit.','disk_http_cli_e2e':json.loads((d/'e2e.json').read_text()),'e2e_note':'Identical existing e2e script checks; copy relocates only imports, temporary DB directory and report destination into this evidence directory to preserve shared reports.'},'readonly_evidence':{'path':'READONLY-COMPARISON.json','sha256':hashlib.sha256((d/'READONLY-COMPARISON.json').read_bytes()).hexdigest(),'baseline_engine_sha256':r['engine_sha256'],'cases':len(cs),'model':'sentence-transformers/all-MiniLM-L6-v2/384','receipt_writes_intercepted':r['receipt_writes_intercepted'],'original_packet_hash':old['context_sha256']},'remaining_concern':{'owner':'t_d7c1e270','file':'src/memory.ts','summary':'Generic requested-predicate rescue admits two unrelated LDN7 review facts on newly focused FEN9-use; helper-only packet530→776 tokens. Current useful intake/paraphrase remain530, pre-capture exact732→0.','ids':['memory_05b08881-05cc-48b4-a211-8ac0d9f22527','memory_875228bc-41be-4023-856b-5f0b4352a550'],'recommended_integration':'Limit requested-predicate rescue to independently semantically admitted facts; retain same-entity rescue, semantic aliases and lexical fallback. Owning sibling decides integration and verifies its changed engine.','claim':'Not overall acceptance, clean graph reconciliation or runtime activation.'}}
(d/'SOURCE-VERIFICATION.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'checks':checks,'tests':totals,'source_commit':out['source_commit'],'file_sha256':out['file_sha256']},indent=2))
