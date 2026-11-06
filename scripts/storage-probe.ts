import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { fixture } from "../tests/helpers.ts";
import { report, repo } from "./runtime.ts";
import assert from "node:assert/strict";
const dir=mkdtempSync(join(repo,".private-storage-probe-")),path=join(dir,"probe.sqlite");
const f=await fixture(path);let reader:Store|undefined;
try {
 const source=(await f.ingest()).body;await f.worker.runOnce();reader=new Store(path);reader.db.exec("BEGIN");reader.one("SELECT * FROM revisions");
 const start=performance.now();const forgotten=await f.call("DELETE","/v1/sources/"+source.source_id,{});const forget_ms=performance.now()-start;
 assert.equal(forgotten.status,200);const while_reader=f.store.checkpoint();assert.equal(while_reader.busy,1);
 assert.equal((await f.context()).body.facts.length,0);reader.db.exec("COMMIT");reader.close();reader=undefined;
 const after_reader=f.store.checkpoint();assert.equal(after_reader.busy,0);
 const result={run_at:new Date().toISOString(),bun:Bun.version,sqlite_version:f.store.sqlite_version,journal_mode:f.store.one("PRAGMA journal_mode"),synchronous:f.store.one("PRAGMA synchronous"),secure_delete:f.store.one("PRAGMA secure_delete"),busy_timeout:f.store.one("PRAGMA busy_timeout"),long_reader:{forget_ms:+forget_ms.toFixed(3),logical_context_empty:true,checkpoint_while_reader:while_reader,checkpoint_after_reader:after_reader},integrity_check:f.store.one("PRAGMA integrity_check"),note:"Logical forgetting does not revoke a previously opened MVCC snapshot or external backup. Checkpoint is nonblocking in the API; no forensic erasure claim."};
 await report("storage.json",result);console.log(JSON.stringify(result,null,2));
}finally{reader?.close();f.store.close();rmSync(dir,{recursive:true,force:true});}
