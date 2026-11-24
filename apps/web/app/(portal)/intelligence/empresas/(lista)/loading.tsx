import { LoadingState } from '../../../_components/states';

/** Carregando a lista (só aqui: o perfil [id] não tem loading para manter o 404 real). */
export default function Loading() {
  return <LoadingState label="Carregando empresas…" rows={6} />;
}
