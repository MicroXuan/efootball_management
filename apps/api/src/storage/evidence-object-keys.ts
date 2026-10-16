// Only the exact temporary prefix may receive a provider lifecycle rule.
export const EVIDENCE_TEMP_PREFIX = 'match-result-evidence-temp--';
export const EVIDENCE_RETAINED_PREFIX = 'match-result-evidence-retained--';
const EVIDENCE_KEY = /^(cloud:\/\/[^/]+\/)?match-result-evidence(?:-(temp|retained))?--([a-z0-9][a-z0-9-]{0,127}\.(?:jpg|png|webp))$/;

export function retainedEvidenceKey(key: string): string {
  const match = EVIDENCE_KEY.exec(key);
  if (!match) throw new Error('Invalid evidence object key');
  return `${match[1] ?? ''}${EVIDENCE_RETAINED_PREFIX}${match[3]}`;
}

/** Include legacy source keys so in-flight uploads from the previous release can finish. */
export function evidenceOrphanKeys(key: string): string[] {
  const match = EVIDENCE_KEY.exec(key);
  if (!match) return [key];
  const prefix = match[1] ?? '';
  return [...new Set([key, `${prefix}${EVIDENCE_TEMP_PREFIX}${match[3]}`,
    `${prefix}${EVIDENCE_RETAINED_PREFIX}${match[3]}`, `${prefix}match-result-evidence--${match[3]}`])];
}

/** Only a retained session can authorize cleanup of its former source namespaces. */
export function evidenceSourceKeys(key: string): string[] {
  const match = EVIDENCE_KEY.exec(key);
  if (match?.[2] !== 'retained') return [];
  return evidenceOrphanKeys(key).filter((candidate) => candidate !== key);
}
