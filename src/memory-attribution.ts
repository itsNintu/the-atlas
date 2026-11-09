import type { Decision } from './inference.ts';

const norm = (value: unknown) => String(value ?? '').normalize('NFKC').trim();
// Native display labels occasionally concatenate an owner name and platform ID.
// Require at least six digits so ordinary names/year suffixes are not rewritten.
export function gluedOwnerDisplayLabel(label: unknown) {
  const value = norm(label);
  return /^alex(?:\d{6,}|\s*[\[(<#:]\s*\d{6,}\s*[\])>]?)$/i.test(value);
}

function sourceMetadata(event: any) {
  const raw = event?.metadata ?? event?.metadata_json;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return {};
  try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export function ownerAttributedEvent(event: any) {
  if (!event) return false;
  const author = String(event.author_id ?? '').toLowerCase();
  if (event.role === 'user' && (author === 'alex' || author.endsWith('/alex'))) return true;
  const content = String(event.content ?? '');
  // Discord display-prefix form, distinct from the automatic [Alex] notice form.
  if (event.role === 'user' && /^\s*\[Alex\d{6,}\]/i.test(content)) return true;
  // An inter-agent task may quote an explicitly attributed owner directive. The
  // directive marker and glued display identity must share one bounded line;
  // arbitrary task discussion or fictional namesakes are not owner proof.
  if (event.role === 'inter_agent') {
    const metadata = sourceMetadata(event);
    const nativeSource = String(metadata.native_source ?? '');
    return (/(?:^|\n)[^\n]{0,240}\bOWNER\b[^\n]{0,240}\bAlex\d{6,}\b/i.test(content) ||
      /(?:^|\n)\s*Owner (?:direction|request|requirement|instruction)\s*:\s*Alex\b/i.test(content)) &&
      (!nativeSource || ['kanban', 'discord'].includes(nativeSource));
  }
  return false;
}

function aliasWithOwner(aliases: Decision['entity_aliases'], original: string) {
  const result = (aliases ?? []).map((entry) => ({
    canonical: gluedOwnerDisplayLabel(entry.canonical) ? 'Alex' : entry.canonical,
    aliases: [...new Set([...entry.aliases, ...(gluedOwnerDisplayLabel(entry.canonical) ? [entry.canonical] : [])])],
  }));
  if (original !== 'Alex') {
    const existing = result.find((entry) => entry.canonical === 'Alex');
    if (existing) existing.aliases = [...new Set([...existing.aliases, original, 'Alex'])];
    else result.push({ canonical: 'Alex', aliases: [original, 'Alex'] });
  }
  return result;
}

/** Final deterministic attribution fence after model identity resolution. */
export function canonicalOwnerDecision<T extends Decision>(decision: T, event: any): T {
  if (!ownerAttributedEvent(event)) return decision;
  let changed = false;
  let subject = decision.subject;
  let object = decision.object;
  if (gluedOwnerDisplayLabel(subject)) { subject = 'Alex'; changed = true; }
  if (decision.object_entity && gluedOwnerDisplayLabel(object)) { object = 'Alex'; changed = true; }
  const aliases = aliasWithOwner(decision.entity_aliases, changed ? String(decision.subject) : 'Alex');
  if (JSON.stringify(aliases) !== JSON.stringify(decision.entity_aliases ?? [])) changed = true;
  return changed ? { ...decision, subject, object, entity_aliases: aliases } : decision;
}

export function canonicalOwnerBinding(label: string, event: any) {
  return ownerAttributedEvent(event) && gluedOwnerDisplayLabel(label) ? 'Alex' : label;
}
