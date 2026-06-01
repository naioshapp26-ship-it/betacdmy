import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Course, CourseModule, CourseContentItem, RewardsConfig, Certificate, CourseProgress, User, RewardGrantRequest, RewardActivityType, AttendanceRecord, CourseTest, TestQuestion, AssignmentSubmission } from '../types';
import { ArrowLeft, ArrowRight, PlayCircle, FileText, CheckCircle, Lock, Send, Video, Calendar, MessageCircle, AlertCircle, Monitor, Download, Image as ImageIcon, File, RefreshCw, Clock, Brain, Award, LogOut, X, BookOpen } from 'lucide-react';
import { gradeAssignment, fetchResolvedAIConfig } from '../services/geminiService';
import CertificateDisplay from './Certificate';
import DOMPurify from 'dompurify';
import { useNotification } from './NotificationContext';

const resolveModuleId = (module: CourseModule | undefined, moduleIndex: number) => {
    if (!module) {
        return `module-${moduleIndex + 1}`;
    }
    return typeof module.id === 'string' && module.id.trim().length
        ? module.id.trim()
        : `module-${moduleIndex + 1}`;
};

const resolveItemId = (module: CourseModule | undefined, item: CourseContentItem, moduleIndex: number, itemIndex: number) => {
    const moduleId = resolveModuleId(module, moduleIndex);
    if (!item) {
        return `${moduleId}-item-${itemIndex + 1}`;
    }
    return typeof item.id === 'string' && item.id.trim().length
        ? item.id.trim()
        : `${moduleId}-item-${itemIndex + 1}`;
};

const buildRewardKey = (rewardType: RewardActivityType, courseId: string, moduleId?: string, itemId?: string) => {
    const segments = [rewardType, courseId];
    if (moduleId) segments.push(moduleId);
    if (itemId) segments.push(itemId);
    return segments.join('|');
};

interface CoursePlayerProps {
    course: Course;
    onBack: () => void;
    t: any;
    lang: 'ar' | 'en';
    onReward?: (reward: RewardGrantRequest) => Promise<void> | void;
    rewardsConfig?: RewardsConfig;
    user?: User;
    progressRecord?: CourseProgress;
    onProgressSync?: (payload: { courseProgress: CourseProgress; user: User }) => void;
    onAttendanceSync?: (record: AttendanceRecord) => void;
}

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
};

const ATTENDANCE_HEARTBEAT_SECONDS = 60;

export const CoursePlayer: React.FC<CoursePlayerProps> = ({ course, onBack, t, lang, onReward, rewardsConfig, user, progressRecord, onProgressSync, onAttendanceSync }) => {
    const { notify } = useNotification();
    const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
    // Deep copy to allow local mutation of state (completion/scores/time)
    const [modules, setModules] = useState<CourseModule[]>(() => course.modules || []);
    
    // UI State for exams/assignments
    const [answerTexts, setAnswerTexts] = useState<{[itemId: string]: string}>({});
    const [gradingStates, setGradingStates] = useState<{[itemId: string]: boolean}>({});
    const [aiAvailable, setAiAvailable] = useState(false);
    const [pendingTestReview, setPendingTestReview] = useState<{ pre: boolean; post: boolean }>({ pre: false, post: false });
    
    // Certificate state
    const [showCertificate, setShowCertificate] = useState(false);
    const [certificate, setCertificate] = useState<Certificate | null>(null);
    const [isSaveAndExitPending, setIsSaveAndExitPending] = useState(false);
    const [isFinishingCourse, setIsFinishingCourse] = useState(false);
    const [isLessonDrawerOpen, setIsLessonDrawerOpen] = useState(false);

    const preCourseTest = course.preCourseTest;
    const postCourseTest = course.postCourseTest;
    const hasPreCourseTest = Boolean(preCourseTest?.enabled && preCourseTest?.questions?.length);
    const hasPostCourseTest = Boolean(postCourseTest?.enabled && postCourseTest?.questions?.length);

    const [preTestAnswers, setPreTestAnswers] = useState<Record<string, string>>({});
    const [postTestAnswers, setPostTestAnswers] = useState<Record<string, string>>({});
    const [preTestScore, setPreTestScore] = useState<number | null>(null);
    const [postTestScore, setPostTestScore] = useState<number | null>(null);
    const [preTestCompleted, setPreTestCompleted] = useState(false);
    const [postTestCompleted, setPostTestCompleted] = useState(false);
    const [isPreTestSubmitting, setIsPreTestSubmitting] = useState(false);
    const [isPostTestSubmitting, setIsPostTestSubmitting] = useState(false);

    // Time Tracking Refs
    const timerRef = useRef<any>(null);
    const pendingSecondsRef = useRef(0);
    const completionCountRef = useRef(0);
    const lastSubmittedCompletionRef = useRef(0);
    const pendingMilestoneEventsRef = useRef(0);
    const completedLessonMilestonesRef = useRef<Set<string>>(new Set());

    const registerAttendanceMilestone = React.useCallback((_eventType?: string) => {
        pendingMilestoneEventsRef.current += 1;
    }, []);

    const maybeTrackLessonCompletion = React.useCallback((module: CourseModule | undefined, moduleIndex: number) => {
        if (!module || !module.items?.length) return;
        const moduleId = resolveModuleId(module, moduleIndex);
        if (module.items.every(item => item.completed) && !completedLessonMilestonesRef.current.has(moduleId)) {
            completedLessonMilestonesRef.current.add(moduleId);
            registerAttendanceMilestone('LESSON_COMPLETED');
        }
    }, [registerAttendanceMilestone]);

    const buildCompletedItemIds = React.useCallback((nextModules: CourseModule[]) => {
        const ids: string[] = [];
        const seen = new Set<string>();
        nextModules.forEach((module, moduleIndex) => {
            module.items.forEach((item, itemIndex) => {
                if (!item.completed) return;
                const resolvedId = resolveItemId(module, item, moduleIndex, itemIndex);
                if (!seen.has(resolvedId)) {
                    seen.add(resolvedId);
                    ids.push(resolvedId);
                }
            });
        });
        return ids;
    }, []);

    const persistProgress = React.useCallback(async (
        nextModules: CourseModule[],
        options?: {
            preTestCompleted?: boolean;
            postTestCompleted?: boolean;
            preTestScore?: number | null;
            postTestScore?: number | null;
        }
    ): Promise<boolean> => {
        if (!user) return false;
        const lessonItems = nextModules.reduce((sum, module) => sum + module.items.length, 0);
        const testItems = (hasPreCourseTest ? 1 : 0) + (hasPostCourseTest ? 1 : 0);
        const totalItems = lessonItems + testItems;
        if (!totalItems) return false;

        const resolvedPreTestCompleted = typeof options?.preTestCompleted === 'boolean'
            ? options.preTestCompleted
            : preTestCompleted;
        const resolvedPostTestCompleted = typeof options?.postTestCompleted === 'boolean'
            ? options.postTestCompleted
            : postTestCompleted;
        const resolvedPreTestScore = typeof options?.preTestScore === 'number'
            ? options.preTestScore
            : preTestScore;
        const resolvedPostTestScore = typeof options?.postTestScore === 'number'
            ? options.postTestScore
            : postTestScore;

        const completedItemIds = buildCompletedItemIds(nextModules);
        if (hasPreCourseTest && resolvedPreTestCompleted) {
            completedItemIds.push('pre-course-test');
        }
        if (hasPostCourseTest && resolvedPostTestCompleted) {
            completedItemIds.push('post-course-test');
        }
        try {
            const response = await fetch(`/api/users/${user.id}/progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseId: course.id,
                    totalItems,
                    completedItemIds,
                    preTestCompleted: resolvedPreTestCompleted,
                    postTestCompleted: resolvedPostTestCompleted,
                    preTestScore: resolvedPreTestScore,
                    postTestScore: resolvedPostTestScore
                })
            });
            if (!response.ok) {
                console.warn('Progress sync failed', response.statusText);
                return false;
            }
            const payload = await response.json();
            if (payload?.courseProgress && payload?.user) {
                onProgressSync?.({
                    courseProgress: payload.courseProgress as CourseProgress,
                    user: payload.user as User
                });
            }
            return true;
        } catch (error) {
            console.error('Progress sync error:', error);
            return false;
        }
    }, [buildCompletedItemIds, course.id, hasPostCourseTest, hasPreCourseTest, onProgressSync, postTestCompleted, postTestScore, preTestCompleted, preTestScore, user]);

    const grantRewardForActivity = React.useCallback((config: { rewardType: RewardActivityType; amount?: number; reason: string; moduleIndex?: number; itemIndex?: number; }) => {
        if (!onReward) {
            return;
        }
        const amount = Number(config.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
            return;
        }

        let resolvedModuleId: string | undefined;
        let resolvedItemId: string | undefined;

        if (typeof config.moduleIndex === 'number') {
            const module = modules[config.moduleIndex];
            if (module) {
                resolvedModuleId = resolveModuleId(module, config.moduleIndex);
                if (typeof config.itemIndex === 'number') {
                    const item = module.items[config.itemIndex];
                    if (item) {
                        resolvedItemId = resolveItemId(module, item, config.moduleIndex, config.itemIndex);
                    }
                }
            }
        }

        const rewardKey = buildRewardKey(config.rewardType, course.id, resolvedModuleId, resolvedItemId);
        onReward({
            amount,
            reason: config.reason,
            rewardType: config.rewardType,
            rewardKey,
            courseId: course.id,
            moduleId: resolvedModuleId,
            itemId: resolvedItemId
        });
    }, [course.id, modules, onReward]);

    useEffect(() => {
        setModules(course.modules || []);
        setCurrentModuleIndex(0);
    }, [course]);

    useEffect(() => {
        let isActive = true;
        fetchResolvedAIConfig()
            .then((config) => {
                if (isActive) {
                    setAiAvailable(Boolean(config?.apiKey));
                }
            })
            .catch(() => {
                if (isActive) {
                    setAiAvailable(false);
                }
            });
        return () => {
            isActive = false;
        };
    }, []);

    useEffect(() => {
        setPreTestAnswers({});
        setPostTestAnswers({});
        setPreTestScore(null);
        setPostTestScore(null);
    }, [course.id]);

    useEffect(() => {
        const nextPreScore = typeof progressRecord?.preTestScore === 'number' ? progressRecord.preTestScore : null;
        const nextPostScore = typeof progressRecord?.postTestScore === 'number' ? progressRecord.postTestScore : null;
        const nextPreCompleted = Boolean(progressRecord?.preTestCompleted)
            && typeof nextPreScore === 'number'
            && nextPreScore >= 70;
        const nextPostCompleted = Boolean(progressRecord?.postTestCompleted)
            && typeof nextPostScore === 'number'
            && nextPostScore >= 70;

        setPreTestCompleted(nextPreCompleted);
        setPostTestCompleted(nextPostCompleted);
        setPreTestScore(nextPreScore);
        setPostTestScore(nextPostScore);
    }, [progressRecord?.preTestCompleted, progressRecord?.postTestCompleted, progressRecord?.preTestScore, progressRecord?.postTestScore, course.id]);

    useEffect(() => {
        setAnswerTexts({});
        setGradingStates({});
        setPendingTestReview({ pre: false, post: false });
    }, [course.id]);

    useEffect(() => {
        pendingMilestoneEventsRef.current = 0;
        completedLessonMilestonesRef.current.clear();
    }, [course.id]);

    useEffect(() => {
        setIsLessonDrawerOpen(false);
    }, [currentModuleIndex]);

    const currentModule = modules[currentModuleIndex];
    const hasModules = Boolean(currentModule);
    const isLastModule = modules.length > 0 ? currentModuleIndex === modules.length - 1 : false;
    const courseTestCount = (hasPreCourseTest ? 1 : 0) + (hasPostCourseTest ? 1 : 0);
    const totalCourseItems = modules.reduce((acc, module) => acc + module.items.length, 0) + courseTestCount;
    const completedCourseItems = modules.reduce(
        (acc, module) => acc + module.items.filter(item => item.completed).length,
        0
    ) + (preTestCompleted ? 1 : 0) + (postTestCompleted ? 1 : 0);
    const courseCompletionPercent = totalCourseItems > 0
        ? Math.round((completedCourseItems / totalCourseItems) * 100)
        : 0;
    const isCourseFullyComplete = totalCourseItems > 0 && completedCourseItems === totalCourseItems;
    const areLessonsComplete = modules.length
        ? modules.every(module => module.items.every(item => item.completed))
        : true;
    const canAccessLessons = !hasPreCourseTest || preTestCompleted;
    const shouldShowPreTest = hasPreCourseTest && !preTestCompleted;
    const shouldShowPostTest = hasPostCourseTest && areLessonsComplete && !postTestCompleted;
    const playerStage = shouldShowPreTest ? 'PRE_TEST' : shouldShowPostTest ? 'POST_TEST' : 'LESSONS';

    const getItemStateKey = React.useCallback((moduleIndex: number, itemIndex: number, moduleOverride?: CourseModule, itemOverride?: CourseContentItem) => {
        const moduleRef = moduleOverride ?? modules[moduleIndex];
        if (!moduleRef) {
            return `module-${moduleIndex + 1}-item-${itemIndex + 1}`;
        }
        const itemRef = itemOverride ?? moduleRef.items[itemIndex];
        if (!itemRef) {
            return `module-${moduleIndex + 1}-item-${itemIndex + 1}`;
        }
        const resolved = resolveItemId(moduleRef, itemRef, moduleIndex, itemIndex);
        if (resolved?.trim().length) {
            return resolved.trim();
        }
        if (itemRef.id?.trim().length) {
            return itemRef.id.trim();
        }
        return `module-${moduleIndex + 1}-item-${itemIndex + 1}`;
    }, [modules]);

    useEffect(() => {
        completionCountRef.current = completedCourseItems;
    }, [completedCourseItems]);

    useEffect(() => {
        pendingSecondsRef.current = 0;
        lastSubmittedCompletionRef.current = completionCountRef.current;
    }, [course.id]);

    const flushAttendanceActivity = React.useCallback(async (options?: { force?: boolean }) => {
        if (!user?.id) {
            return;
        }
        const seconds = pendingSecondsRef.current;
        const completionDelta = Math.max(0, completionCountRef.current - lastSubmittedCompletionRef.current);
        const milestoneDelta = pendingMilestoneEventsRef.current;
        if (!options?.force && seconds < ATTENDANCE_HEARTBEAT_SECONDS && completionDelta <= 0 && milestoneDelta <= 0) {
            return;
        }
        if (seconds <= 0 && completionDelta <= 0 && milestoneDelta <= 0) {
            return;
        }

        pendingSecondsRef.current = 0;
        lastSubmittedCompletionRef.current = completionCountRef.current;
        pendingMilestoneEventsRef.current = 0;

        try {
            const response = await fetch('/api/attendance/activity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    courseId: course.id,
                    durationSeconds: seconds,
                    completedItemsDelta: completionDelta,
                    milestoneEventsDelta: milestoneDelta
                })
            });
            if (!response.ok) {
                console.warn('Attendance sync failed', response.statusText);
                return;
            }
            const payload = await response.json();
            onAttendanceSync?.(payload as AttendanceRecord);
        } catch (error) {
            console.error('Attendance sync error:', error);
        }
    }, [course.id, onAttendanceSync, user?.id]);

    useEffect(() => {
        return () => {
            flushAttendanceActivity({ force: true });
        };
    }, [flushAttendanceActivity]);

    // Time Tracking Logic
    useEffect(() => {
        // Clear existing timer when module changes
        if (timerRef.current) clearInterval(timerRef.current);

        if (!modules.length) {
            return () => {
                if (timerRef.current) clearInterval(timerRef.current);
            };
        }

        timerRef.current = setInterval(() => {
            setModules(prevModules => {
                if (!prevModules.length) return prevModules;
                const newModules = [...prevModules];
                const activeModule = newModules[currentModuleIndex];
                if (!activeModule) {
                    return prevModules;
                }
                activeModule.timeSpent = (activeModule.timeSpent || 0) + 1;
                return newModules;
            });
            pendingSecondsRef.current += 1;
            if (pendingSecondsRef.current >= ATTENDANCE_HEARTBEAT_SECONDS) {
                flushAttendanceActivity().catch(() => undefined);
            }
        }, 1000);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [currentModuleIndex, modules.length, flushAttendanceActivity]);

    // A module (Lesson) is only complete if ALL its items are marked complete.
    // Progression: Can we go to next module?
    const isCurrentModuleComplete = currentModule ? currentModule.items.every(item => item.completed) : false;
    const canProceed = Boolean(currentModule && isCurrentModuleComplete);

    const handleNext = () => {
        if (!canAccessLessons) {
            const message = t.preCourseTestRequiredMessage || (lang === 'ar' ? 'أكمل اختبار ما قبل الدورة للبدء في الدروس.' : 'Complete the pre-course test to access lessons.');
            if (typeof window !== 'undefined') {
                notify('warning', message);
            } else {
                console.warn(message);
            }
            return;
        }
        if (!canProceed || isLastModule || !modules.length) {
            return;
        }
        if (modules[currentModuleIndex + 1]) {
            setCurrentModuleIndex(prev => prev + 1);
        }
    };

    const handleModuleClick = (index: number) => {
        if (!modules[index]) return;
        if (!canAccessLessons) {
            const message = t.preCourseTestRequiredMessage || (lang === 'ar' ? 'أكمل اختبار ما قبل الدورة للبدء في الدروس.' : 'Complete the pre-course test to access lessons.');
            if (typeof window !== 'undefined') {
                notify('warning', message);
            } else {
                console.warn(message);
            }
            return;
        }
        // Unlock logic: previous module must be effectively complete
        const prevModule = modules[index - 1];
        const isPrevComplete = !prevModule || prevModule.items.every(i => i.completed);
        
        if (index === 0 || isPrevComplete) {
            setCurrentModuleIndex(index);
        }
    };

    const handleSaveAndExit = async () => {
        if (isSaveAndExitPending) return;
        if (!modules.length && !hasPreCourseTest && !hasPostCourseTest) {
            onBack();
            return;
        }
        setIsSaveAndExitPending(true);
        await flushAttendanceActivity({ force: true });
        const success = await persistProgress(modules);
        setIsSaveAndExitPending(false);
        if (!success) {
            const message = t.saveProgressFailed || 'Unable to save progress. Please try again.';
            if (typeof window !== 'undefined') {
                notify('error', message);
            } else {
                console.warn(message);
            }
            return;
        }
        onBack();
    };

    const checkAndGenerateCertificate = async () => {
        if (!user) return;
        
        // Check if course is fully complete (lessons + required tests)
        const allComplete = isCourseFullyComplete;
        
        if (allComplete) {
            try {
                const response = await fetch('/api/certificates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: user.id,
                        courseId: course.id,
                        type: 'COMPLETION'
                    })
                });
                
                if (response.ok) {
                    const cert = await response.json();
                    setCertificate(cert);
                    setShowCertificate(true);
                }
            } catch (error) {
                console.error('Certificate generation error:', error);
            }
        }
    };

    const handleFinishCourse = async () => {
        if (!isCourseFullyComplete || isFinishingCourse) {
            return;
        }
        if (hasPostCourseTest && !postTestCompleted) {
            const message = t.postCourseTestRequiredMessage || (lang === 'ar' ? 'أكمل اختبار ما بعد الدورة لإنهاء الدورة.' : 'Complete the post-course test to finish the course.');
            if (typeof window !== 'undefined') {
                notify('warning', message);
            } else {
                console.warn(message);
            }
            return;
        }
        setIsFinishingCourse(true);
        await flushAttendanceActivity({ force: true });
        const success = await persistProgress(modules);
        if (!success) {
            setIsFinishingCourse(false);
            const message = t.saveProgressFailed || 'Unable to save progress. Please try again.';
            if (typeof window !== 'undefined') {
                notify('error', message);
            } else {
                console.warn(message);
            }
            return;
        }
        try {
            const completionBonus = rewardsConfig?.lessonCompletion || 0;
            if (completionBonus > 0) {
                grantRewardForActivity({
                    rewardType: 'COURSE_COMPLETION',
                    amount: completionBonus,
                    reason: t.courseCompletionReward || 'Course completion bonus'
                });
            }
            await checkAndGenerateCertificate();
        } finally {
            setIsFinishingCourse(false);
        }
    };

    const handleMarkItemComplete = async (moduleIndex: number, itemIndex: number) => {
        const updatedModules = [...modules];
        const module = updatedModules[moduleIndex];
        if (!module) return;
        const item = module.items[itemIndex];
        
        if (!item.completed) {
            item.completed = true;
            registerAttendanceMilestone('ITEM_COMPLETED');
            setModules(updatedModules);
            maybeTrackLessonCompletion(module, moduleIndex);
            
            // Award credits for Lesson/Video/Text
            if (rewardsConfig) {
                grantRewardForActivity({
                    rewardType: 'LESSON_COMPLETION',
                    amount: rewardsConfig.lessonCompletion,
                    reason: t.lessonReward || 'Lesson completion reward',
                    moduleIndex,
                    itemIndex
                });
            }

            await persistProgress(updatedModules);
            await flushAttendanceActivity({ force: true });
        }
    };

    const submitAssignmentSubmission = React.useCallback(async (payload: Record<string, any>) => {
        try {
            const response = await fetch('/api/assignment-submissions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept-Language': lang === 'ar' ? 'ar' : 'en'
                },
                body: JSON.stringify(payload)
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || t.assignmentSubmitFailed || 'Failed to submit assignment.');
            }
            return data as AssignmentSubmission;
        } catch (error) {
            const message = error instanceof Error ? error.message : (t.assignmentSubmitFailed || 'Failed to submit assignment.');
            notify('error', message);
            return null;
        }
    }, [lang, notify, t.assignmentSubmitFailed]);

    const refreshSubmissionSnapshot = React.useCallback(async () => {
        if (!user?.id || !course?.id) return;
        try {
            const response = await fetch(`/api/assignment-submissions?studentId=${encodeURIComponent(user.id)}&courseId=${encodeURIComponent(course.id)}`);
            if (!response.ok) return;
            const data = await response.json().catch(() => []);
            if (!Array.isArray(data)) return;

            setModules((prevModules) => {
                const nextModules = prevModules.map((module) => ({
                    ...module,
                    items: module.items.map((item) => ({ ...item }))
                }));
                const itemIndexMap = new Map<string, { moduleIndex: number; itemIndex: number }>();
                nextModules.forEach((module, moduleIndex) => {
                    module.items.forEach((item, itemIndex) => {
                        const resolvedId = resolveItemId(module, item, moduleIndex, itemIndex);
                        if (resolvedId) {
                            itemIndexMap.set(resolvedId, { moduleIndex, itemIndex });
                        }
                    });
                });

                (data as AssignmentSubmission[]).forEach((submission) => {
                    if (submission.submissionType !== 'COURSE_ITEM' || !submission.itemId) return;
                    const mapping = itemIndexMap.get(submission.itemId);
                    if (!mapping) return;
                    const target = nextModules[mapping.moduleIndex]?.items[mapping.itemIndex];
                    if (!target) return;
                    target.gradingStatus = submission.status;
                    target.lastAttemptDate = submission.updatedAt || submission.createdAt || target.lastAttemptDate;
                    if (submission.status === 'GRADED') {
                        target.score = typeof submission.score === 'number' ? submission.score : target.score;
                        target.feedback = submission.feedback || target.feedback;
                        if (typeof submission.score === 'number') {
                            target.completed = submission.score >= 70;
                        }
                    }
                });
                return nextModules;
            });

            const testPending = { pre: false, post: false };
            let nextPreScore: number | null = preTestScore;
            let nextPostScore: number | null = postTestScore;
            (data as AssignmentSubmission[]).forEach((submission) => {
                if (submission.submissionType !== 'COURSE_TEST' || !submission.testType) return;
                if (submission.status === 'PENDING') {
                    if (submission.testType === 'pre') testPending.pre = true;
                    if (submission.testType === 'post') testPending.post = true;
                }
                if (submission.status === 'GRADED' && typeof submission.score === 'number') {
                    if (submission.testType === 'pre') nextPreScore = submission.score;
                    if (submission.testType === 'post') nextPostScore = submission.score;
                }
            });
            setPendingTestReview(testPending);
            if (nextPreScore !== preTestScore) {
                setPreTestScore(nextPreScore);
                setPreTestCompleted(typeof nextPreScore === 'number' && nextPreScore >= 70);
            }
            if (nextPostScore !== postTestScore) {
                setPostTestScore(nextPostScore);
                setPostTestCompleted(typeof nextPostScore === 'number' && nextPostScore >= 70);
            }
        } catch (error) {
            console.warn('Failed to load submissions', error);
        }
    }, [course?.id, preTestScore, postTestScore, user?.id]);

    useEffect(() => {
        refreshSubmissionSnapshot();
    }, [refreshSubmissionSnapshot]);

    const submitExam = async (item: CourseContentItem, moduleIndex: number, itemIndex: number) => {
        const itemKey = getItemStateKey(moduleIndex, itemIndex, modules[moduleIndex], item);
        const text = answerTexts[itemKey] || '';
        if (!text.trim() || !item.question) return;
        if (!user?.id) {
            notify('error', t.sessionExpired || (lang === 'ar' ? 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.' : 'Session expired. Please log in again.'));
            return;
        }

        registerAttendanceMilestone(item.type === 'QUIZ' ? 'QUIZ_SUBMITTED' : 'ASSIGNMENT_SUBMITTED');
        setGradingStates(prev => ({...prev, [itemKey]: true}));
        const shouldAutoGrade = aiAvailable && item.autoGrade !== false;

        if (!shouldAutoGrade) {
            const submission = await submitAssignmentSubmission({
                studentId: user?.id,
                courseId: course.id,
                itemId: itemKey,
                submissionType: 'COURSE_ITEM',
                answer: text,
                prompt: item.question,
                rubric: item.gradingRubric,
                metadata: {
                    itemTitle: item.title,
                    moduleTitle: modules[moduleIndex]?.title || null,
                    type: item.type
                }
            });
            setGradingStates(prev => ({...prev, [itemKey]: false}));
            if (!submission) {
                return;
            }

            const updatedModules = [...modules];
            const module = updatedModules[moduleIndex];
            if (!module) return;
            const targetItem = module.items[itemIndex];
            if (!targetItem) return;

            targetItem.gradingStatus = 'PENDING';
            targetItem.lastAttemptDate = new Date().toLocaleDateString();
            targetItem.feedback = t.manualReviewPending || (lang === 'ar'
                ? 'تم إرسال الإجابة للمراجعة اليدوية. سيتم إشعارك عند الانتهاء.'
                : 'Submitted for manual review. You will be notified once grading is complete.');
            targetItem.score = undefined;
            targetItem.completed = false;

            setModules(updatedModules);
            await persistProgress(updatedModules);
            await flushAttendanceActivity({ force: true });
            notify('success', t.manualReviewSubmitted || (lang === 'ar' ? 'تم إرسال الإجابة للمراجعة اليدوية.' : 'Submitted for manual review.'));
            return;
        }

        const result = await gradeAssignment(item.question, text, item.gradingRubric, lang);
        setGradingStates(prev => ({...prev, [itemKey]: false}));

        if (result?.feedback === 'AI Grading Failed' || result?.feedback === 'API Key missing.') {
            const submission = await submitAssignmentSubmission({
                studentId: user?.id,
                courseId: course.id,
                itemId: itemKey,
                submissionType: 'COURSE_ITEM',
                answer: text,
                prompt: item.question,
                rubric: item.gradingRubric,
                metadata: {
                    itemTitle: item.title,
                    moduleTitle: modules[moduleIndex]?.title || null,
                    type: item.type
                }
            });
            if (!submission) {
                return;
            }
            const updatedModules = [...modules];
            const module = updatedModules[moduleIndex];
            if (!module) return;
            const targetItem = module.items[itemIndex];
            if (!targetItem) return;
            targetItem.gradingStatus = 'PENDING';
            targetItem.lastAttemptDate = new Date().toLocaleDateString();
            targetItem.feedback = t.aiFallbackManualReview || (lang === 'ar'
                ? 'تعذر التصحيح بالذكاء الاصطناعي. تم إرسال الإجابة للمراجعة اليدوية.'
                : 'AI grading failed. Submitted for manual review.');
            targetItem.score = undefined;
            targetItem.completed = false;
            setModules(updatedModules);
            await persistProgress(updatedModules);
            await flushAttendanceActivity({ force: true });
            notify('warning', t.aiFallbackManualReview || (lang === 'ar'
                ? 'تعذر التصحيح بالذكاء الاصطناعي. تم إرسال الإجابة للمراجعة اليدوية.'
                : 'AI grading failed. Submitted for manual review.'));
            return;
        }

        const updatedModules = [...modules];
        const module = updatedModules[moduleIndex];
        if (!module) return;
        const targetItem = module.items[itemIndex];
        if (!targetItem) return;
        
        targetItem.score = result.score;
        targetItem.feedback = result.feedback;
        targetItem.gradingStatus = 'GRADED';
        targetItem.lastAttemptDate = new Date().toLocaleDateString();

        submitAssignmentSubmission({
            studentId: user?.id,
            courseId: course.id,
            itemId: itemKey,
            submissionType: 'COURSE_ITEM',
            answer: text,
            prompt: item.question,
            rubric: item.gradingRubric,
            status: 'GRADED',
            score: result.score,
            feedback: result.feedback,
            metadata: {
                itemTitle: item.title,
                moduleTitle: modules[moduleIndex]?.title || null,
                type: item.type
            }
        }).catch(() => null);

        if (result.score >= 70) {
            if (!targetItem.completed) {
                targetItem.completed = true;
                registerAttendanceMilestone('ITEM_COMPLETED');
                if (rewardsConfig) {
                    const rewardType: RewardActivityType = item.type === 'QUIZ' ? 'QUIZ_PASS' : 'ASSIGNMENT_SUBMISSION';
                    const rewardAmount = item.type === 'QUIZ' ? rewardsConfig.quizPass : rewardsConfig.assignmentSubmission;
                    const rewardReason = item.type === 'QUIZ' ? (t.quizReward || 'Quiz reward') : (t.assignmentReward || 'Assignment reward');
                    grantRewardForActivity({
                        rewardType,
                        amount: rewardAmount,
                        reason: rewardReason,
                        moduleIndex,
                        itemIndex
                    });
                }
            }
        } else {
            targetItem.completed = false;
        }
        
        setModules(updatedModules);
        maybeTrackLessonCompletion(module, moduleIndex);
        await persistProgress(updatedModules);
        await flushAttendanceActivity({ force: true });
    };

    // Helper for directional icons
    const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;
    const ForwardIcon = lang === 'ar' ? ArrowLeft : ArrowRight;

    const headerTitle = playerStage === 'PRE_TEST'
        ? (t.preCourseTest || 'Pre-course Test')
        : playerStage === 'POST_TEST'
            ? (t.postCourseTest || 'Post-course Test')
            : (currentModule?.title || t.noLessonsYet || 'No lessons yet');
    const headerSubtitle = playerStage === 'PRE_TEST'
        ? (t.preCourseTestIntro || (lang === 'ar' ? 'أكمل اختبار ما قبل الدورة لفتح الدروس.' : 'Complete the pre-course test to unlock lessons.'))
        : playerStage === 'POST_TEST'
            ? (t.postCourseTestIntro || (lang === 'ar' ? 'أكمل اختبار ما بعد الدورة لإنهاء الدورة.' : 'Complete the post-course test to finish the course.'))
            : (currentModule ? t.completeAllItems : t.courseComingSoon || 'New lessons will appear here once published.');

    // Render attachment based on type
    const renderAttachment = (attachment: string, type: 'PDF' | 'PPT' | 'IMAGE' | 'VIDEO' | undefined) => {
        if (!attachment) return null;
        
        if (type === 'IMAGE') {
            return <img src={attachment} alt="Attachment" className="max-w-full h-auto rounded-lg mb-4 border border-zinc-200" />;
        }
        if (type === 'PDF') {
            return (
                <div className="mb-4">
                    <iframe src={attachment} className="w-full h-64 border border-zinc-300 rounded bg-white" title="PDF Attachment"></iframe>
                    <a href={attachment} download="attachment.pdf" className="text-xs text-blue-600 hover:underline mt-1 inline-block flex items-center gap-1">
                        <Download className="h-3 w-3" /> {t.download} PDF
                    </a>
                </div>
            );
        }
        if (type === 'PPT') {
            return (
                <div className="bg-orange-50 p-4 rounded-lg border border-orange-200 mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Monitor className="h-6 w-6 text-orange-500" />
                        <span className="text-sm font-medium text-orange-800">{t.typePpt}</span>
                    </div>
                    <a href={attachment} download="presentation.pptx" className="bg-white border border-orange-300 text-orange-700 px-3 py-1 rounded text-xs hover:bg-orange-100">
                        {t.download}
                    </a>
                </div>
            );
        }
        return null;
    };

    const getTestQuestionKey = (question: TestQuestion, index: number, prefix: 'pre' | 'post') => {
        const raw = typeof question.id === 'string' ? question.id.trim() : '';
        return raw.length ? raw : `${prefix}-question-${index + 1}`;
    };

    const normalizeAnswer = (value: string | number | undefined | null) =>
        value === undefined || value === null ? '' : String(value).trim().toLowerCase();

    const handleSubmitCourseTest = async (test: CourseTest | undefined, testType: 'pre' | 'post') => {
        if (!test?.questions?.length) return;
        const answers = testType === 'pre' ? preTestAnswers : postTestAnswers;
        const setScore = testType === 'pre' ? setPreTestScore : setPostTestScore;
        const setCompleted = testType === 'pre' ? setPreTestCompleted : setPostTestCompleted;
        const setSubmitting = testType === 'pre' ? setIsPreTestSubmitting : setIsPostTestSubmitting;
        const isSubmitting = testType === 'pre' ? isPreTestSubmitting : isPostTestSubmitting;
        const isPendingReview = testType === 'pre' ? pendingTestReview.pre : pendingTestReview.post;
        const scoringRubric = test.aiGradingRubric;

        if (isSubmitting) return;
        if (isPendingReview) return;
        if (!user?.id) {
            notify('error', t.sessionExpired || (lang === 'ar' ? 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.' : 'Session expired. Please log in again.'));
            return;
        }

        const unanswered = test.questions.filter((question, index) => {
            const key = getTestQuestionKey(question, index, testType);
            const answer = answers[key];
            return !answer || !answer.trim();
        });

        if (unanswered.length) {
            const message = t.completeTestQuestions || (lang === 'ar' ? 'يرجى الإجابة على جميع الأسئلة قبل الإرسال.' : 'Please answer all questions before submitting.');
            if (typeof window !== 'undefined') {
                notify('warning', message);
            } else {
                console.warn(message);
            }
            return;
        }

        setSubmitting(true);
        try {
            const answersSnapshot: Record<string, string> = {};
            const gradedResults: { score: number; feedback: string }[] = [];
            let requiresManualReview = false;

            for (let index = 0; index < test.questions.length; index += 1) {
                const question = test.questions[index];
                const key = getTestQuestionKey(question, index, testType);
                const answer = answers[key] || '';
                answersSnapshot[key] = answer;
                let score = 0;
                let feedback = '';

                if (question.type === 'MULTIPLE_CHOICE') {
                    if (typeof question.correctAnswer === 'number') {
                        score = Number(answer) === question.correctAnswer ? 100 : 0;
                    } else if (typeof question.correctAnswer === 'string') {
                        const normalizedCorrect = normalizeAnswer(question.correctAnswer);
                        const selectedOption = Number.isFinite(Number(answer)) && Array.isArray(question.options)
                            ? question.options?.[Number(answer)]
                            : answer;
                        score = normalizeAnswer(selectedOption) === normalizedCorrect ? 100 : 0;
                    } else {
                        score = 0;
                    }
                } else if (question.type === 'SHORT_ANSWER' && question.correctAnswer !== undefined && question.correctAnswer !== null) {
                    score = normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer) ? 100 : 0;
                } else {
                    if (!aiAvailable) {
                        requiresManualReview = true;
                    } else {
                        const result = await gradeAssignment(question.question, answer, scoringRubric, lang);
                        if (result?.feedback === 'AI Grading Failed' || result?.feedback === 'API Key missing.') {
                            requiresManualReview = true;
                        } else {
                            score = result.score;
                            feedback = result.feedback || '';
                        }
                    }
                }

                gradedResults.push({ score, feedback });
            }

            if (requiresManualReview) {
                const submission = await submitAssignmentSubmission({
                    studentId: user?.id,
                    courseId: course.id,
                    submissionType: 'COURSE_TEST',
                    answer: JSON.stringify(answersSnapshot),
                    prompt: testType === 'pre' ? 'pre-course-test' : 'post-course-test',
                    rubric: scoringRubric,
                    metadata: {
                        testType,
                        itemTitle: testType === 'pre'
                            ? (t.preCourseTest || 'Pre-course Test')
                            : (t.postCourseTest || 'Post-course Test'),
                        questionCount: test.questions.length
                    }
                });
                if (submission) {
                    setPendingTestReview((prev) => ({ ...prev, [testType]: true }));
                    const message = t.testSubmittedForReview || (lang === 'ar'
                        ? 'تم إرسال الاختبار للمراجعة اليدوية.'
                        : 'Test submitted for manual review.');
                    notify('success', message);
                }
                return;
            }

            const averageScore = Math.round(
                gradedResults.reduce((sum, result) => sum + (Number.isFinite(result.score) ? result.score : 0), 0) / test.questions.length
            );
            const passed = averageScore >= 70;

            setScore(averageScore);
            setCompleted(passed);

            const progressSaved = await persistProgress(modules, {
                preTestCompleted: testType === 'pre' ? passed : preTestCompleted,
                postTestCompleted: testType === 'post' ? passed : postTestCompleted,
                preTestScore: testType === 'pre' ? averageScore : preTestScore,
                postTestScore: testType === 'post' ? averageScore : postTestScore
            });

            if (!progressSaved) {
                setCompleted(false);
                const message = t.saveProgressFailed || 'Unable to save progress. Please try again.';
                if (typeof window !== 'undefined') {
                    notify('error', message);
                } else {
                    console.warn(message);
                }
                return;
            }

            submitAssignmentSubmission({
                studentId: user?.id,
                courseId: course.id,
                submissionType: 'COURSE_TEST',
                status: 'GRADED',
                score: averageScore,
                feedback: '',
                prompt: testType === 'pre' ? 'pre-course-test' : 'post-course-test',
                metadata: {
                    testType,
                    itemTitle: testType === 'pre'
                        ? (t.preCourseTest || 'Pre-course Test')
                        : (t.postCourseTest || 'Post-course Test'),
                    questionCount: test.questions.length
                }
            }).catch(() => null);

            if (user?.id) {
                try {
                    await fetch('/api/exams/results', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId: user.id,
                            courseId: course.id,
                            itemId: testType === 'pre' ? 'pre-course-test' : 'post-course-test',
                            score: averageScore,
                            passed,
                            moduleTitle: testType === 'pre'
                                ? (t.preCourseTest || 'Pre-course Test')
                                : (t.postCourseTest || 'Post-course Test'),
                            itemTitle: testType === 'pre'
                                ? (t.preCourseTest || 'Pre-course Test')
                                : (t.postCourseTest || 'Post-course Test')
                        })
                    });
                } catch (error) {
                    console.warn('Course test notification failed', error);
                }
            }

            const message = passed
                ? t.courseTestPassed || (lang === 'ar' ? 'تم اجتياز الاختبار بنجاح.' : 'Test passed successfully.')
                : t.courseTestFailed || (lang === 'ar' ? 'لم يتم اجتياز الاختبار. حاول مرة أخرى.' : 'Test not passed. Please try again.');
            if (typeof window !== 'undefined') {
                notify(passed ? 'success' : 'warning', message);
            } else {
                console.warn(message);
            }

            if (testType === 'pre' && passed) {
                onBack();
            }
        } finally {
            setSubmitting(false);
        }
    };

    const renderCourseTest = (test: CourseTest | undefined, testType: 'pre' | 'post') => {
        if (!test?.questions?.length) {
            return (
                <div className="ds-card text-center text-zinc-500">
                    {t.noQuestionsYet || (lang === 'ar' ? 'لا توجد أسئلة بعد.' : 'No questions yet.')}
                </div>
            );
        }

        const answers = testType === 'pre' ? preTestAnswers : postTestAnswers;
        const setAnswers = testType === 'pre' ? setPreTestAnswers : setPostTestAnswers;
        const score = testType === 'pre' ? preTestScore : postTestScore;
        const isSubmitting = testType === 'pre' ? isPreTestSubmitting : isPostTestSubmitting;
        const isPendingReview = testType === 'pre' ? pendingTestReview.pre : pendingTestReview.post;
        const title = testType === 'pre' ? (t.preCourseTest || 'Pre-course Test') : (t.postCourseTest || 'Post-course Test');
        const description = testType === 'pre'
            ? (t.preCourseTestIntro || (lang === 'ar' ? 'أكمل اختبار ما قبل الدورة لفتح الدروس.' : 'Complete the pre-course test to unlock lessons.'))
            : (t.postCourseTestIntro || (lang === 'ar' ? 'أكمل اختبار ما بعد الدورة لإنهاء الدورة.' : 'Complete the post-course test to finish the course.'));
        const passed = typeof score === 'number' && score >= 70;
        const showRetry = typeof score === 'number' && !passed;

        return (
            <div className="ds-card shadow-sm">
                <div className="mb-6">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="ds-icon-container ds-icon-red">
                            <FileText className="h-6 w-6" />
                        </div>
                        <h3 className="ds-section-title">{title}</h3>
                    </div>
                    <p className="ds-description">{description}</p>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
                        {t.passingScore || 'Passing Score'}: 70
                    </div>
                </div>

                {typeof score === 'number' && (
                    <div className={`mb-6 rounded-lg border px-4 py-3 ${passed ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        <div className="flex items-center gap-2 font-semibold">
                            {passed ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                            <span>{passed ? (t.testPassed || 'Test Passed') : (t.testFailed || 'Test Not Passed')}</span>
                        </div>
                        <div className="mt-1 text-sm">{t.score || 'Score'}: {score}/100</div>
                    </div>
                )}

                {isPendingReview && (
                    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
                        <div className="flex items-center gap-2 font-semibold">
                            <AlertCircle className="h-4 w-4" />
                            <span>{t.testPendingReview || (lang === 'ar' ? 'الاختبار قيد المراجعة اليدوية.' : 'Test is awaiting manual review.')}</span>
                        </div>
                        <div className="mt-1 text-sm">{t.manualReviewPending || (lang === 'ar' ? 'سيتم إشعارك عند الانتهاء.' : 'You will be notified once grading is complete.')}</div>
                    </div>
                )}

                <div className="space-y-6">
                    {test.questions.map((question, index) => {
                        const key = getTestQuestionKey(question, index, testType);
                        const answerValue = answers[key] || '';
                        return (
                            <div key={key} className="ds-card-compact">
                                <div className="text-xs font-bold text-zinc-400 mb-2 uppercase">
                                    {t.questionNumber || (lang === 'ar' ? 'السؤال' : 'Question')} {index + 1}
                                </div>
                                <div className="text-lg font-semibold text-zinc-900 mb-4">{question.question}</div>

                                {question.type === 'MULTIPLE_CHOICE' && Array.isArray(question.options) ? (
                                    <div className="space-y-3">
                                        {question.options.map((option, optionIndex) => (
                                            <label key={`${key}-option-${optionIndex}`} className="flex items-center gap-3 text-sm text-zinc-700">
                                                <input
                                                    type="radio"
                                                    name={key}
                                                    value={optionIndex}
                                                    checked={String(answerValue) === String(optionIndex)}
                                                    onChange={(event) => setAnswers(prev => ({ ...prev, [key]: event.target.value }))}
                                                    className="h-4 w-4 text-red-600 border-zinc-300 focus:ring-red-500"
                                                />
                                                <span>{option}</span>
                                            </label>
                                        ))}
                                    </div>
                                ) : (
                                    <textarea
                                        className="w-full p-3 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 min-h-[120px]"
                                        placeholder={t.testAnswerPlaceholder || (lang === 'ar' ? 'اكتب إجابتك هنا...' : 'Type your answer here...')}
                                        value={answerValue}
                                        onChange={(event) => setAnswers(prev => ({ ...prev, [key]: event.target.value }))}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="mt-8 flex flex-col sm:flex-row sm:justify-end gap-3">
                    <button
                        onClick={() => handleSubmitCourseTest(test, testType)}
                        disabled={isSubmitting || isPendingReview}
                        className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-red-900 text-white font-semibold hover:bg-red-950 disabled:opacity-60"
                    >
                        {isSubmitting ? (
                            <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                {t.aiGrading || 'AI Grading...'}
                            </>
                        ) : isPendingReview ? (
                            <>
                                <AlertCircle className="h-4 w-4" />
                                {t.awaitingReview || (lang === 'ar' ? 'بانتظار المراجعة' : 'Awaiting Review')}
                            </>
                        ) : (
                            <>
                                <Send className="h-4 w-4" />
                                {showRetry
                                    ? (t.retryTest || (lang === 'ar' ? 'إعادة المحاولة' : 'Retry Test'))
                                    : (t.submitTest || (lang === 'ar' ? 'إرسال الاختبار' : 'Submit Test'))}
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    const renderItem = (item: CourseContentItem, index: number) => {
        const isPassed = item.completed;

        switch (item.type) {
            case 'VIDEO':
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                         <div className="flex items-center gap-3 mb-4">
                            <span className="bg-red-100 text-red-700 p-2 rounded-lg"><Video className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                         </div>
                        <div className="bg-black rounded-lg overflow-hidden relative w-full shadow-lg aspect-video mb-4">
                            {item.content && (item.content.startsWith('http') || item.content.startsWith('//')) ? (
                                <iframe 
                                    className="absolute top-0 left-0 w-full h-full"
                                    src={item.content} 
                                    title={item.title} 
                                    frameBorder="0" 
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                    allowFullScreen
                                ></iframe>
                            ) : (
                                <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center text-white">
                                    <PlayCircle className="h-16 w-16 mx-auto mb-4 opacity-75" />
                                    <p>{t.videoUnavailable}</p>
                                </div>
                            )}
                        </div>
                        {!item.completed && (
                            <button 
                                onClick={() => handleMarkItemComplete(currentModuleIndex, index)}
                                className="bg-red-900 text-white px-6 py-2 rounded-full shadow hover:bg-red-950 flex items-center gap-2 text-sm font-medium"
                            >
                                <CheckCircle className="h-4 w-4" /> {t.markWatched}
                            </button>
                        )}
                        {item.completed && <div className="text-green-600 flex items-center gap-2 font-medium text-sm"><CheckCircle className="h-4 w-4" /> {t.watched}</div>}
                    </div>
                );
            case 'TEXT':
                const sanitizedContent = item.content
                    ? DOMPurify.sanitize(item.content, {
                        ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'div'],
                        ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
                    })
                    : '';
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                         <div className="flex items-center gap-3 mb-4">
                            <span className="bg-emerald-100 text-emerald-700 p-2 rounded-lg"><FileText className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                         </div>
                        <div 
                            className="lesson-content prose prose-lg max-w-none text-zinc-600 bg-white p-6 rounded-lg border border-zinc-200 mb-4"
                            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                        />
                        {!item.completed && (
                            <button 
                                onClick={() => handleMarkItemComplete(currentModuleIndex, index)}
                                className="bg-red-900 text-white px-6 py-2 rounded shadow hover:bg-red-950 text-sm font-medium"
                            >
                                {t.markRead}
                            </button>
                        )}
                         {item.completed && <div className="text-green-600 flex items-center gap-2 font-medium text-sm"><CheckCircle className="h-4 w-4" /> {t.read}</div>}
                    </div>
                );
            case 'PDF':
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="bg-red-100 text-red-700 p-2 rounded-lg"><File className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                        </div>
                        <div className="bg-zinc-100 rounded-lg p-1 mb-4 h-[500px]">
                            {item.content ? (
                                <iframe src={item.content} className="w-full h-full rounded border border-zinc-300 bg-white" title="PDF Viewer"></iframe>
                            ) : (
                                <div className="h-full flex items-center justify-center text-zinc-400">{t.pdfContentMissing || (lang === 'ar' ? 'محتوى PDF غير متوفر' : 'PDF content unavailable')}</div>
                            )}
                        </div>
                        <div className="flex justify-between items-center">
                            {item.content && (
                                <a href={item.content} download={`${item.title}.pdf`} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                                    <Download className="h-4 w-4" /> {t.download}
                                </a>
                            )}
                            {!item.completed ? (
                                <button 
                                    onClick={() => handleMarkItemComplete(currentModuleIndex, index)}
                                    className="bg-red-900 text-white px-6 py-2 rounded shadow hover:bg-red-950 text-sm font-medium"
                                >
                                    {t.markRead}
                                </button>
                            ) : (
                                <div className="text-green-600 flex items-center gap-2 font-medium text-sm"><CheckCircle className="h-4 w-4" /> {t.read}</div>
                            )}
                        </div>
                    </div>
                );
            case 'PPT':
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="bg-orange-100 text-orange-700 p-2 rounded-lg"><Monitor className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                        </div>
                        <div className="bg-orange-50 p-8 rounded-lg border border-orange-200 mb-4 text-center">
                            <Monitor className="h-16 w-16 text-orange-400 mx-auto mb-4" />
                            <h4 className="font-bold text-orange-900 mb-2">{t.typePpt}</h4>
                            <p className="text-sm text-orange-700 mb-4">{t.presentationDownloadPrompt || (lang === 'ar' ? 'يرجى تنزيل العرض التقديمي لعرضه.' : 'Please download the presentation to view it.')}</p>
                            {item.content && (
                                <a 
                                    href={item.content} 
                                    download={`${item.title}.pptx`}
                                    className="inline-flex items-center gap-2 bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-700 transition-colors shadow-sm"
                                >
                                    <Download className="h-4 w-4" /> {t.download}
                                </a>
                            )}
                        </div>
                        <div className="flex justify-end">
                            {!item.completed ? (
                                <button 
                                    onClick={() => handleMarkItemComplete(currentModuleIndex, index)}
                                    className="bg-red-900 text-white px-6 py-2 rounded shadow hover:bg-red-950 text-sm font-medium"
                                >
                                    {t.markRead}
                                </button>
                            ) : (
                                <div className="text-green-600 flex items-center gap-2 font-medium text-sm"><CheckCircle className="h-4 w-4" /> {t.read}</div>
                            )}
                        </div>
                    </div>
                );
            case 'IMAGE':
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="bg-purple-100 text-purple-700 p-2 rounded-lg"><ImageIcon className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                        </div>
                        <div className="mb-4 bg-zinc-50 border border-zinc-200 rounded-lg p-2">
                            {item.content ? (
                                <img src={item.content} alt={item.title} className="w-full h-auto rounded shadow-sm" />
                            ) : (
                                <div className="h-48 flex items-center justify-center text-zinc-400">{t.imageMissing || (lang === 'ar' ? 'الصورة غير متوفرة' : 'Image missing')}</div>
                            )}
                        </div>
                        <div className="flex justify-end">
                            {!item.completed ? (
                                <button 
                                    onClick={() => handleMarkItemComplete(currentModuleIndex, index)}
                                    className="bg-red-900 text-white px-6 py-2 rounded shadow hover:bg-red-950 text-sm font-medium"
                                >
                                    {t.markWatched}
                                </button>
                            ) : (
                                <div className="text-green-600 flex items-center gap-2 font-medium text-sm"><CheckCircle className="h-4 w-4" /> {t.watched}</div>
                            )}
                        </div>
                    </div>
                );
            case 'INTERACTIVE_EXERCISE':
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                         <div className="flex items-center gap-3 mb-4">
                            <span className="bg-purple-100 text-purple-700 p-2 rounded-lg"><Brain className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                            <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded uppercase">{t.interactiveExercise || (lang === 'ar' ? 'تمرين تفاعلي' : 'Interactive Exercise')}</span>
                         </div>
                         
                         {item.question && (
                             <div className="bg-purple-50 p-4 rounded-lg border border-purple-200 mb-4">
                                <h4 className="text-sm font-bold text-purple-900 mb-2">{t.objective || 'Learning Objective'}</h4>
                                <p className="text-purple-800">{item.question}</p>
                             </div>
                         )}
                         
                         <div className="prose max-w-none bg-white p-6 rounded-lg border border-zinc-200 mb-4">
                            {item.content || (t.exerciseContentMissing || (lang === 'ar' ? 'لم يتم توفير محتوى التمرين.' : 'No exercise content provided.'))}
                         </div>

                         {!item.completed ? (
                             <div className="flex items-center gap-3">
                                 <button 
                                    onClick={() => handleMarkItemComplete(currentModuleIndex, index)}
                                    className="bg-purple-600 text-white px-6 py-2 rounded shadow hover:bg-purple-700 text-sm font-medium"
                                 >
                                    {t.markComplete || 'Mark Complete'}
                                 </button>
                                 <p className="text-xs text-zinc-500">{t.completeAfterExercise || 'Complete this exercise to continue'}</p>
                             </div>
                         ) : (
                             <div className="text-green-600 flex items-center gap-2 font-medium text-sm">
                                 <CheckCircle className="h-4 w-4" /> {t.completed || 'Completed'}
                             </div>
                         )}
                    </div>
                );
            case 'QUIZ':
            case 'ASSIGNMENT': {
                const responseKey = getItemStateKey(currentModuleIndex, index, currentModule, item);
                const answerValue = answerTexts[responseKey] || '';
                const isGrading = Boolean(gradingStates[responseKey]);
                const isPendingReview = item.gradingStatus === 'PENDING';
                const shouldAutoGrade = aiAvailable && item.autoGrade !== false;
                const hasAnswer = answerValue.trim().length > 0;
                return (
                    <div key={item.id} className="mb-12 border-b border-zinc-200 pb-8 last:border-0">
                         <div className="flex items-center gap-3 mb-4">
                            <span className="bg-amber-100 text-amber-700 p-2 rounded-lg"><FileText className="h-5 w-5" /></span>
                            <h3 className="text-xl font-bold text-zinc-900">{item.title}</h3>
                         </div>
                         
                         <div className="bg-zinc-50 p-6 rounded-lg border border-zinc-200 mb-6">
                            <div className="flex justify-between mb-2">
                                <h4 className="text-sm font-bold text-zinc-500 uppercase">{t.questionInstructions}</h4>
                                <span className="text-xs font-bold bg-zinc-200 px-2 py-1 rounded text-zinc-600">{t.passingScore}: 70</span>
                            </div>
                            
                            {/* Render Attachment if present */}
                            {item.attachment && (
                                <div className="mb-4 border-b border-zinc-200 pb-4">
                                    <p className="text-xs font-bold text-zinc-500 mb-2 uppercase">{t.referenceMaterial || (lang === 'ar' ? 'مواد مرجعية' : 'Reference Material')}</p>
                                    {renderAttachment(item.attachment, item.attachmentType)}
                                </div>
                            )}

                            <p className="font-medium text-lg text-zinc-800">{item.question}</p>
                         </div>

                         {!isPassed ? (
                             <div className="animate-fade-in">
                                {item.score !== undefined && (
                                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                                        <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0" />
                                        <div>
                                            <p className="font-bold text-red-800">{t.examFailed} - {item.score}/100</p>
                                            <p className="text-sm text-red-600">{t.tryAgainMessage || (lang === 'ar' ? 'يرجى المحاولة مرة أخرى.' : 'Please try again.')}</p>
                                            {item.feedback && <p className="text-xs text-zinc-600 mt-2 bg-white/50 p-2 rounded border border-red-100 italic">"{item.feedback}"</p>}
                                        </div>
                                    </div>
                                )}

                                {isPendingReview && (
                                    <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
                                        <AlertCircle className="h-6 w-6 text-amber-500 flex-shrink-0" />
                                        <div>
                                            <p className="font-bold text-amber-800">
                                                {t.manualReviewPending || (lang === 'ar'
                                                    ? 'تم إرسال الإجابة للمراجعة اليدوية.'
                                                    : 'Submitted for manual review.')}
                                            </p>
                                            <p className="text-sm text-amber-700">
                                                {t.awaitingReview || (lang === 'ar'
                                                    ? 'بانتظار المراجعة.'
                                                    : 'Awaiting review.')}
                                            </p>
                                        </div>
                                    </div>
                                )}
                                
                                <textarea 
                                    className="w-full p-4 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 h-32"
                                    placeholder={t.testAnswerPlaceholder || (lang === 'ar' ? 'اكتب إجابتك هنا...' : 'Type your answer here...')}
                                    value={answerValue}
                                    onChange={(e) => setAnswerTexts(prev => ({...prev, [responseKey]: e.target.value}))}
                                ></textarea>
                                
                                <div className="mt-4 flex justify-end gap-2">
                                    {item.score !== undefined && (
                                        <button 
                                            onClick={() => submitExam(item, currentModuleIndex, index)}
                                            className="bg-zinc-100 text-zinc-700 px-4 py-2 rounded-lg font-medium hover:bg-zinc-200 flex items-center gap-2 text-sm border border-zinc-300"
                                            disabled={isGrading || !hasAnswer || isPendingReview}
                                        >
                                            <RefreshCw className={`h-4 w-4 ${isGrading ? 'animate-spin' : ''}`} /> {t.reGrade}
                                        </button>
                                    )}
                                    <button 
                                        onClick={() => submitExam(item, currentModuleIndex, index)}
                                        disabled={isGrading || !hasAnswer || isPendingReview}
                                        className="bg-red-900 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-950 disabled:opacity-50 flex items-center gap-2 text-sm"
                                    >
                                        {isGrading
                                            ? t.aiGrading
                                            : isPendingReview
                                                ? (t.awaitingReview || (lang === 'ar' ? 'بانتظار المراجعة' : 'Awaiting Review'))
                                                : (shouldAutoGrade
                                                    ? t.submitAnswer
                                                    : (t.submitForReview || (lang === 'ar' ? 'إرسال للمراجعة' : 'Submit for Review'))
                                                )}
                                        <Send className="h-4 w-4 rtl:rotate-180" />
                                    </button>
                                </div>
                             </div>
                         ) : (
                             <div className="bg-green-50 p-6 rounded-lg border border-green-200 text-center animate-fade-in">
                                 <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
                                 <h3 className="text-lg font-bold text-green-800 mb-1">{t.examPassed}</h3>
                                 <p className="text-green-700 font-medium mb-2">{t.score}: {item.score}/100</p>
                                 {item.feedback && <p className="text-sm text-zinc-500 mt-2 max-w-lg mx-auto italic">"{item.feedback}"</p>}
                                 
                                 {/* Re-grade button for passed items */}
                                 <button 
                                    onClick={() => submitExam(item, currentModuleIndex, index)}
                                    className="mt-4 bg-white text-green-700 border border-green-200 px-4 py-2 rounded-lg font-medium hover:bg-green-50 flex items-center gap-2 text-sm mx-auto"
                                    disabled={isGrading || !hasAnswer || isPendingReview}
                                >
                                    <RefreshCw className={`h-4 w-4 ${isGrading ? 'animate-spin' : ''}`} /> {t.reGrade}
                                </button>
                             </div>
                         )}
                    </div>
                );
            }
            default: return null;
        }
    };

    const renderModuleEntries = (afterSelect?: () => void) => {
        return modules.map((module, index) => {
            const prevModule = modules[index - 1];
            const isPrevComplete = !prevModule || prevModule.items.every(i => i.completed);
            const isLocked = !canAccessLessons || (index > 0 && !isPrevComplete);
            const isActive = currentModuleIndex === index;
            const isModuleComplete = module.items.every(i => i.completed);

            const handleSelect = () => {
                if (isLocked) {
                    if (!canAccessLessons) {
                        const message = t.preCourseTestRequiredMessage || (lang === 'ar' ? 'أكمل اختبار ما قبل الدورة للبدء في الدروس.' : 'Complete the pre-course test to access lessons.');
                        if (typeof window !== 'undefined') {
                            notify('warning', message);
                        } else {
                            console.warn(message);
                        }
                    }
                    return;
                }
                handleModuleClick(index);
                afterSelect?.();
            };

            return (
                <div
                    key={module.id || `module-${index}`}
                    onClick={handleSelect}
                    className={`px-4 py-3 cursor-pointer border-l-4 rtl:border-l-0 rtl:border-r-4 transition-colors text-start ${
                        isActive ? 'bg-red-50 border-red-600' : 'border-transparent hover:bg-zinc-50'
                    } ${isLocked ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                >
                    <div className="flex items-center gap-3">
                        <div className="mt-0.5">
                            {isModuleComplete ? (
                                <CheckCircle className="h-5 w-5 text-green-500" />
                            ) : isLocked ? (
                                <Lock className="h-5 w-5 text-zinc-400" />
                            ) : (
                                <div className={`h-5 w-5 rounded-full border-2 ${isActive ? 'border-red-600' : 'border-zinc-300'}`}></div>
                            )}
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between items-start gap-2">
                                <p className={`text-sm font-medium ${isActive ? 'text-red-900' : 'text-zinc-700'}`}>{module.title}</p>
                                {(module.timeSpent || 0) > 0 && (
                                    <span className="text-[10px] text-zinc-400 font-mono whitespace-nowrap bg-zinc-100 px-1 rounded">
                                        {Math.floor((module.timeSpent || 0) / 60)}m
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5">
                                {module.items.length} {module.items.length === 1 ? 'item' : 'items'}
                            </p>
                        </div>
                    </div>
                </div>
            );
        });
    };

    return (
        <div className="flex flex-col md:flex-row md:h-[calc(100vh-64px)] min-h-screen bg-zinc-100">
            {/* Sidebar (Lessons) */}
            <div className="w-80 ds-card border-r border-zinc-200 flex flex-col overflow-y-auto hidden md:flex rounded-none">
                <div className="p-4 border-b border-zinc-200">
                    <button onClick={onBack} className="flex items-center text-zinc-500 hover:text-zinc-800 mb-4 transition-colors">
                        <BackIcon className="h-4 w-4 me-2" /> {t.backToDashboard}
                    </button>
                    <h2 className="font-bold text-lg leading-tight text-start">{course.title}</h2>
                    {course.duration && (
                        <div className="flex items-center gap-1 text-xs text-zinc-500 mt-1">
                            <Clock className="h-3 w-3" />
                            <span>{course.duration}h duration</span>
                        </div>
                    )}
                    {/* Progress Bar (calculated by total completed items vs total items) */}
                    <div className="mt-2 text-xs text-zinc-500">
                        <div className="flex items-center gap-2">
                            <span>{courseCompletionPercent}% {t.complete}</span>
                            <div className="flex-1 h-2 bg-zinc-100 rounded-full">
                                <div className="h-2 bg-red-900 rounded-full" style={{ width: `${courseCompletionPercent}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Modules List */}
                <div className="flex-1 py-2">
                    {modules.length ? renderModuleEntries() : (
                        <div className="px-4 py-8 text-center text-sm text-zinc-500">
                            {t.noLessonsYet || 'No lessons are available yet.'}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="bg-white border-b border-zinc-200 p-4 shadow-sm z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-zinc-800">{headerTitle}</h2>
                        <p className="text-sm text-zinc-500">{headerSubtitle}</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <button
                            onClick={() => setIsLessonDrawerOpen(true)}
                            className="ds-btn ds-btn-secondary text-sm md:hidden"
                        >
                            <BookOpen className="h-4 w-4" /> {t.viewLessons || (lang === 'ar' ? 'عرض الدروس' : 'Lessons')}
                        </button>
                        <div className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1.5 rounded-full text-sm font-bold border border-red-100">
                            <Clock className="h-4 w-4" />
                            <span>{formatTime(currentModule?.timeSpent || 0)}</span>
                        </div>
                        <button
                            onClick={handleSaveAndExit}
                            disabled={isSaveAndExitPending}
                            className="ds-btn ds-btn-secondary disabled:opacity-60"
                        >
                            {isSaveAndExitPending ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <LogOut className="h-4 w-4" />
                            )}
                            <span>{isSaveAndExitPending ? (t.savingProgress || 'Saving...') : (t.saveAndExit || 'Save and Exit')}</span>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 sm:p-8">
                    {playerStage === 'PRE_TEST' && renderCourseTest(preCourseTest, 'pre')}
                    {playerStage === 'POST_TEST' && renderCourseTest(postCourseTest, 'post')}
                    {playerStage === 'LESSONS' && (
                        currentModule ? (
                            currentModule.items.map((item, idx) => renderItem(item, idx))
                        ) : (
                            <div className="ds-card border-dashed text-center text-zinc-500">
                                <p className="ds-section-subtitle text-zinc-700">{t.noLessonsYet || 'No lessons are available yet.'}</p>
                                <p className="ds-description mt-2">{t.courseComingSoon || 'Your instructor is still preparing this course content.'}</p>
                            </div>
                        )
                    )}
                </div>

                {/* Footer Navigation */}
                <div className="bg-white border-t border-zinc-200 p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center z-10">
                    {playerStage === 'LESSONS' ? (
                        <>
                            <button 
                                onClick={() => handleModuleClick(currentModuleIndex - 1)}
                                disabled={currentModuleIndex === 0 || !hasModules}
                                className="w-full sm:w-auto px-4 py-2 text-zinc-600 font-medium hover:text-zinc-900 disabled:opacity-50 flex items-center gap-2 justify-center"
                            >
                                <BackIcon className="h-4 w-4" /> {t.previous}
                            </button>
                            
                            <div className="flex items-center gap-4">
                                {!canProceed && !isLastModule && (
                                     <span className="text-xs text-zinc-500 flex items-center gap-1">
                                         <Lock className="h-3 w-3" /> {t.unlockNextLesson}
                                     </span>
                                )}
                                {!isLastModule ? (
                                    <button 
                                        onClick={handleNext}
                                        disabled={!canProceed || !hasModules}
                                        className={`w-full sm:w-auto px-6 py-2 rounded-lg font-medium flex items-center gap-2 justify-center transition-all ${
                                            !canProceed || !hasModules
                                            ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' 
                                            : 'bg-red-900 text-white hover:bg-red-950 shadow-md transform hover:scale-105'
                                        }`}
                                    >
                                        {t.nextLesson} <ForwardIcon className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleFinishCourse}
                                        disabled={!isCourseFullyComplete || isFinishingCourse}
                                        className={`w-full sm:w-auto px-6 py-2 rounded-lg font-medium flex items-center gap-2 justify-center transition-all ${
                                            !isCourseFullyComplete || isFinishingCourse
                                                ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                                                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-md'
                                        }`}
                                    >
                                        {isFinishingCourse ? (
                                            <>
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                                {t.savingProgress || 'Saving...'}
                                            </>
                                        ) : (
                                            <>
                                                {t.finishCourse} <Award className="h-4 w-4" />
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="w-full text-center text-sm text-zinc-500">
                            {playerStage === 'PRE_TEST'
                                ? (t.preCourseTestRequiredMessage || (lang === 'ar' ? 'أكمل اختبار ما قبل الدورة لبدء الدروس.' : 'Complete the pre-course test to start lessons.'))
                                : (t.postCourseTestRequiredMessage || (lang === 'ar' ? 'أكمل اختبار ما بعد الدورة لإنهاء الدورة.' : 'Complete the post-course test to finish the course.'))}
                        </div>
                    )}
                </div>
            </div>

            {isLessonDrawerOpen && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setIsLessonDrawerOpen(false)}></div>
                    <div className="absolute inset-x-0 bottom-0 ds-card rounded-t-3xl shadow-2xl max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="ds-section-subtitle flex items-center gap-2">
                                <div className="ds-icon-container ds-icon-red">
                                    <BookOpen className="h-5 w-5" />
                                </div>
                                {t.viewLessons || (lang === 'ar' ? 'عرض الدروس' : 'Lessons')}
                            </h3>
                            <button onClick={() => setIsLessonDrawerOpen(false)} className="p-2 rounded-full text-zinc-500 hover:bg-zinc-100" aria-label={t.close || 'Close'}>
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-1">
                            {modules.length ? renderModuleEntries(() => setIsLessonDrawerOpen(false)) : (
                                <div className="text-center text-sm text-zinc-500 py-8">
                                    {t.noLessonsYet || 'No lessons are available yet.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
            
            {/* Certificate Modal */}
            {showCertificate && certificate && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="ds-card shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto relative">
                        <div className="p-8">
                            <div className="flex items-start justify-between gap-3 mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="ds-icon-container ds-icon-red">
                                        <Award className="h-8 w-8" />
                                    </div>
                                    <h2 className="ds-page-title">{t.congratulations || 'Congratulations!'}</h2>
                                </div>
                                <button
                                    onClick={() => setShowCertificate(false)}
                                    className="p-2 rounded-full hover:bg-zinc-100 text-zinc-500"
                                    aria-label={t.close || 'Close'}
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <p className="ds-description mb-6">
                                {t.courseCompletionCertificateIntro || 'You have successfully completed the course. Here is your certificate of completion:'}
                            </p>
                            <CertificateDisplay 
                                certificate={certificate}
                                studentName={user?.name || 'Student'}
                                courseName={course.title}
                                courseLevel={course.level}
                                t={t}
                                lang={lang}
                                onClose={() => setShowCertificate(false)}
                            />
                            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                                <button 
                                    onClick={() => setShowCertificate(false)}
                                    className="ds-btn ds-btn-secondary w-full"
                                >
                                    {t.close || 'Close'}
                                </button>
                                <button 
                                    onClick={() => {
                                        setShowCertificate(false);
                                        onBack();
                                    }}
                                    className="ds-btn ds-btn-primary w-full"
                                >
                                    {t.backToDashboard || 'Back to Dashboard'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .lesson-content h1,
                .lesson-content h2,
                .lesson-content h3 {
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                    font-weight: 700;
                    color: #18181b;
                }
                .lesson-content h1 {
                    font-size: 2em;
                    line-height: 1.2;
                }
                .lesson-content h2 {
                    font-size: 1.5em;
                    line-height: 1.3;
                }
                .lesson-content h3 {
                    font-size: 1.17em;
                    line-height: 1.4;
                }
                .lesson-content p {
                    margin-bottom: 1rem;
                    line-height: 1.75;
                }
                .lesson-content ul,
                .lesson-content ol {
                    margin-bottom: 1.25rem;
                    padding-left: 2em;
                }
                .lesson-content ul {
                    list-style: disc;
                }
                .lesson-content ol {
                    list-style: decimal;
                }
                .lesson-content li {
                    display: list-item;
                    margin: 0.5rem 0;
                }
                .lesson-content a {
                    color: #dc2626;
                    text-decoration: underline;
                }
                .lesson-content a:hover {
                    color: #b91c1c;
                }
                .lesson-content strong,
                .lesson-content b {
                    font-weight: 700;
                }
                .lesson-content em,
                .lesson-content i {
                    font-style: italic;
                }
                .lesson-content u {
                    text-decoration: underline;
                }
            `}</style>
        </div>
    );
};