import React, { useMemo, useState, useEffect } from 'react';
import { MessageSquare, Send, Shield, Users, RefreshCw, Lock, Unlock, Bell, VolumeX, Volume2, Circle, Loader2, Search, Inbox, Trash } from 'lucide-react';
import { Course, User, UserRole } from '../types';
import { MessagingTarget, useMessaging } from '../hooks/useMessaging';
import { SendMessagePayload } from '../services/messagingClient';

interface MessagingPanelProps {
  user: User;
  courses: Course[];
  users: User[];
  t: any;
  onShowRestrictionModal?: () => void;
}

const BLOCK_DURATION_OPTIONS = [
  { label: '15m', value: '15' },
  { label: '1h', value: '60' },  { label: '1d', value: (60 * 24).toString() },
  { label: 'Permanent', value: '' }
];

const getConversationTitle = (conversation: ReturnType<typeof useMessaging>['conversations'][number], user: User) => {
  if (conversation.type === 'COURSE_GROUP') {
    return conversation.courseTitle || 'Course Group';
  }
  if (conversation.type === 'ADMIN_USER') {
    return 'System Admin';
  }
  const others = conversation.participants.filter((participant) => participant.userId !== user.id);
  if (others.length === 0) {
    return 'You';
  }
  return others.map((participant) => participant.name || 'Member').join(', ');
};

const getConversationSubtitle = (
  conversation: ReturnType<typeof useMessaging>['conversations'][number],
  user: User
) => {
  if (conversation.type === 'COURSE_GROUP') {
    return `${conversation.participants.length} members`;
  }
  if (conversation.courseTitle) {
    return conversation.courseTitle;
  }
  const others = conversation.participants.filter((participant) => participant.userId !== user.id);
  if (!others.length) return 'Direct chat';
  return `${others.length} participant${others.length > 1 ? 's' : ''}`;
};

const formatTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const MessagingPanel: React.FC<MessagingPanelProps> = ({ user, courses, users, t, onShowRestrictionModal }) => {
  const isGuest = user.role === UserRole.GUEST;
  const [draft, setDraft] = useState('');
  const [pendingTarget, setPendingTarget] = useState<MessagingTarget | null>(null);
  const [moderationForm, setModerationForm] = useState({ memberId: '', duration: '60', reason: '' });
  const [moderationNotice, setModerationNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isMutingConversation, setIsMutingConversation] = useState(false);
  const [isBlockingUser, setIsBlockingUser] = useState(false);
  const [isUnblockingUser, setIsUnblockingUser] = useState(false);
  const {
    conversations,
    isLoadingConversations,
    activeConversationId,
    selectConversation,
    messagesByConversation,
    loadingConversationId,
    refreshConversations,
    sendMessage,
    isSending,
    blockedInfo,
    connectionState,
    unreadTotal,
    availableTargets,
    deleteMessage,
    blockUser,
    unblockUser,
    muteConversation
  } = useMessaging({ user, courses, users });
  const isPlatformModerator = user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN;

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) || null,
    [activeConversationId, conversations]
  );
  const activeMessages = activeConversationId && !pendingTarget ? messagesByConversation[activeConversationId] || [] : [];

  useEffect(() => {
    if (!activeConversation) return;
    const member = activeConversation.participants.find((participant) => participant.userId !== user.id);
    setModerationForm((prev) => ({ ...prev, memberId: member?.userId || '' }));
  }, [activeConversation, user.id]);

  useEffect(() => {
    if (!moderationNotice) return;
    const timer = setTimeout(() => setModerationNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [moderationNotice]);

  const handleSend = async () => {
    if (!draft.trim() || isSending) return;
    if (blockedInfo) return;
    
    // Check if user is guest
    if (isGuest && onShowRestrictionModal) {
      onShowRestrictionModal();
      return;
    }
    
    const payload: SendMessagePayload = {
      senderId: user.id,
      body: draft.trim()
    };
    if (pendingTarget) {
      payload.targetUserId = pendingTarget.userId;
      payload.courseId = pendingTarget.courseId;
      payload.scope = pendingTarget.scope;
    } else if (activeConversationId) {
      payload.conversationId = activeConversationId;
    } else {
      return;
    }
    try {
      await sendMessage(payload);
      setDraft('');
      setPendingTarget(null);
      if (!payload.conversationId && activeConversationId) {
        await selectConversation(activeConversationId);
      }
    } catch (error) {
      console.error('Send message failed', error);
    }
  };

  const handleSelectConversation = async (conversationId: string) => {
    setPendingTarget(null);
    await selectConversation(conversationId);
  };

  const participantOptions = (activeConversation?.participants || []).filter((participant) => participant.role !== 'ADMIN');
  const canModerateParticipant = Boolean(moderationForm.memberId);

  const handleBlock = async () => {
    if (!moderationForm.memberId) {
      setModerationNotice({ type: 'error', text: t.selectParticipantFirst || 'Select a participant before blocking.' });
      return;
    }
    setIsBlockingUser(true);
    setModerationNotice(null);
    try {
      await blockUser({
        adminId: user.id,
        userId: moderationForm.memberId,
        durationMinutes: moderationForm.duration ? Number(moderationForm.duration) : undefined,
        reason: moderationForm.reason || undefined
      });
      setModerationForm((prev) => ({ ...prev, reason: '' }));
      await refreshConversations();
      setModerationNotice({ type: 'success', text: t.blockSuccess || 'Participant blocked successfully.' });
    } catch (error) {
      console.error('Block user failed', error);
      setModerationNotice({ type: 'error', text: error instanceof Error ? error.message : (t.blockFailed || 'Unable to block participant.') });
    } finally {
      setIsBlockingUser(false);
    }
  };

  const handleUnblock = async () => {
    if (!moderationForm.memberId) {
      setModerationNotice({ type: 'error', text: t.selectParticipantFirst || 'Select a participant before unblocking.' });
      return;
    }
    setIsUnblockingUser(true);
    setModerationNotice(null);
    try {
      await unblockUser(user.id, moderationForm.memberId);
      await refreshConversations();
      setModerationNotice({ type: 'success', text: t.unblockSuccess || 'Participant unblocked.' });
    } catch (error) {
      console.error('Unblock user failed', error);
      setModerationNotice({ type: 'error', text: error instanceof Error ? error.message : (t.unblockFailed || 'Unable to unblock participant.') });
    } finally {
      setIsUnblockingUser(false);
    }
  };

  const handleMuteToggle = async () => {
    if (!activeConversation) return;
    const nextMutedState = !activeConversation.isMuted;
    setIsMutingConversation(true);
    setModerationNotice(null);
    try {
      await muteConversation({
        adminId: user.id,
        conversationId: activeConversation.id,
        muted: nextMutedState,
        durationMinutes: nextMutedState ? Number(moderationForm.duration) || undefined : undefined,
        reason: nextMutedState ? moderationForm.reason || undefined : undefined
      });
      await refreshConversations();
      if (!nextMutedState) {
        setModerationForm((prev) => ({ ...prev, reason: '' }));
      }
      setModerationNotice({
        type: 'success',
        text: nextMutedState ? (t.muteSuccess || 'Conversation muted.') : (t.unmuteSuccess || 'Conversation unmuted.')
      });
    } catch (error) {
      console.error('Mute conversation failed', error);
      setModerationNotice({ type: 'error', text: error instanceof Error ? error.message : (t.muteFailed || 'Unable to update mute state.') });
    } finally {
      setIsMutingConversation(false);
    }
  };

  const handleTargetSelect = (target: MessagingTarget) => {
    setPendingTarget(target);
    setDraft('');
  };

  const connectionMeta = useMemo(() => {
    const copy: Record<'connecting' | 'connected' | 'error', { label: string; color: string }> = {
      connecting: { label: t?.messagingStatusSyncing || 'Syncing…', color: 'text-amber-500' },
      connected: { label: t?.messagingStatusLive || 'Live', color: 'text-emerald-500' },
      error: { label: t?.messagingStatusOffline || 'Offline', color: 'text-red-500' }
    };
    return copy[connectionState];
  }, [connectionState, t]);

  return (
    <section className="ds-card">
      <div className="p-6 border-b border-zinc-100 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <MessageSquare className="h-4 w-4" />
            <span>{t.messages || 'Messages'}</span>
          </div>
          <h2 className="ds-section-title flex items-center gap-2">
            {t.liveInbox || 'Live Inbox'}
            {unreadTotal > 0 && (
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
                {unreadTotal} {t?.newBadge || t?.new || 'new'}
              </span>
            )}
          </h2>
          {blockedInfo && (
            <p className="text-sm text-red-600 mt-2 flex items-center gap-2">
              <Shield className="h-4 w-4" />
              {blockedInfo.reason || (t.blockedMessage || 'Messaging disabled by admin')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 text-sm font-medium ${connectionMeta.color}`}>
            <Circle className="h-3 w-3" /> {connectionMeta.label}
          </div>
          <button
            onClick={refreshConversations}
            className="ds-btn ds-btn-secondary"
          >
            <RefreshCw className="h-4 w-4" /> {t.refresh || 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_auto]">
        <aside className="border-r border-zinc-100 p-4 space-y-4 bg-zinc-50/60">
          <div className="relative">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder={t.searchPlaceholder || 'Search conversations'}
              className="w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
          </div>

          <div className="space-y-2">
            {isLoadingConversations && (
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.loading || 'Loading conversations...'}
              </div>
            )}
            {!isLoadingConversations && conversations.length === 0 && (
              <div className="text-center text-sm text-zinc-500 py-6">
                <Inbox className="h-8 w-8 mx-auto text-zinc-300 mb-2" />
                {t.noConversations || 'No conversations yet. Start one below!'}
              </div>
            )}
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => handleSelectConversation(conversation.id)}
                  className={`w-full text-left ds-card-compact transition shadow-sm ${
                    activeConversationId === conversation.id
                      ? 'border-red-200'
                      : 'hover:border-red-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-sm text-zinc-900 truncate">
                      {getConversationTitle(conversation, user)}
                    </p>
                    <span className="text-xs text-zinc-400">{formatTime(conversation.lastMessage?.createdAt)}</span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{getConversationSubtitle(conversation, user)}</p>
                  <p className="text-sm text-zinc-600 line-clamp-1 mt-1">
                    {conversation.lastMessage?.body || t.noMessagesYet || 'No messages yet'}
                  </p>
                  {conversation.unreadCount > 0 && (
                    <span className="inline-flex mt-2 px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-semibold">
                      {conversation.unreadCount} {t?.newBadge || t?.new || 'new'}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {(availableTargets.instructors.length > 0 || availableTargets.classmates.length > 0 || availableTargets.courseGroups.length > 0 || availableTargets.students.length > 0 || availableTargets.users.length > 0 || availableTargets.admin) && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {t.startNewChat || 'Start a new chat'}
              </p>
              <div className="flex flex-wrap gap-2">
                {user.role === UserRole.STUDENT && (
                  <>
                    {availableTargets.instructors.map((target) => (
                      <button
                        key={target.id}
                        onClick={() => handleTargetSelect(target)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 bg-white hover:border-red-200"
                      >
                        <Users className="h-3 w-3 inline mr-1" /> {target.name}
                      </button>
                    ))}
                    {availableTargets.classmates.map((target) => (
                      <button
                        key={target.id}
                        onClick={() => handleTargetSelect(target)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 bg-white hover:border-red-200"
                      >
                        <MessageSquare className="h-3 w-3 inline mr-1" /> {target.name}
                      </button>
                    ))}
                  </>
                )}
                {user.role === UserRole.INSTRUCTOR && (
                  <>
                    {availableTargets.courseGroups.map((target) => (
                      <button
                        key={target.id}
                        onClick={() => handleTargetSelect(target)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 bg-white hover:border-red-200"
                      >
                        <Users className="h-3 w-3 inline mr-1" /> {target.name}
                      </button>
                    ))}
                    {availableTargets.students.map((target) => (
                      <button
                        key={target.id}
                        onClick={() => handleTargetSelect(target)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 bg-white hover:border-red-200"
                      >
                        <MessageSquare className="h-3 w-3 inline mr-1" /> {target.name}
                      </button>
                    ))}
                  </>
                )}
                {(user.role === UserRole.ADMIN || user.role === UserRole.SUPER_ADMIN) && (
                  <>
                    {availableTargets.users.map((target) => (
                      <button
                        key={target.id}
                        onClick={() => handleTargetSelect(target)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 bg-white hover:border-red-200"
                      >
                        <Users className="h-3 w-3 inline mr-1" /> {target.name}
                      </button>
                    ))}
                  </>
                )}
                {availableTargets.admin && (
                  <button
                    onClick={() => handleTargetSelect(availableTargets.admin!)}
                    className="px-3 py-1.5 rounded-full text-xs font-semibold border border-zinc-200 bg-white hover:border-red-200"
                  >
                    <Shield className="h-3 w-3 inline mr-1" /> {availableTargets.admin.name}
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        <div className="p-6 space-y-4">
          {pendingTarget && (
            <div className="flex items-center justify-between border border-dashed border-red-200 bg-red-50 px-4 py-2 rounded-xl text-sm">
              <div>
                <p className="font-semibold text-red-700">{t.newMessage || 'New message'}</p>
                <p className="text-red-600">
                  {pendingTarget.name}
                  {pendingTarget.subtitle ? ` • ${pendingTarget.subtitle}` : ''}
                </p>
              </div>
              <button
                onClick={() => setPendingTarget(null)}
                className="text-xs font-semibold text-red-600 hover:text-red-800"
              >
                {t.cancel || 'Cancel'}
              </button>
            </div>
          )}

          {isPlatformModerator && activeConversation && (
            <div className="ds-card-compact bg-zinc-50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase text-zinc-500 font-semibold">{t.adminControls || 'Admin Controls'}</p>
                  <p className="ds-description">{getConversationTitle(activeConversation, user)}</p>
                </div>
                <button
                  onClick={handleMuteToggle}
                  disabled={isMutingConversation}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-300 bg-white hover:border-red-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isMutingConversation ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> {t.saving || 'Saving'}
                    </>
                  ) : activeConversation.isMuted ? (
                    <>
                      <Volume2 className="h-3 w-3" /> {t.unmute || 'Unmute'}
                    </>
                  ) : (
                    <>
                      <VolumeX className="h-3 w-3" /> {t.mute || 'Mute'}
                    </>
                  )}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500">{t.participant || 'Participant'}</label>
                  <select
                    value={moderationForm.memberId}
                    onChange={(event) => setModerationForm((prev) => ({ ...prev, memberId: event.target.value }))}
                    className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2"
                  >
                    <option value="">{t.select || 'Select'}</option>
                    {participantOptions.map((participant) => (
                      <option key={participant.userId} value={participant.userId}>
                        {participant.name || participant.userId}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500">{t.duration || 'Duration'}</label>
                  <select
                    value={moderationForm.duration}
                    onChange={(event) => setModerationForm((prev) => ({ ...prev, duration: event.target.value }))}
                    className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2"
                  >
                    {BLOCK_DURATION_OPTIONS.map((option) => (
                      <option key={option.label} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-500">{t.reason || 'Reason'}</label>
                  <input
                    value={moderationForm.reason}
                    onChange={(event) => setModerationForm((prev) => ({ ...prev, reason: event.target.value }))}
                    className="w-full text-sm border border-zinc-300 rounded-lg px-3 py-2"
                    placeholder={t.optional || 'Optional'}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleBlock}
                  disabled={!canModerateParticipant || isBlockingUser}
                  className="ds-btn ds-btn-primary text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isBlockingUser ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> {t.blocking || 'Blocking...'}
                    </>
                  ) : (
                    <>
                      <Lock className="h-3 w-3" /> {t.block || 'Block'}
                    </>
                  )}
                </button>
                <button
                  onClick={handleUnblock}
                  disabled={!canModerateParticipant || isUnblockingUser}
                  className="ds-btn ds-btn-secondary text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isUnblockingUser ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> {t.unblocking || 'Unblocking...'}
                    </>
                  ) : (
                    <>
                      <Unlock className="h-3 w-3" /> {t.unblock || 'Unblock'}
                    </>
                  )}
                </button>
              </div>
              {moderationNotice && (
                <div
                  className={`text-xs px-3 py-2 rounded-lg border ${
                    moderationNotice.type === 'success'
                      ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                      : 'bg-red-50 border-red-100 text-red-700'
                  }`}
                >
                  {moderationNotice.text}
                </div>
              )}
            </div>
          )}

          <div className="h-[420px] border border-zinc-100 rounded-2xl bg-white flex flex-col">
            <div className="flex-1 overflow-y-auto space-y-4 p-4" id="messaging-thread">
              {loadingConversationId && activeConversationId === loadingConversationId && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.loading || 'Loading conversation...'}
                </div>
              )}
              {!pendingTarget && !activeConversation && (
                <div className="flex flex-col items-center justify-center text-center h-full text-zinc-400">
                  <MessageSquare className="h-12 w-12 mb-4" />
                  <p className="font-semibold">{t.selectConversation || 'Select a conversation'}</p>
                  <p className="text-sm">{t.selectConversationDesc || 'Or start a new one from the left column.'}</p>
                </div>
              )}
              {(pendingTarget || activeConversation) && activeMessages.length === 0 && !pendingTarget && (
                <div className="text-center text-sm text-zinc-400 py-6">
                  {t.noMessagesYet || 'No messages yet. Say hello!'}
                </div>
              )}
              {(pendingTarget || activeConversation) &&
                activeMessages.map((message) => {
                  const isMine = message.senderId === user.id;
                  return (
                    <div
                      key={`${activeConversationId || 'pending'}-${message.id}`}
                      className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-sm rounded-2xl px-4 py-2 text-sm shadow ${
                          isMine ? 'bg-red-900 text-white' : 'bg-zinc-100 text-zinc-900'
                        }`}
                      >
                        <p className="font-semibold mb-1">
                          {isMine ? t.you || 'You' : message.senderName || 'Member'}
                        </p>
                        <p>{message.body}</p>
                        <div className={`text-[10px] mt-2 ${isMine ? 'text-red-100' : 'text-zinc-500'}`}>
                          {formatTime(message.createdAt)}
                        </div>
                        {isPlatformModerator && !isMine && (
                          <button
                            onClick={() => deleteMessage({ actorId: user.id, messageId: message.id })}
                            className={`mt-2 inline-flex items-center gap-1 text-[10px] font-semibold ${
                              isMine ? 'text-red-100' : 'text-zinc-500'
                            }`}
                          >
                            <Trash className="h-3 w-3" /> {t.delete || 'Delete'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
            <div className="border-t border-zinc-100 p-4 space-y-3">
              {blockedInfo && (
                <div className="text-xs text-red-600 flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  <Bell className="h-3 w-3" />
                  {blockedInfo.reason || t.blockedMessage || 'You cannot send messages at the moment.'}
                </div>
              )}
              {isGuest && (
                <div className="text-xs text-blue-600 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <Lock className="h-3 w-3" />
                  {t.guest?.createToMessage || 'Create an account to send messages'}
                </div>
              )}
              <div className="flex flex-col sm:flex-row items-stretch gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={isGuest ? (t.guest?.createToMessage || 'Create an account to send messages') : (t.writeMessage || 'Write a message...')}
                  rows={2}
                  disabled={Boolean(blockedInfo) || isGuest}
                  className="flex-1 rounded-2xl border border-zinc-200 px-4 py-3 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 resize-none disabled:bg-zinc-50 disabled:cursor-not-allowed"
                />
                <button
                  onClick={handleSend}
                  disabled={isSending || !draft.trim() || Boolean(blockedInfo) || isGuest}
                  className="h-12 w-full sm:w-12 rounded-full bg-red-900 text-white flex items-center justify-center shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
