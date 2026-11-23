import { permanentRedirect } from 'next/navigation';

/** Blueprint §2: /anuncie redireciona para /midia-kit (uma única URL indexável). */
export default function AnunciePage() {
  permanentRedirect('/midia-kit');
}
