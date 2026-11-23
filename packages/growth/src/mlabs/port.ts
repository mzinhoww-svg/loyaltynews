import type { Channel } from '../types';

/** Ferramentas do MCP do mLabs consideradas SOMENTE LEITURA. A validação de capacidades usa só estas. */
export const READ_ONLY_TOOLS = Object.freeze([
  'list_channels',
  'get_channel',
  'list_profiles',
  'get_profile',
  'list_profile_groups',
  'get_post_limits',
  'list_templates',
  'list_metrics',
  'list_scheduled_posts',
  'list_posts_by_date',
  'get_post',
  'get_account_settings',
  'get_default_location',
  'get_media_upload',
  'list_workflows',
  'get_workflow_options',
  'get_post_notifications',
  // métricas do painel social (leitura): posts publicados e evolução de seguidores
  'list_published_posts',
  'get_follower_growth',
] as const);

/** Ferramentas que alteram estado no mLabs: proibidas fora da identidade de publicação. */
export const WRITE_TOOLS = Object.freeze([
  'create_post',
  'update_post',
  'delete_post',
  'delete_published_post',
  'bulk_delete_posts',
  'restore_posts',
  'toggle_post_status',
  'upload_media',
  'attach_media',
  'prepare_media_upload',
  'create_post_approval_link',
  'create_workflow',
  'edit_workflow',
  'send_workflow_to_approval',
  'approve_workflow',
  'update_workflow_status',
  'request_workflow_adjustment',
  'send_chat_message',
  'rename_profile',
  'create_profile_group',
  'create_contact',
  'import_contacts',
  'create_flow',
  'delete_flow',
] as const);

export interface MlabsChannel {
  id: string;
  network: string;
  name: string;
}

export interface PostLimits {
  raw: unknown;
}

/** Leituras: seguras, sem efeito colateral. */
export interface MlabsReadPort {
  readonly mode: 'simulated' | 'live';
  listChannels(): Promise<MlabsChannel[]>;
  getPostLimits(channelId?: string): Promise<PostLimits>;
  listTemplates(): Promise<unknown[]>;
}

export interface PostPayload {
  channel: Channel;
  text: string;
  /** Referência da imagem aprovada (nunca enviada sem aprovação do gate de mídia). */
  imageRef: string;
  link?: string;
  /** Menções com identidade verificada; vazio = texto puro. */
  mentions: { name: string; ref: string }[];
  scheduleAt?: string;
}

export interface PublishReceipt {
  id: string;
  channel: Channel;
  mode: 'simulated' | 'live';
  /** `true` quando nada foi enviado ao mLabs. */
  simulated: boolean;
  createdAt: string;
  status: 'draft' | 'scheduled' | 'published' | 'edited' | 'deleted';
  idempotencyKey: string;
}
