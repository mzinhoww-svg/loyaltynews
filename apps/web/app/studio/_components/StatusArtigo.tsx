import { StatusPill, type StatusTone } from '@ln/ui';
import { STATUS_LABEL } from '@/lib/studio/cms/articles';
import type { ArticleStatus } from '@ln/contracts';

const TOM: Record<ArticleStatus, StatusTone> = {
  rascunho: 'neutral',
  em_checagem: 'warning',
  bloqueado: 'danger',
  aprovado: 'success',
  publicado: 'info',
  despublicado: 'neutral',
  corrigido: 'info',
};

export function StatusArtigo({ status }: { status: ArticleStatus }) {
  return <StatusPill label={STATUS_LABEL[status]} tone={TOM[status]} />;
}
