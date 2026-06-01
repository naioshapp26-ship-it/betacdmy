import { ConversationSummary, ConversationMessage, MessagingScope, MessageBlock } from '../types';
import {
  normalizeHost,
  resolveMainDomainForHost
} from '../utils/resolveMainDomain';

const getMessagingBasePath = () => {
  if (typeof window === 'undefined') {
    return '/api/messaging';
  }
  const host = normalizeHost(window.location.hostname);
  if (!host) {
    return '/api/messaging';
  }
  const envMainDomainRaw = (import.meta as any)?.env?.VITE_MAIN_DOMAIN;
  const envMainDomain = envMainDomainRaw
    ? normalizeHost(envMainDomainRaw).replace(/^www\./, '')
    : null;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const mainDomain = resolveMainDomainForHost(host, envMainDomain);

  if (isLocalHost) {
    const devTenant = (import.meta as any)?.env?.VITE_DEV_TENANT_SUBDOMAIN || null;
    return devTenant ? '/api/tenant/messaging' : '/api/messaging';
  }

  if (!host.endsWith(mainDomain)) {
    return '/api/tenant/messaging';
  }

  const withoutDomain = host.slice(0, -mainDomain.length).replace(/\.$/, '');
  if (!withoutDomain || withoutDomain === 'www') {
    return '/api/messaging';
  }

  return '/api/tenant/messaging';
};

const buildMessagingUrl = (path: string) => `${getMessagingBasePath()}${path}`;

export interface SendMessagePayload {
  senderId: string;
  body: string;
  conversationId?: string;
  targetUserId?: string;
  courseId?: string;
  scope?: MessagingScope;
}

export interface MarkReadPayload {
  userId: string;
  conversationId: string;
}

export interface DeleteMessagePayload {
  messageId: string;
  actorId: string;
  reason?: string;
}

export interface BlockUserPayload {
  adminId: string;
  userId: string;
  durationMinutes?: number;
  reason?: string;
}

export interface MuteConversationPayload {
  adminId: string;
  conversationId: string;
  muted: boolean;
  durationMinutes?: number;
  reason?: string;
}

export type MessagingServerEvent =
  | { type: 'message:new'; payload: { conversationId: string; message: ConversationMessage; conversation?: ConversationSummary | null } }
  | { type: 'message:deleted'; payload: { conversationId: string; messageId: string; conversation?: ConversationSummary | null } }
  | { type: 'conversation:muted'; payload: { conversation?: ConversationSummary | null } }
  | { type: 'conversation:read'; payload: { conversation: ConversationSummary } }
  | { type: 'user:blocked'; payload: { block: MessageBlock } }
  | { type: 'user:unblocked'; payload: { userId: string } };

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload?.error || 'Messaging request failed') as Error & { status?: number; details?: unknown };
    error.status = response.status;
    error.details = payload;
    throw error;
  }
  return response.json();
};

export const messagingClient = {
  async fetchConversations(userId: string, scope: 'all' | 'mine' = 'mine'): Promise<ConversationSummary[]> {
    const params = new URLSearchParams({ userId });
    if (scope === 'all') {
      params.set('scope', 'all');
    }
    const response = await fetch(`${buildMessagingUrl('/conversations')}?${params.toString()}`);
    const payload = await handleResponse<{ conversations: ConversationSummary[] }>(response);
    return payload.conversations || [];
  },
  async fetchMessages(conversationId: string, userId: string): Promise<ConversationMessage[]> {
    const params = new URLSearchParams({ userId });
    const response = await fetch(`${buildMessagingUrl(`/conversations/${conversationId}/messages`)}?${params.toString()}`);
    const payload = await handleResponse<{ messages: ConversationMessage[] }>(response);
    return payload.messages || [];
  },
  async sendMessage(payload: SendMessagePayload): Promise<{ conversation: ConversationSummary; message: ConversationMessage }> {
    const response = await fetch(buildMessagingUrl('/messages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return handleResponse(response);
  },
  async markConversationRead(payload: MarkReadPayload): Promise<ConversationSummary> {
    const response = await fetch(buildMessagingUrl('/read'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await handleResponse<{ conversation: ConversationSummary }>(response);
    return data.conversation;
  },
  async deleteMessage(payload: DeleteMessagePayload): Promise<void> {
    const response = await fetch(buildMessagingUrl(`/messages/${payload.messageId}`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId: payload.actorId, reason: payload.reason })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || 'Unable to delete message');
    }
  },
  async blockUser(payload: BlockUserPayload): Promise<MessageBlock> {
    const response = await fetch(buildMessagingUrl('/blocks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await handleResponse<{ block: MessageBlock }>(response);
    return data.block;
  },
  async unblockUser(adminId: string, userId: string): Promise<void> {
    const response = await fetch(`${buildMessagingUrl(`/blocks/${userId}`)}?adminId=${adminId}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || 'Unable to unblock user');
    }
  },
  async muteConversation(payload: MuteConversationPayload): Promise<ConversationSummary | undefined> {
    const response = await fetch(buildMessagingUrl('/mutes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await handleResponse<{ conversation?: ConversationSummary }>(response);
    return data.conversation;
  },
  subscribe(userId: string, onEvent: (event: MessagingServerEvent) => void) {
    const source = new EventSource(`${buildMessagingUrl('/events')}?userId=${userId}`);
    const handler = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);
        onEvent({ type: event.type as MessagingServerEvent['type'], payload } as MessagingServerEvent);
      } catch (error) {
        console.error('Messaging event parse error', error);
      }
    };
    source.addEventListener('message:new', handler as EventListener);
    source.addEventListener('message:deleted', handler as EventListener);
    source.addEventListener('conversation:muted', handler as EventListener);
    source.addEventListener('conversation:read', handler as EventListener);
    source.addEventListener('user:blocked', handler as EventListener);
    source.addEventListener('user:unblocked', handler as EventListener);
    return source;
  }
};
