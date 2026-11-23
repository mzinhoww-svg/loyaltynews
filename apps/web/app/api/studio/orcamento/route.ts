import { route } from '../../_lib/http';
import { getBudget } from '../../_lib/orcamento';

export const dynamic = 'force-dynamic';
// gasto do mês, degraus e kill switch (admin e editor-chefe leem)
export const GET = route(['orcamento', 'read'], getBudget);
