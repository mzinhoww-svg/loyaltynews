// Tabela de rotas sugerida para o Backend montar em apps/web/app/api/commercial/**. `auth: 'studio'` => ctx.actor.canManageCommercial.
// Métodos GET: a entrada vem de query string (convertida pelo Backend em objeto; datas já como string ISO).
import * as h from './handlers';
import type { Handler } from './http';

export * from './http';
export * from './handlers';

export interface Route { method: 'GET' | 'POST'; path: string; auth: 'public' | 'studio'; handler: Handler }
export const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/api/commercial/mediakit', auth: 'public', handler: h.getMediaKit },
  { method: 'GET', path: '/api/commercial/formats', auth: 'public', handler: h.listFormats },
  { method: 'GET', path: '/api/commercial/availability', auth: 'public', handler: h.getAvailability },
  { method: 'POST', path: '/api/commercial/leads', auth: 'public', handler: h.submitLead },
  { method: 'POST', path: '/api/commercial/ads/serve', auth: 'public', handler: h.serveAd },
  { method: 'POST', path: '/api/commercial/ads/event', auth: 'public', handler: h.recordAdEvent },

  { method: 'GET', path: '/api/commercial/studio/dashboard', auth: 'studio', handler: h.getStudioDashboard },
  { method: 'GET', path: '/api/commercial/studio/inventory', auth: 'studio', handler: h.getInventoryOverview },
  { method: 'GET', path: '/api/commercial/studio/inventory/calendar', auth: 'studio', handler: h.getInventoryCalendar },
  { method: 'GET', path: '/api/commercial/studio/leads', auth: 'studio', handler: h.getLeadInbox },
  { method: 'POST', path: '/api/commercial/studio/leads/qualify', auth: 'studio', handler: h.qualifyLead },
  { method: 'POST', path: '/api/commercial/studio/leads/discard', auth: 'studio', handler: h.discardLead },
  { method: 'POST', path: '/api/commercial/studio/leads/convert', auth: 'studio', handler: h.convertLead },
  { method: 'GET', path: '/api/commercial/studio/opportunities', auth: 'studio', handler: h.getOpportunityBoard },
  { method: 'POST', path: '/api/commercial/studio/opportunities/stage', auth: 'studio', handler: h.moveOpportunityStage },
  { method: 'POST', path: '/api/commercial/studio/reservations', auth: 'studio', handler: h.createReservation },
  { method: 'POST', path: '/api/commercial/studio/reservations/cancel', auth: 'studio', handler: h.cancelReservation },
  { method: 'POST', path: '/api/commercial/studio/takeovers', auth: 'studio', handler: h.reserveTakeover },
  { method: 'POST', path: '/api/commercial/studio/campaigns', auth: 'studio', handler: h.createCampaign },
  { method: 'GET', path: '/api/commercial/studio/campaigns/detail', auth: 'studio', handler: h.getCampaignDetail },
  { method: 'POST', path: '/api/commercial/studio/campaigns/transition', auth: 'studio', handler: h.transitionCampaign },
  { method: 'POST', path: '/api/commercial/studio/creatives', auth: 'studio', handler: h.addCreative },
  { method: 'POST', path: '/api/commercial/studio/creatives/approve', auth: 'studio', handler: h.approveCreative },
  { method: 'POST', path: '/api/commercial/studio/metrics', auth: 'studio', handler: h.ingestMetric },
];
