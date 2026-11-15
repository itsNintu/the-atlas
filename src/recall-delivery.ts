// Opt-in wire projection only: selection, source checks and the post-await fence
// always operate on full evidence. Keep feedback IDs and source/time custody;
// excerpts/triples remain available through the ordinary authenticated full API.
export function nativeMemory(m:any):any {
  const {id,scope,version,valid_from,valid_to,recorded_from,historical,historical_start_unknown,conflict,evidence_roots}=m;
  return {id,scope,version,valid_from,valid_to,recorded_from,
    ...(historical!==undefined?{historical}:{}),...(historical_start_unknown!==undefined?{historical_start_unknown}:{}),conflict,evidence_roots,
    supports:(m.supports??[]).map(({client_id,event_id,revision,role,author_id,occurred_at}:any)=>({client_id,event_id,revision,role,author_id,occurred_at})),
    corrections:(m.corrections??[]).map(({change_id,target_id,type,meaning,effective_at,recorded_at,source}:any)=>({change_id,target_id,type,meaning,effective_at,recorded_at,source})),
  };
}
