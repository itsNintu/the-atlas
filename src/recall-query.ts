// Focus the retrieval representation, never the durable source or its truth.
// Only recognizable wrappers are removed: qualifiers inside claims stay intact.
export function recallFocus(query: string): string {
  const control = /^(?:if no relevant (?:memory|evidence) is (?:supplied|available),? say you lack evidence|(?:answer from|use|only) automatically supplied (?:context|memory)(?: only)?(?:, keeping fiction fictional)?(?:; (?:do not call|no) tools,? (?:browse|browsing) or (?:save|saving) memory)?|(?:do not|don't|no)\s+(?:call\s+|use\s+)?tools(?:\s+or\s+builtin memory saves|[,; ]*(?:browse|browsing|or|and|save|saving|builtin|memory))*|(?:reply|respond|answer) only\s+["“][^"”]*["”]|acknowledge only)[.!]?$/i;
  const focus = query.split(/(?<=[.!?])\s+|\n+/u)
    .flatMap(sentence => sentence.split(/;\s*(?=(?:reply|respond|answer|acknowledge) only\b)/i))
    .filter(sentence => !control.test(sentence.trim())).join(' ').trim();
  return focus
    // A scenario label is useful; generic fiction/privacy/control vocabulary
    // otherwise makes independent new conversations look like old fixtures.
    // Preserve exact labels of any shape, not just coded topics or long names.
    .replace(/\b(?:private fictional|fictional(?: private)?(?: [\p{L}_-]+)?) archive ([\p{L}\p{N}_-]+)(?: only)?,? not [^:：.!?]+(?:real business(?: truth)?)\s*[:：]\s*/giu, '$1: ')
    .replace(/\bin (?:the )?fictional ([\p{L}\p{N}_-]+) archive\s*[,：:]\s*/giu, '$1: ')
    .replace(/\bin (?:that same|the same|our|the) (?:imaginary|fictional) archive,\s*/giu, '');
}
export function needsRecallContext(query: string): boolean {
  return /\b(it|its|she|he|they|them|their|that|this|those|these)\b/i.test(query);
}
export function asksAboutRecallProcess(query: string): boolean {
  // Positive process/history intent, not a default for all declarative intake.
  // 'evidence' alone can be domain evidence (corrosion, ownership, etc.).
  const inquiry = /\?|\b(?:what|how|why|when|did|was|is|were|could|had|explain|describe|summarize|review|tell|list|show|remind)\b/i.test(query);
  const historyQuestion = inquiry &&
    (/\b(?:you|your|assistant|inability|unable|couldn't|could not|failed|context|assessment|last time)\b/i.test(query) ||
     /\b(?:yesterday|last time|last (?:test|probe|run|session)|previous(?:ly)?|earlier|past)\b/i.test(query) && /\b(?:test|probe|run|session|failure|context|assessment|attempt)\b/i.test(query));
  return historyQuestion || /\b(?:answer|response|reply|conversation|limitations?|abstention|denials?|recall|retrieval|curation|processing)\b|\bwhat did\b.*\b(?:say|report)\b|\b(?:lack(?:ed)? evidence|no relevant memory)\b|\b(?:what happened|what went wrong|summarize|review|describe|tell me about)\b.*\b(?:test|probe|run|session|failure)\b|\bwhy\b.*\b(?:memory|evidence|context)\b/i.test(query);
}
export function isContextAvailabilityNote(m: {predicate:string;object:string;supports:{role:string}[]}): boolean {
  // These are legitimate historical response observations, but cannot answer
  // the domain question whose evidence was absent at the time. Never classify
  // domain negatives ("cobalt was never true") as lack-of-context observations.
  if (!m.supports.length || !m.supports.every(s => s.role === 'assistant')) return false;
  const absence = /\b(?:lack(?:ed|s)? (?:relevant )?evidence|(?:do not|don't|did not|didn't) have (?:any )?(?:relevant )?(?:evidence|memory|memories)|no relevant (?:memory|evidence)) in (?:the )?(?:automatically )?(?:supplied|available) (?:context|memory|memories)\b/i;
  const clauses = m.object.split(/\.\s+|[:;]\s*|\b(?:but|however|and|although|though|yet|whereas|while)\b|\s+[—–]\s*/i).map(s => s.trim()).filter(Boolean);
  const contextOnly = /^(?:this (?:answer )?(?:describes|records) (?:the )?available context\b|(?:it noted )?(?:the )?supplied memor(?:y|ies) concern|does not establish\b|(?:this is )?not\b.{0,70}\b(?:facts|knowledge)\b)/i;
  // Every clause must be about context availability, not just one disclaimer
  // somewhere in a useful mixed-content note. Affirmative relationships survive.
  // An absence phrase is insufficient if the same clause also carries an
  // independent assertion. Ambiguous comma/causal continuations stay eligible;
  // comma-or lists in a denial (owner, or true color) are still context-only.
  const availabilityClause = (c:string) => absence.test(c) &&
    !/[()\[\]]|,(?!\s*(?:or|not)\b)|\b(?:because|since)\b/i.test(c);
  return clauses.some(c => absence.test(c)) && clauses.every(c => availabilityClause(c) || contextOnly.test(c));
}
