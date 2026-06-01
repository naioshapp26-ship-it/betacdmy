import { useState, useEffect, useMemo, useCallback } from 'react';
import { ConversationSummary, ConversationMessage, User, Course, UserRole, MessagingScope, MessageBlock } from '../types';
import { messagingClient, SendMessagePayload, DeleteMessagePayload, BlockUserPayload, MuteConversationPayload, MessagingServerEvent } from '../services/messagingClient';

export interface MessagingTarget {
  id: string;
  name: string;
  subtitle?: string;
  userId?: string;
  courseId?: string;
  scope: MessagingScope;
  role: UserRole | 'ADMIN' | 'COURSE_GROUP';
}

interface UseMessagingArgs {
  user: User | null;
  courses: Course[];
  users: User[];
}

interface UseMessagingResult {
  conversations: ConversationSummary[];
  isLoadingConversations: boolean;
  activeConversationId: string | null;
  selectConversation: (conversationId: string) => Promise<void>;
  messagesByConversation: Record<string, ConversationMessage[]>;
  loadingConversationId: string | null;
  refreshConversations: () => Promise<void>;
  sendMessage: (payload: SendMessagePayload) => Promise<{ conversation: ConversationSummary; message: ConversationMessage } | undefined>;
  isSending: boolean;
  blockedInfo: MessageBlock | null;
  connectionState: 'connecting' | 'connected' | 'error';
  unreadTotal: number;
  availableTargets: {
    instructors: MessagingTarget[];
    classmates: MessagingTarget[];
    admin?: MessagingTarget;
    courseGroups: MessagingTarget[];
    students: MessagingTarget[];
    users: MessagingTarget[];
  };
  deleteMessage: (payload: DeleteMessagePayload) => Promise<void>;
  blockUser: (payload: BlockUserPayload) => Promise<void>;
  unblockUser: (adminId: string, userId: string) => Promise<void>;
  muteConversation: (payload: MuteConversationPayload) => Promise<void>;
}

const normalizeName = (value?: string | null) => (value || '').trim().toLowerCase();

export const useMessaging = ({ user, courses, users }: UseMessagingArgs): UseMessagingResult => {
  // Disable messaging for guest users
  const isGuest = user?.role === UserRole.GUEST;
  
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ConversationMessage[]>>({});
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [blockedInfo, setBlockedInfo] = useState<MessageBlock | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error'>('connecting');

  const isPlatformAdmin = user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;
  const scope = isPlatformAdmin ? 'all' : 'mine';

  const upsertConversation = useCallback(
    (incoming: ConversationSummary | null | undefined, fallbackId?: string, message?: ConversationMessage) => {
      setConversations((prev) => {
        const targetId = incoming?.id || fallbackId;
        if (!targetId) return prev;
        const existingIndex = prev.findIndex((conversation) => conversation.id === targetId);
        const baseline = incoming || prev[existingIndex];
        if (!baseline) return prev;
        const existingUnread = existingIndex >= 0 ? prev[existingIndex].unreadCount : 0;
        let unreadCount = incoming?.unreadCount ?? existingUnread;
        if (message) {
          if (message.senderId === user?.id) {
            unreadCount = 0;
          } else {
            unreadCount = existingUnread + 1;
          }
        }
        const updated: ConversationSummary = {
          ...baseline,
          lastMessage: message || baseline.lastMessage || null,
          unreadCount
        };
        const nextList = [...prev];
        if (existingIndex >= 0) {
          nextList.splice(existingIndex, 1);
        }
        return [updated, ...nextList];
      });
    },
    [user?.id]
  );

  const refreshConversations = useCallback(async () => {
    if (!user || isGuest) {
      setConversations([]);
      return;
    }
    setIsLoadingConversations(true);
    try {
      const data = await messagingClient.fetchConversations(user.id, scope as 'all' | 'mine');
      setConversations(data);
    } catch (error) {
      console.error('Load conversations failed', error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [scope, user, isGuest]);

  useEffect(() => {
    if (!user || isGuest) {
      setConversations([]);
      setMessagesByConversation({});
      setActiveConversationId(null);
      setBlockedInfo(null);
      return;
    }

    // When the authenticated user changes (e.g. navigating between dashboards),
    // reset messaging state and reload conversations so that threads from a
    // previous user/session don't bleed into the new context.
    setConversations([]);
    setMessagesByConversation({});
    setActiveConversationId(null);
    setBlockedInfo(null);
    refreshConversations();
  }, [refreshConversations, user, isGuest]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (!user || isGuest) return;
      setActiveConversationId(conversationId);
      setLoadingConversationId(conversationId);
      try {
        const history = await messagingClient.fetchMessages(conversationId, user.id);
        setMessagesByConversation((prev) => ({ ...prev, [conversationId]: history }));
        await messagingClient.markConversationRead({ userId: user.id, conversationId });
        setConversations((prev) =>
          prev.map((conversation) =>
            conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
          )
        );
      } catch (error) {
        console.error('Open conversation failed', error);
      } finally {
        setLoadingConversationId(null);
      }
    },
    [user, isGuest]
  );

  const sendMessage = useCallback(
    async (payload: SendMessagePayload) => {
      if (!user || isGuest) return;
      setIsSending(true);
      try {
        const response = await messagingClient.sendMessage(payload);
        setMessagesByConversation((prev) => {
          const existing = prev[response.conversation.id] || [];
          return {
            ...prev,
            [response.conversation.id]: [...existing, response.message]
          };
        });
        upsertConversation(response.conversation, response.conversation.id, response.message);
        if (!payload.conversationId) {
          setActiveConversationId(response.conversation.id);
        }
        setBlockedInfo(null);
        return response;
      } catch (error) {
        console.error('Send message error', error);
        const details = (error as Error & { details?: any }).details;
        if (details?.block) {
          setBlockedInfo(details.block as MessageBlock);
        }
        throw error;
      } finally {
        setIsSending(false);
      }
    },
    [upsertConversation, user, isGuest]
  );

  const handleServerEvent = useCallback(
    (event: MessagingServerEvent) => {
      if (!user) return;
      switch (event.type) {
        case 'message:new': {
          const { conversationId, message, conversation } = event.payload;
          upsertConversation(conversation, conversationId, message);
          if (conversationId === activeConversationId) {
            setMessagesByConversation((prev) => {
              const existing = prev[conversationId] || [];
              // Prevent duplicate messages by checking if message already exists
              if (existing.some((m) => m.id === message.id)) {
                return prev;
              }
              return { ...prev, [conversationId]: [...existing, message] };
            });
            messagingClient.markConversationRead({ userId: user.id, conversationId }).catch(() => undefined);
          }
          break;
        }
        case 'message:deleted': {
          const { conversationId, messageId, conversation } = event.payload;
          if (conversation) {
            upsertConversation(conversation, conversationId);
          } else if (conversationId) {
            refreshConversations();
          }
          setMessagesByConversation((prev) => {
            const existing = prev[conversationId];
            if (!existing) return prev;
            return {
              ...prev,
              [conversationId]: existing.filter((message) => message.id !== messageId)
            };
          });
          break;
        }
        case 'conversation:muted': {
          const { conversation } = event.payload;
          if (conversation) {
            upsertConversation(conversation, conversation.id);
          } else {
            refreshConversations();
          }
          break;
        }
        case 'conversation:read': {
          upsertConversation(event.payload.conversation, event.payload.conversation.id);
          break;
        }
        case 'user:blocked': {
          if (event.payload.block.userId === user.id) {
            setBlockedInfo(event.payload.block);
          }
          break;
        }
        case 'user:unblocked': {
          if (event.payload.userId === user.id) {
            setBlockedInfo(null);
          }
          break;
        }
        default:
          break;
      }
    },
    [activeConversationId, refreshConversations, upsertConversation, user]
  );

  useEffect(() => {
    if (!user || isGuest) {
      setConnectionState('error');
      return;
    }
    setConnectionState('connecting');
    const source = messagingClient.subscribe(user.id, handleServerEvent);
    source.onopen = () => setConnectionState('connected');
    source.onerror = () => setConnectionState('error');
    return () => {
      source.close();
    };
  }, [handleServerEvent, user, isGuest]);

  const deleteMessage = useCallback(async (payload: DeleteMessagePayload) => {
    await messagingClient.deleteMessage(payload);
  }, []);

  const blockUser = useCallback(async (payload: BlockUserPayload) => {
    const block = await messagingClient.blockUser(payload);
    if (block.userId === user?.id) {
      setBlockedInfo(block);
    }
  }, [user?.id]);

  const unblockUser = useCallback(async (adminId: string, targetUserId: string) => {
    await messagingClient.unblockUser(adminId, targetUserId);
    if (targetUserId === user?.id) {
      setBlockedInfo(null);
    }
  }, [user?.id]);

  const muteConversation = useCallback(async (payload: MuteConversationPayload) => {
    const updated = await messagingClient.muteConversation(payload);
    if (updated) {
      upsertConversation(updated, updated.id);
    } else {
      refreshConversations();
    }
  }, [refreshConversations, upsertConversation]);

  const instructorsForStudent = useMemo(() => {
    if (!user || user.role !== UserRole.STUDENT) return [];
    const enrolled = user.enrolledCourses || [];
    const targets: MessagingTarget[] = [];
    enrolled.forEach((courseId) => {
      const course = courses.find((item) => item.id === courseId);
      if (!course) return;
      const match = users.find(
        (candidate) => candidate.role === UserRole.INSTRUCTOR && normalizeName(candidate.name) === normalizeName(course.instructor)
      );
      if (match) {
        targets.push({
          id: `${match.id}-${course.id}`,
          name: match.name,
          subtitle: course.title,
          userId: match.id,
          courseId: course.id,
          scope: 'DIRECT',
          role: UserRole.INSTRUCTOR
        });
      }
    });
    const seen = new Set<string>();
    return targets.filter((target) => {
      const key = `${target.userId}-${target.courseId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [courses, user, users]);

  const classmatesForStudent = useMemo(() => {
    if (!user || user.role !== UserRole.STUDENT) return [];
    const enrolled = new Set(user.enrolledCourses || []);
    return users
      .filter((candidate) => candidate.role === UserRole.STUDENT && candidate.id !== user.id)
      .filter((candidate) => (candidate.enrolledCourses || []).some((courseId) => enrolled.has(courseId)))
      .map((candidate) => {
        const sharedCourseId = (candidate.enrolledCourses || []).find((courseId) => enrolled.has(courseId));
        const course = courses.find((item) => item.id === sharedCourseId);
        return {
          id: `${candidate.id}-${sharedCourseId}`,
          name: candidate.name,
          subtitle: course?.title,
          userId: candidate.id,
          courseId: sharedCourseId,
          scope: 'DIRECT' as MessagingScope,
          role: UserRole.STUDENT
        } as MessagingTarget;
      });
  }, [courses, user, users]);

  const instructorCourses = useMemo(() => {
    if (!user || user.role !== UserRole.INSTRUCTOR) return [];
    return courses.filter((course) => normalizeName(course.instructor) === normalizeName(user.name));
  }, [courses, user]);

  const studentsForInstructor = useMemo(() => {
    if (!user || user.role !== UserRole.INSTRUCTOR) return [];
    const enrolledByCourse = new Map<string, User[]>();
    instructorCourses.forEach((course) => {
      const roster = users.filter((candidate) => candidate.role === UserRole.STUDENT && (candidate.enrolledCourses || []).includes(course.id));
      enrolledByCourse.set(course.id, roster);
    });
    const targets: MessagingTarget[] = [];
    enrolledByCourse.forEach((roster, courseId) => {
      const course = courses.find((item) => item.id === courseId);
      roster.forEach((student) => {
        targets.push({
          id: `${student.id}-${courseId}`,
          name: student.name,
          subtitle: course?.title,
          userId: student.id,
          courseId,
          scope: 'DIRECT',
          role: UserRole.STUDENT
        });
      });
    });
    return targets;
  }, [courses, instructorCourses, user, users]);

  const courseGroupTargets = useMemo(() => {
    if (!user || user.role !== UserRole.INSTRUCTOR) return [];
    return instructorCourses.map((course) => ({
      id: `${course.id}-group`,
      name: course.title,
      subtitle: 'Course group',
      courseId: course.id,
      scope: 'COURSE_GROUP' as MessagingScope,
      role: 'COURSE_GROUP' as const
    }));
  }, [instructorCourses, user]);

  const adminTargets = useMemo(() => {
    if (!user || (user.role !== UserRole.ADMIN && user.role !== UserRole.SUPER_ADMIN)) return [];
    return users
      .filter((candidate) => candidate.id !== user.id && candidate.role !== UserRole.ADMIN && candidate.role !== UserRole.SUPER_ADMIN)
      .map((candidate) => ({
        id: `admin-${candidate.id}`,
        name: candidate.name,
        subtitle: candidate.role === UserRole.INSTRUCTOR ? 'Instructor' : 'Student',
        userId: candidate.id,
        scope: 'DIRECT' as MessagingScope,
        role: candidate.role
      }));
  }, [user, users]);

  const adminTarget = useMemo(() => {
    const platformAdmin =
      users.find((candidate) => candidate.role === UserRole.SUPER_ADMIN) ||
      users.find((candidate) => candidate.role === UserRole.ADMIN);
    if (!platformAdmin) return undefined;
    return {
      id: 'system-admin',
      name: platformAdmin.name || 'System Admin',
      subtitle: platformAdmin.role === UserRole.SUPER_ADMIN ? 'Platform Owner' : 'Platform Support',
      userId: platformAdmin.id,
      scope: 'ADMIN' as MessagingScope,
      role: 'ADMIN' as const
    };
  }, [users]);

  const unreadTotal = useMemo(() => conversations.reduce((sum, conversation) => sum + (conversation.unreadCount || 0), 0), [conversations]);

  return {
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
    availableTargets: {
      instructors: instructorsForStudent,
      classmates: classmatesForStudent,
      admin: adminTarget,
      courseGroups: courseGroupTargets,
      students: studentsForInstructor,
      users: adminTargets
    },
    deleteMessage,
    blockUser,
    unblockUser,
    muteConversation
  };
};
