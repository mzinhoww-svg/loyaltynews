"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { cx } from "../../utils";
import { EmptyState } from "../EmptyState";
import { MockBadge } from "../MockBadge";
import { Pagination } from "../Pagination";

export interface DataTableColumn<T> {
  id: string;
  header: string;
  /** Texto/número usado para ordenar, buscar e filtrar. `null` = vazio (ordena por último). */
  value: (row: T) => string | number | null;
  /** Conteúdo exibido; padrão: `value` ("—" quando nulo). */
  cell?: (row: T) => ReactNode;
  sortable?: boolean;
  /** Mostra um <select> de filtro com os valores distintos da coluna. */
  filterable?: boolean;
  align?: "start" | "end";
}

export interface DataTableProps<T> {
  /** Legenda da tabela (obrigatória): nomeia a região e a tabela para leitores de tela. */
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  /** Campo de busca por texto em todas as colunas. */
  searchable?: boolean;
  initialSort?: { columnId: string; direction: "asc" | "desc" };
  /** Texto do estado vazio quando NÃO há dados (≠ filtro sem resultado). */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Linhas simuladas: exibe o selo MOCK acima da tabela. */
  isMock?: boolean;
  className?: string;
}

type Sort = { columnId: string; direction: "asc" | "desc" } | null;

const cmp = (a: string | number | null, b: string | number | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // vazios sempre por último
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
};

/**
 * Tabela de dados do Studio: busca, filtro por coluna, ordenação (aria-sort), paginação
 * e contagem anunciada (aria-live). Em telas estreitas rola na horizontal dentro de uma
 * região focável. Sem dados = EmptyState honesto; filtros sem resultado = mensagem própria.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  pageSize = 10,
  searchable = true,
  initialSort,
  emptyTitle = "Nenhum registro",
  emptyDescription,
  isMock,
  className,
}: DataTableProps<T>) {
  const uid = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<Sort>(initialSort ?? null);
  const [page, setPage] = useState(1);

  const filterOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (!c.filterable) continue;
      const set = new Set<string>();
      for (const r of rows) {
        const v = c.value(r);
        if (v !== null) set.add(String(v));
      }
      out[c.id] = [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
    }
    return out;
  }, [columns, rows]);

  const processed = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("pt-BR");
    let list = rows.filter((r) => {
      for (const [id, want] of Object.entries(filters)) {
        if (!want) continue;
        const col = columns.find((c) => c.id === id);
        if (col && String(col.value(r) ?? "") !== want) return false;
      }
      if (!q) return true;
      return columns.some((c) => String(c.value(r) ?? "").toLocaleLowerCase("pt-BR").includes(q));
    });
    if (sort) {
      const col = columns.find((c) => c.id === sort.columnId);
      if (col) {
        const dir = sort.direction === "asc" ? 1 : -1;
        list = list
          .map((r, i) => ({ r, i }))
          .sort((x, y) => {
            const a = col.value(x.r);
            const b = col.value(y.r);
            // vazios ficam no fim em qualquer direção
            if (a === null || b === null) return cmp(a, b);
            return cmp(a, b) * dir || x.i - y.i;
          })
          .map((x) => x.r);
      }
    }
    return list;
  }, [rows, columns, query, filters, sort]);

  const total = processed.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  const slice = processed.slice((current - 1) * pageSize, current * pageSize);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const hasControls = searchable || Object.keys(filterOptions).length > 0;
  const filtering = query.trim() !== "" || Object.values(filters).some(Boolean);

  const toggleSort = (id: string) => {
    setPage(1);
    setSort((s) => (!s || s.columnId !== id ? { columnId: id, direction: "asc" } : s.direction === "asc" ? { columnId: id, direction: "desc" } : null));
  };
  const captionId = `${uid}-cap`;

  if (rows.length === 0) {
    return (
      <div className={className}>
        {isMock ? <MockBadge /> : null}
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className={cx("ln-dt", className)}>
      {isMock ? <MockBadge /> : null}
      {hasControls ? (
        <div className="ln-dt__toolbar">
          {searchable ? (
            <div className="ln-dt__control">
              <label htmlFor={`${uid}-q`}>Buscar na tabela</label>
              <input
                id={`${uid}-q`}
                type="search"
                className="ln-field__input"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          ) : null}
          {columns
            .filter((c) => c.filterable)
            .map((c) => (
              <div key={c.id} className="ln-dt__control">
                <label htmlFor={`${uid}-f-${c.id}`}>{c.header}</label>
                <select
                  id={`${uid}-f-${c.id}`}
                  className="ln-field__input"
                  value={filters[c.id] ?? ""}
                  onChange={(e) => {
                    setFilters((f) => ({ ...f, [c.id]: e.target.value }));
                    setPage(1);
                  }}
                >
                  <option value="">Todos</option>
                  {filterOptions[c.id]?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </div>
      ) : null}
      <p className="ln-dt__count" role="status" aria-live="polite">
        {total === 0 ? "Nenhum resultado" : `Mostrando ${from}–${to} de ${total}`}
        {filtering ? " (filtrado)" : ""}
      </p>
      <div className="ln-dt__wrap" role="region" aria-labelledby={captionId} tabIndex={0}>
        <table className="ln-dt__table">
          <caption id={captionId} className="ln-dt__caption">
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.columnId === c.id ? sort.direction : null;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    className={cx(c.align === "end" && "ln-dt__end")}
                    aria-sort={c.sortable ? (active === "asc" ? "ascending" : active === "desc" ? "descending" : "none") : undefined}
                  >
                    {c.sortable ? (
                      <button type="button" className="ln-dt__sort" onClick={() => toggleSort(c.id)}>
                        {c.header}
                        <span aria-hidden="true" className="ln-dt__arrow">
                          {active === "asc" ? "▲" : active === "desc" ? "▼" : "⇅"}
                        </span>
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c, i) => {
                  const content = c.cell ? c.cell(r) : (c.value(r) ?? "—");
                  return i === 0 ? (
                    <th key={c.id} scope="row" className={cx("ln-dt__rowhead", c.align === "end" && "ln-dt__end")}>
                      {content}
                    </th>
                  ) : (
                    <td key={c.id} className={cx(c.align === "end" && "ln-dt__end")}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total === 0 ? (
        <EmptyState headingLevel={3} title="Nenhum resultado para os filtros" description="Ajuste a busca ou limpe os filtros." />
      ) : null}
      <Pagination page={current} totalPages={pages} onPageChange={setPage} label={`Paginação: ${caption}`} />
    </div>
  );
}
