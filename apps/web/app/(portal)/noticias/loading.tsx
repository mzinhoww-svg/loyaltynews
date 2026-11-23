import { LoadingState } from '../_components/states';

/** Carregamento da leitura dinâmica da API pública (página sem rota filha que devolva 404: o status HTTP segue correto). */
export default function Loading() {
  return <LoadingState />;
}
