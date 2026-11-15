import {test,expect} from 'bun:test';
import {Store} from '../src/store.ts';
import {Memory} from '../src/memory.ts';
import {SCHEMA_VERSION} from '../src/schema.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function supportPlans(s:Store) {
 const queries:string[]=[];const all=s.all.bind(s);
 s.all=(sql:string,...args:any[])=>{queries.push(sql);return all(sql,...args);};
 const memory=new Memory(s);
 memory.support({id:'missing'});
 memory.canonicalEntity('workspace','user:alex','entity');
 s.all=all;
 return queries.map(sql=>({sql,plan:all('EXPLAIN QUERY PLAN '+sql,...Array(sql.split('?').length-1).fill('')).map(x=>x.detail).join('\n')}));
}
test('recall support and canonical identity reverse joins never scan the retained jobs or heads',()=>{
 const s=new Store(':memory:');try{
  const plans=supportPlans(s);
  expect(plans).toHaveLength(2);
  expect(plans[0].plan).not.toMatch(/SCAN j\b/);
  expect(plans[0].plan).toContain('memory_job_event');
  expect(plans[1].plan).not.toMatch(/SCAN h\b/);
  expect(plans[1].plan).toContain('memory_head_event');
 }finally{s.close();}
});
test('opening an existing schema-2 database installs reverse lookup indexes without replacing custody',()=>{
 const directory=mkdtempSync(join(tmpdir(),'atlas-recall-index-'));const path=join(directory,'existing.sqlite');
 let s=new Store(path);try{
  const boot=s.bootstrap('Index migration');
  s.run('DROP INDEX IF EXISTS memory_job_event');s.run('DROP INDEX IF EXISTS memory_head_event');
  const before=s.all('SELECT * FROM credentials');s.close();s=new Store(path);
  expect(s.authenticate(boot.token).workspace_id).toBe(boot.workspace_id);
  expect(s.all('SELECT * FROM credentials')).toEqual(before);
  const plans=supportPlans(s);
  expect(plans[0].plan).toContain('memory_job_event');expect(plans[1].plan).toContain('memory_head_event');
 }finally{s.close();rmSync(directory,{recursive:true,force:true});}
});
test('initialized hosted fast path adds nonunique indexes without replaying schema/index/root backfills',()=>{
 const base=new Store(':memory:');try{
  base.bootstrap('Hosted index upgrade');
  base.db.exec(`CREATE TABLE atlas_runtime_meta(singleton INTEGER PRIMARY KEY,schema_version INTEGER,serving_index_version INTEGER); INSERT INTO atlas_runtime_meta VALUES(1,${SCHEMA_VERSION},1)`);
  base.run('DROP INDEX memory_job_event');base.run('DROP INDEX memory_head_event');
  const before=base.all('SELECT * FROM credentials');
  const commands:string[]=[];const original=base.db.exec.bind(base.db);
  base.db.exec=(sql:string)=>{commands.push(sql);return original(sql);};
  const hosted=new Store('initialized-hosted',base.db);
  const plans=supportPlans(hosted);
  expect(plans[0].plan).toContain('memory_job_event');expect(plans[1].plan).toContain('memory_head_event');
  expect(commands.join('\n')).not.toContain('INSERT OR IGNORE INTO memory_roots');
  expect(commands.join('\n')).not.toContain('CREATE TABLE IF NOT EXISTS memory_events');
  expect(base.all('SELECT * FROM credentials')).toEqual(before);
  expect(base.all('PRAGMA index_list(memory_jobs)').find(x=>x.name==='memory_job_event').unique).toBe(0);
  expect(base.one('SELECT serving_index_version FROM atlas_runtime_meta').serving_index_version).toBe(1);
 }finally{base.close();}
});
