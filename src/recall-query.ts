// Response-control boilerplate is not the subject being retrieved. Keep this
// deliberately narrow: ordinary questions about tools, memory and evidence stay.
export function recallFocus(query: string): string {
  const focus = query.split(/(?<=[.!?])\s+|\n+/u).filter(sentence => !/^(?:if no relevant (?:memory|evidence) is (?:supplied|available),? say you lack evidence|(?:answer from|use|only) automatically supplied (?:context|memory)(?: only)?(?:; (?:do not call|no) tools,? (?:browse|browsing) or (?:save|saving) memory)?|(?:do not|don't|no)\s+(?:call\s+)?tools\b(?:[,; ]*(?:browse|browsing|or|and|save|saving|builtin|memory))*)[.!]?$/i.test(sentence.trim())).join(' ').trim();
  // Normalize an explicit scenario-location preamble, preserving the exact
  // scenario token and every substantive question. Generic 'fictional archive'
  // overlap is not evidence of kettle ownership in a different scenario. This
  // changes query focus only, never requires a literal name/code in a memory.
  return focus.replace(/\bin (?:the )?fictional ([\p{L}\p{N}_-]+) archive\s*[,：:]/giu,'$1:');
}
export function needsRecallContext(query: string): boolean {
  return /\b(it|its|she|he|they|them|their|that|this|those|these)\b/i.test(query);
}
export function asksAboutRecallProcess(query: string): boolean {
  // Default to retaining historical observations. Suppress context-only denials
  // only for direct domain fact questions, not for every query lacking special
  // process vocabulary (e.g. "What happened during yesterday's test?").
  const aboutResponse = /\b(?:answer|response|reply|conversation|limitation|limitations|abstention|denial|denials|evidence)\b|\bwhat did\b.*\b(?:say|report)|\b(?:recall|retrieval|curation|processing)\b|\bwhy\b.*\b(?:memory|evidence|context)\b/i.test(query);
  const domainQuestion = /\b(?:who|whom|whose|where|when)\b|\b(?:what|which|was|is)\b.*\b(?:color|owner|true)\b/i.test(query);
  return aboutResponse || !domainQuestion;
}
export function isContextAvailabilityNote(m: {predicate:string;object:string;supports:{role:string}[]}): boolean {
  // These are legitimate historical response observations, but cannot answer
  // the domain question whose evidence was absent at the time. Never classify
  // domain negatives ("cobalt was never true") as lack-of-context observations.
  if (!m.supports.length || !m.supports.every(s => s.role === 'assistant')) return false;
  const absence = /\b(?:lack(?:ed|s)? (?:relevant )?evidence|no relevant (?:memory|evidence)) in (?:the )?(?:automatically )?(?:supplied|available) (?:context|memory|memories)\b/i;
  const clauses = m.object.split(/\.\s+|;\s*|\b(?:but|however|and)\b/i).map(s => s.trim()).filter(Boolean);
  const contextOnly = /^(?:this (?:answer )?(?:describes|records) (?:the )?available context\b|(?:it noted )?(?:the )?supplied memor(?:y|ies) concern|does not establish\b|(?:this is )?not\b.{0,70}\b(?:facts|knowledge)\b)/i;
  // Every clause must be about context availability, not just one disclaimer
  // somewhere in a useful mixed-content note. Affirmative relationships survive.
  return clauses.some(c => absence.test(c)) && clauses.every(c => absence.test(c) || contextOnly.test(c));
}
