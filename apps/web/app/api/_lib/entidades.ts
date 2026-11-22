// Entidades (Intelligence): empresas com evidências; pessoas só atrás da flag `intelligencePessoas`
// (J-01: parecer, controlador, processador) e só com nome, cargo e empresa (P4).
import { asc, eq, inArray } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { HttpError, json, readBody, type RouteFn } from './http';
import { CompanyCreate, CompanyPatch, PersonCreate } from './schemas';

async function company(db: Db, id: string) {
  const [c] = await db.select().from(schema.companies).where(eq(schema.companies.id, id));
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'Empresa não encontrada.');
  const ev = await db
    .select({ id: schema.companyEvidences.evidenceId })
    .from(schema.companyEvidences)
    .where(eq(schema.companyEvidences.companyId, id));
  return { ...c, evidenceIds: ev.map((e) => e.id).sort() };
}

async function assertEvidences(db: Db, ids: readonly string[]) {
  const found = await db.select({ id: schema.evidences.id }).from(schema.evidences).where(inArray(schema.evidences.id, [...ids]));
  const missing = ids.filter((i) => !found.some((f) => f.id === i));
  if (missing.length) throw new HttpError(422, 'UNKNOWN_EVIDENCE', 'Evidência inexistente.', { ids: missing });
}

export const listCompanies: RouteFn = async (_req, c) =>
  json({ data: await c.deps.db.select().from(schema.companies).orderBy(asc(schema.companies.nome)) });

export const getCompany: RouteFn = async (_req, c) => json({ data: await company(c.deps.db, c.params.id ?? '') });

export const createCompany: RouteFn = async (req, c) => {
  const { evidenceIds, ...b } = await readBody(req, CompanyCreate);
  const ids = [...new Set(evidenceIds)];
  await assertEvidences(c.deps.db, ids);
  await c.deps.db.transaction(async (tx) => {
    await tx.insert(schema.companies).values(b);
    await tx.insert(schema.companyEvidences).values(ids.map((evidenceId) => ({ companyId: b.id, evidenceId })));
  });
  return json({ data: await company(c.deps.db, b.id) }, 201);
};

export const patchCompany: RouteFn = async (req, c) => {
  const { evidenceIds, ...fields } = await readBody(req, CompanyPatch);
  const id = c.params.id ?? '';
  await company(c.deps.db, id);
  const ids = evidenceIds ? [...new Set(evidenceIds)] : null;
  if (ids) await assertEvidences(c.deps.db, ids);
  await c.deps.db.transaction(async (tx) => {
    if (Object.keys(fields).length) await tx.update(schema.companies).set(fields).where(eq(schema.companies.id, id));
    if (ids) {
      await tx.delete(schema.companyEvidences).where(eq(schema.companyEvidences.companyId, id));
      await tx.insert(schema.companyEvidences).values(ids.map((evidenceId) => ({ companyId: id, evidenceId })));
    }
  });
  return json({ data: await company(c.deps.db, id) });
};

export const deleteCompany: RouteFn = async (_req, c) => {
  const id = c.params.id ?? '';
  await company(c.deps.db, id);
  await c.deps.db.transaction(async (tx) => {
    await tx.delete(schema.companyEvidences).where(eq(schema.companyEvidences.companyId, id));
    await tx.delete(schema.companies).where(eq(schema.companies.id, id)); // FK de pessoas e vínculos barra com 409
  });
  return new Response(null, { status: 204 });
};

export const listPeople: RouteFn = async (_req, c) =>
  json({ data: await c.deps.db.select().from(schema.people).orderBy(asc(schema.people.nome)) });

export const createPerson: RouteFn = async (req, c) => {
  if (!c.deps.flags.intelligencePessoas) {
    throw new HttpError(403, 'FEATURE_DISABLED', 'Ingestão de pessoas desligada (flag intelligencePessoas; condições de J-01).');
  }
  const b = await readBody(req, PersonCreate);
  const [p] = await c.deps.db.insert(schema.people).values(b).returning();
  return json({ data: p }, 201);
};
