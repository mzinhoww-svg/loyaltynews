import { route } from '../../../../_lib/http';
import { cancelSchedule } from '../../../../_lib/site';

export const dynamic = 'force-dynamic';
export const DELETE = route(['site', 'publish'], cancelSchedule);
