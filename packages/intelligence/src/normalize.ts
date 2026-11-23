export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
export const normalizeTitle = normalizeName;

const ORG_SUFFIX = /\b(s a|sa|ltda|eireli|me|epp|inc|llc|ltd|plc|gmbh)\b/g;
export function normalizeOrgName(s: string): string {
  return normalizeName(s).replace(ORG_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}
