import {test,expect} from 'bun:test';
import {join} from 'node:path';
const cwd=join(import.meta.dir,'..');
async function run(code:string,encoding='o200k_base'){
 const p=Bun.spawn([process.execPath,'-e',code],{cwd,env:{...process.env,THE_ATLAS_TOKEN_ENCODING:encoding},stdout:'pipe',stderr:'pipe'});
 const [out,err,exit]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
 expect({exit,err}).toEqual({exit:0,err:''});return JSON.parse(out);
}
test('Worker import defers BPE construction; first token count constructs only once',async()=>{
 const result=await run(`import {mock} from 'bun:test';let calls=0;mock.module('js-tiktoken',()=>({getEncoding:(name)=>{calls++;return {encode:s=>Array.from(s)}}}));const {memoryTokens}=await import('./src/memory.ts');const atImport=calls;const first=memoryTokens('abc'),second=memoryTokens('xy');console.log(JSON.stringify({atImport,calls,first,second}));`);
 expect(result).toEqual({atImport:0,calls:1,first:3,second:2});
});
test('Lazy tokenizer preserves exact configured BPE counts including Unicode and special-looking text',async()=>{
 for(const encoding of ['o200k_base','cl100k_base']){
  const result=await run(`import {getEncoding} from 'js-tiktoken';const {memoryTokens}=await import('./src/memory.ts');const e=getEncoding('${encoding}');const samples=['','Durable knowledge, source-linked.','Alex → knows → Nona','Tiếng Việt 日本語 🧪','<|endoftext|>'];console.log(JSON.stringify(samples.map(s=>({actual:memoryTokens(s),expected:e.encode(s,[],[]).length}))));`,encoding);
  for(const pair of result)expect(pair.actual).toBe(pair.expected);
 }
});
