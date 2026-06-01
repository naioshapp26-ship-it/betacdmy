import React, { useMemo, useState } from 'react';
import { User, Course, AttendanceRecord, PaymentRecord, Certificate, LiveClass, UserRole, CourseProgress } from '../types';
import { ArrowLeft, ArrowRight, Mail, Phone, Calendar, Award, Clock, DollarSign, FileText, CheckCircle, XCircle, AlertCircle, Download, ChevronRight, Camera, Save, X, Eye, EyeOff } from 'lucide-react';
import CertificateDisplay from './Certificate';
import { useNotification } from './NotificationContext';
import PhoneInput, { parsePhoneValue, type PhoneValue } from './PhoneInput';
import { formatPhoneNumberDisplay, getDialCodeFromCountryCode } from '../utils/phone';

interface StudentProfileProps {
    user: User;
    onUpdateUser?: (user: User) => void;
    onBack: () => void;
    t: any;
    lang: 'ar' | 'en';
    courses?: Course[];
    attendance?: AttendanceRecord[];
    coursePayments?: PaymentRecord[];
    certificates?: Certificate[];
    liveClasses?: LiveClass[];
    courseProgress?: CourseProgress[];
    onShowRestrictionModal?: () => void;
}

interface AssessmentResult {
    id: string;
    title: string;
    courseTitle: string;
    score: number;
    date?: string;
    passed: boolean;
    feedback?: string;
}

interface ExamNotificationPayload {
    id: string;
    courseId?: string;
    category?: string;
    message: string;
    metadata?: {
        itemId?: string;
        itemTitle?: string;
        moduleTitle?: string;
        courseTitle?: string;
        score?: number;
        passed?: boolean;
    } | null;
    createdAt?: string;
}

export const StudentProfile: React.FC<StudentProfileProps> = ({ 
    user,
    onBack,
    onUpdateUser,
    t,
    lang,
    courses,
    attendance,
    coursePayments,
    certificates,
    liveClasses,
    courseProgress,
    onShowRestrictionModal
}) => {
    const { notify } = useNotification();
    const isGuest = user.role === UserRole.GUEST;
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'SCHEDULE' | 'ACADEMIC' | 'FINANCIAL'>('OVERVIEW');
    const [isSaving, setIsSaving] = useState(false);
    const [passwordForm, setPasswordForm] = useState({
        currentPassword: '',
        newPassword: '',
        confirmNewPassword: ''
    });
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordError, setPasswordError] = useState<string | null>(null);
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    // Listen for custom event to open Schedule tab
    React.useEffect(() => {
        const handleOpenSchedule = () => setActiveTab('SCHEDULE');
        window.addEventListener('openScheduleTab', handleOpenSchedule);
        return () => window.removeEventListener('openScheduleTab', handleOpenSchedule);
    }, []);
    const [isEditing, setIsEditing] = useState(false);
    const [editForm, setEditForm] = useState<User>(user);
    const [phoneValue, setPhoneValue] = useState<PhoneValue>(parsePhoneValue(user.phone));
    const [showResultModal, setShowResultModal] = useState<AssessmentResult | null>(null);
    const [selectedCertificate, setSelectedCertificate] = useState<Certificate | null>(null);
    const [testResults, setTestResults] = useState<AssessmentResult[]>([]);
    const [isLoadingResults, setIsLoadingResults] = useState(false);
    const [resultsError, setResultsError] = useState<string | null>(null);

    const resolvePhoneValue = (target: User): PhoneValue => {
        const parsed = parsePhoneValue(target.phone);
        const countryCode = (target.phoneCountryCode || '').trim().toUpperCase();
        const dialCode = getDialCodeFromCountryCode(countryCode);
        const phone = (target.phone || '').trim();
        if (!countryCode || !dialCode) return parsed;
        const localNumber = phone.startsWith(dialCode) ? phone.slice(dialCode.length).trim() : parsed.number;
        return {
            countryCode,
            dialCode,
            number: localNumber,
            full: localNumber ? `${dialCode} ${localNumber}` : '',
        };
    };

    React.useEffect(() => {
        setEditForm(user);
        setPhoneValue(resolvePhoneValue(user));
    }, [user]);

    const isStudent = user.role === UserRole.STUDENT || user.role === UserRole.MEMBER;
    const allCourses = courses || [];
    const courseProgressRecords = courseProgress || [];
    const courseMap = useMemo(() => {
        const map: Record<string, Course> = {};
        allCourses.forEach(course => {
            map[course.id] = course;
        });
        return map;
    }, [allCourses]);

    const courseProgressMap = useMemo(() => {
        return courseProgressRecords.reduce<Record<string, CourseProgress>>((acc, record) => {
            acc[record.courseId] = record;
            return acc;
        }, {});
    }, [courseProgressRecords]);

    const enrolledCourses = allCourses.filter(course => user.enrolledCourses?.includes(course.id));
    const attendanceRecords = (attendance || []).filter(record => record.userId === user.id);
    const totalSessions = attendanceRecords.length;
    const presentSessions = attendanceRecords.filter(record => record.status === 'PRESENT').length;
    const attendanceRate = totalSessions ? Math.round((presentSessions / totalSessions) * 100) : 0;
    const fallbackCourseLabel = t?.unknownCourse || 'Course';
    const paymentHistory = useMemo(() => {
        return (coursePayments || [])
            .filter((payment) => payment.studentId === user.id)
            .map((payment) => ({
                ...payment,
                courseTitle: payment.courseTitle || courseMap[payment.courseId]?.title || fallbackCourseLabel
            }))
            .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
    }, [coursePayments, user.id, courseMap, fallbackCourseLabel]);
    const userCertificates = (certificates || [])
        .filter(cert => cert.userId === user.id)
        .map(cert => ({
            ...cert,
            courseTitle: cert.courseTitle || courseMap[cert.courseId]?.title || fallbackCourseLabel
        }));

    const upcomingClasses = enrolledCourses
        .flatMap(course => (course.syncSessions || []).map(date => ({ course: course.title, date })))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const invitedLiveSessions = useMemo(() => {
        if (!liveClasses) return [];
        const now = Date.now();
        const oneHourAgo = now - 60 * 60 * 1000; // 1 hour grace period
        return [...liveClasses]
            .filter(cls => cls.inviteType === 'all' || cls.invites.some(inv => inv.studentId === user.id))
            .filter(cls => new Date(cls.startTime).getTime() >= oneHourAgo) // Only upcoming/recent sessions
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }, [liveClasses, user.id]);

    const formatLiveSessionDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    React.useEffect(() => {
        let isMounted = true;
        const loadExamResults = async () => {
            setIsLoadingResults(true);
            setResultsError(null);
            try {
                const response = await fetch(`/api/users/${user.id}/notifications?limit=100`);
                if (!response.ok) {
                    throw new Error('Failed to load exam results');
                }
                const payload = await response.json();
                const notifications: ExamNotificationPayload[] = Array.isArray(payload.notifications)
                    ? payload.notifications
                    : [];
                const examNotifications = notifications.filter(note =>
                    (note.category || '').toUpperCase() === 'EXAM_RESULT'
                );
                const normalized = examNotifications.map(note => {
                    const metadata = note.metadata || {};
                    const resolvedScore = typeof metadata.score === 'number' ? Math.round(metadata.score) : 0;
                    const resolvedCourseTitle = (note.courseId && courseMap[note.courseId]?.title)
                        || metadata.courseTitle
                        || fallbackCourseLabel;
                    return {
                        id: metadata.itemId || note.id,
                        title: metadata.itemTitle || metadata.moduleTitle || t.assessment || 'Assessment',
                        courseTitle: resolvedCourseTitle,
                        score: resolvedScore,
                        date: note.createdAt,
                        passed: typeof metadata.passed === 'boolean' ? metadata.passed : resolvedScore >= 70,
                        feedback: note.message
                    } as AssessmentResult;
                });
                if (isMounted) {
                    setTestResults(normalized);
                }
            } catch (error) {
                console.error('Failed to load exam results:', error);
                if (isMounted) {
                    setResultsError(t.resultsError || 'Unable to load assessment results right now.');
                    setTestResults([]);
                }
            } finally {
                if (isMounted) {
                    setIsLoadingResults(false);
                }
            }
        };

        loadExamResults();
        return () => {
            isMounted = false;
        };
    }, [user.id, courseMap, fallbackCourseLabel, t.assessment, t.resultsError]);

    const calculateCourseProgress = (course: Course) => {
        const record = courseProgressMap[course.id];
        const modules = course.modules || [];
        const hasPreTest = Boolean(course.preCourseTest?.enabled && course.preCourseTest.questions?.length);
        const hasPostTest = Boolean(course.postCourseTest?.enabled && course.postCourseTest.questions?.length);
        const preTestPassed = hasPreTest
            ? Boolean(record?.preTestCompleted)
                && typeof record?.preTestScore === 'number'
                && record.preTestScore >= 70
            : false;
        const postTestPassed = hasPostTest
            ? Boolean(record?.postTestCompleted)
                && typeof record?.postTestScore === 'number'
                && record.postTestScore >= 70
            : false;

        const completedItemIds = (record?.completedItemIds || [])
            .map(item => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean);
        const completedSet = new Set(completedItemIds);

        const totals = modules.reduce(
            (acc, module, moduleIndex) => {
                const moduleId = typeof module.id === 'string' && module.id.trim().length
                    ? module.id.trim()
                    : `module-${moduleIndex + 1}`;
                module.items.forEach((item, itemIndex) => {
                    const itemId = typeof item.id === 'string' && item.id.trim().length
                        ? item.id.trim()
                        : `${moduleId}-item-${itemIndex + 1}`;
                    acc.items += 1;
                    if (completedSet.has(itemId) || item.completed) {
                        acc.completed += 1;
                    }
                });
                return acc;
            },
            { items: 0, completed: 0 }
        );

        const testCount = (hasPreTest ? 1 : 0) + (hasPostTest ? 1 : 0);
        const completedTests = (preTestPassed ? 1 : 0) + (postTestPassed ? 1 : 0);
        const totalItems = totals.items + testCount;
        const completedItems = totals.completed + completedTests;

        if (!totalItems) return 0;
        return Math.round((completedItems / totalItems) * 100);
    };
    const attendanceDisplay = totalSessions ? `${attendanceRate}%` : 'N/A';
    const attendanceEntries = attendanceRecords.map(record => ({
        ...record,
        courseTitle: record.courseTitle || courseMap[record.courseId]?.title || fallbackCourseLabel
    }));

    const formatCurrency = (value?: number | null) => {
        if (value === null || value === undefined) return 'N/A';
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value));
    };

    const formatDate = (value?: string) => {
        if (!value) return 'N/A';
        return new Date(value).toLocaleDateString();
    };

    const resolvePaymentMethod = (method?: string) => {
        if (!method) return t?.unknown || 'Unknown';
        const normalized = method.toString().toUpperCase();
        switch (normalized) {
            case 'CASH':
                return t?.cashMethodLabel || 'Cash';
            case 'TRANSFER':
                return t?.transferMethodLabel || 'Bank Transfer';
            case 'MANUAL':
                return t?.manualEntryLabel || 'Manual Entry';
            case 'ONLINE':
                return t?.onlineMethodLabel || 'Online';
            default:
                return method;
        }
    };

    const getMethodBadgeClass = (method?: string) => {
        const normalized = method?.toString().toUpperCase();
        if (normalized === 'CASH' || normalized === 'MANUAL') {
            return 'bg-amber-100 text-amber-700';
        }
        if (normalized === 'TRANSFER') {
            return 'bg-blue-100 text-blue-700';
        }
        return 'bg-emerald-100 text-emerald-700';
    };

    const handleSave = async () => {
        // Block guests from saving
        if (isGuest && onShowRestrictionModal) {
            onShowRestrictionModal();
            return;
        }
        
        setIsSaving(true);
        try {
            const response = await fetch(`/api/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    name: editForm.name,
                    email: editForm.email,
                    phone: phoneValue.full || phoneValue.number.trim() || undefined,
                    phoneCountryCode: phoneValue.number.trim() ? phoneValue.countryCode : undefined,
                    avatar: editForm.avatar,
                    gender: editForm.gender || undefined,
                    specialization: editForm.specialization || undefined
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to update profile');
            }
            
            const updatedUser = await response.json();
            if (onUpdateUser) {
                onUpdateUser(updatedUser);
            }
            setEditForm(updatedUser);
            setIsEditing(false);
        } catch (error) {
            console.error('Failed to save profile:', error);
            notify('error', t.profileSaveFailed || 'Failed to save profile. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setEditForm(user);
        setPhoneValue(resolvePhoneValue(user));
        setIsEditing(false);
    };

    const handlePasswordChange = async () => {
        setPasswordError(null);
        setPasswordSuccess(false);
        
        if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmNewPassword) {
            setPasswordError(t.passwordFieldsRequired);
            return;
        }
        
        if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
            setPasswordError(t.passwordsDoNotMatch);
            return;
        }
        
        if (passwordForm.newPassword.length < 6) {
            setPasswordError(t.passwordTooShort);
            return;
        }
        
        try {
            const response = await fetch(`/api/users/${user.id}/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    currentPassword: passwordForm.currentPassword,
                    newPassword: passwordForm.newPassword
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || t.passwordChangeFailed || 'Failed to change password');
            }
            
            setPasswordSuccess(true);
            setPasswordForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
            setTimeout(() => setPasswordSuccess(false), 3000);
        } catch (error: any) {
            setPasswordError(error.message || t.passwordChangeFailed || 'Failed to change password');
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditForm({ ...editForm, avatar: reader.result as string });
            };
            reader.readAsDataURL(file);
        }
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'OVERVIEW':
                return (
                    <div className="space-y-6 animate-fade-in">
                        {/* Stats Row */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm">{t.enrolledCourses}</p>
                                <p className="text-2xl font-bold text-zinc-900">{enrolledCourses.length}</p>
                            </div>
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm">{t.credits}</p>
                                <p className="text-2xl font-bold text-yellow-600">{user.credits}</p>
                            </div>
                            <div className="ds-card-compact">
                                <p className="text-zinc-500 text-sm">{t.attendance}</p>
                                <p className="text-2xl font-bold text-green-600">{attendanceDisplay}</p>
                            </div>
                        </div>

                        {/* Enrolled Courses Progress - Only show if student has enrolled courses */}
                        {enrolledCourses.length > 0 && (
                            <div className="ds-card overflow-hidden">
                                <div className="px-6 py-4 border-b border-zinc-100">
                                    <h3 className="ds-section-title">{t.courseProgress}</h3>
                                </div>
                                <div className="divide-y divide-zinc-100">
                                    {enrolledCourses.map(course => {
                                        const progress = calculateCourseProgress(course);
                                        return (
                                            <div key={course.id} className="p-4 flex items-center justify-between hover:bg-zinc-50">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-12 w-12 rounded-lg bg-zinc-100 overflow-hidden">
                                                        <img src={course.thumbnail} className="h-full w-full object-cover" alt="" />
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-sm text-zinc-900">{course.title}</p>
                                                        <p className="text-xs text-zinc-500">{course.level === 'Beginner' ? t.beginner : course.level === 'Intermediate' ? t.intermediate : course.level === 'Advanced' ? t.advanced : course.level}</p>
                                                    </div>
                                                </div>
                                                <div className="w-32">
                                                    <div className="flex justify-between text-xs mb-1">
                                                        <span>{t.progress || 'Progress'}</span>
                                                        <span className="font-bold">{progress}%</span>
                                                    </div>
                                                    <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                                                        <div className="h-full bg-red-900 rounded-full" style={{width: `${progress}%`}}></div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                );
            case 'SCHEDULE':
                return (
                    <div className="space-y-6 animate-fade-in">
                        <div className="ds-card overflow-hidden">
                            <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center">
                                <h3 className="ds-section-title">{t.upcomingClasses}</h3>
                                <Calendar className="h-5 w-5 text-zinc-400" />
                            </div>
                            <div className="divide-y divide-zinc-100">
                                {upcomingClasses.map((item, idx) => (
                                    <div key={idx} className="p-4 flex items-start gap-4 hover:bg-zinc-50">
                                        <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-center min-w-[60px]">
                                            <p className="text-xs font-bold uppercase">{new Date(item.date).toLocaleString('default', { month: 'short' })}</p>
                                            <p className="text-lg font-bold">{new Date(item.date).getDate()}</p>
                                        </div>
                                        <div>
                                            <p className="font-bold text-zinc-900">{item.course}</p>
                                            <p className="text-sm text-zinc-500 flex items-center gap-1 mt-1">
                                                <Clock className="h-3 w-3" /> 
                                                {item.date}
                                            </p>
                                            <span className="inline-block mt-2 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full">
                                                Live Session
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {upcomingClasses.length === 0 && (
                                    <div className="p-8 text-center text-zinc-500">{t.noUpcomingClasses || 'No upcoming classes scheduled.'}</div>
                                )}
                            </div>
                        </div>

                        <div className="ds-card overflow-hidden">
                            <div className="px-6 py-4 border-b border-zinc-100 flex justify-between items-center">
                                <h3 className="ds-section-title">{t.liveClasses}</h3>
                                <span className="text-xs font-bold text-zinc-500">{invitedLiveSessions.length} {t.sessions || 'sessions'}</span>
                            </div>
                            <div className="divide-y divide-zinc-100">
                                {invitedLiveSessions.length > 0 ? (
                                    invitedLiveSessions.map(session => (
                                        <div key={session.id} className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div>
                                                <p className="font-bold text-zinc-900">{session.topic}</p>
                                                <p className="text-sm text-zinc-500 flex items-center gap-1">
                                                    <Clock className="h-3 w-3" /> {formatLiveSessionDate(session.startTime)}
                                                </p>
                                                <span className="px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[10px] uppercase rounded-full font-bold">{session.platform}</span>
                                            </div>
                                            <a 
                                                href={session.joinUrl} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="text-xs font-bold text-red-600 hover:text-red-700 flex items-center gap-1"
                                            >
                                                {t.joinClassroom} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                                            </a>
                                        </div>
                                    ))
                                ) : (
                                    <div className="p-6 text-center text-zinc-500">{t.noLiveClasses || 'No live classes assigned.'}</div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            case 'ACADEMIC':
                return (
                    <div className="space-y-6 animate-fade-in">
                        {/* Test Results */}
                        <div className="ds-card overflow-hidden">
                            <div className="px-6 py-4 border-b border-zinc-100">
                                <h3 className="ds-section-title">{t.testResults}</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left min-w-[640px]">
                                <thead className="bg-zinc-50 text-zinc-500">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">{t.exam || 'Exam'}</th>
                                        <th className="px-6 py-3 font-medium">{t.course || 'Course'}</th>
                                        <th className="px-6 py-3 font-medium">{t.score}</th>
                                        <th className="px-6 py-3 font-medium">{t.date}</th>
                                        <th className="px-6 py-3 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {isLoadingResults ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-sm text-zinc-500">
                                                {t.loadingResults || 'Loading assessment data...'}
                                            </td>
                                        </tr>
                                    ) : resultsError ? (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-sm text-red-600">
                                                {resultsError}
                                            </td>
                                        </tr>
                                    ) : testResults.length > 0 ? (
                                        testResults.map(result => (
                                            <tr key={result.id}>
                                                <td className="px-6 py-3 text-zinc-900 font-medium">{result.title}</td>
                                                <td className="px-6 py-3 text-zinc-600">{result.courseTitle}</td>
                                                <td className="px-6 py-3">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-bold 
                                                        ${result.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                        {result.score}/100
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 text-zinc-600">{formatDate(result.date)}</td>
                                                <td className="px-6 py-3 text-end">
                                                    <button 
                                                        onClick={() => setShowResultModal(result)}
                                                        className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs font-bold"
                                                    >
                                                        <Eye className="h-3 w-3" /> {t.viewResults}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 text-sm">
                                                {t.noAssessments || 'No assessment results yet.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Certificates */}
                        <div className="ds-card overflow-hidden">
                            <div className="px-6 py-4 border-b border-zinc-100">
                                <h3 className="ds-section-title">{t.certCompletion}</h3>
                            </div>
                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {userCertificates.length > 0 ? (
                                    userCertificates.map(cert => (
                                        <div key={cert.id} className="border border-zinc-200 rounded-lg p-4 flex gap-4 items-center bg-zinc-50 hover:border-red-300 transition-colors">
                                            <div className="ds-icon-container ds-icon-yellow">
                                                <Award className="h-6 w-6" />
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-bold text-zinc-900">{cert.courseTitle}</p>
                                                <p className="text-xs text-zinc-500">{t.issued || 'Issued'}: {formatDate(cert.issueDate)}</p>
                                                {cert.certificationNumber && (
                                                    <p className="text-xs text-zinc-400 font-mono">{cert.certificationNumber}</p>
                                                )}
                                            </div>
                                            <button 
                                                onClick={() => setSelectedCertificate(cert)}
                                                className="text-red-600 hover:text-red-800 font-medium text-sm px-3 py-1 rounded border border-red-200 hover:bg-red-50 transition-colors flex items-center gap-1"
                                            >
                                                <Eye className="h-4 w-4" /> {t.view || 'View'}
                                            </button>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-zinc-500 text-sm italic col-span-2">{t.noCertificates || 'No certificates issued yet.'}</p>
                                )}
                            </div>
                        </div>

                        {/* Attendance Table */}
                        <div className="ds-card overflow-hidden">
                            <div className="px-6 py-4 border-b border-zinc-100">
                                <h3 className="ds-section-title">{t.attendance}</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left min-w-[480px]">
                                <thead className="bg-zinc-50 text-zinc-500">
                                    <tr>
                                        <th className="px-6 py-3 font-medium">{t.date}</th>
                                        <th className="px-6 py-3 font-medium">{t.course || 'Course'}</th>
                                        <th className="px-6 py-3 font-medium">{t.status}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {attendanceEntries.length > 0 ? (
                                        attendanceEntries.map(record => (
                                            <tr key={record.id}>
                                                <td className="px-6 py-3 text-zinc-600">{formatDate(record.date)}</td>
                                                <td className="px-6 py-3 text-zinc-900 font-medium">{record.courseTitle}</td>
                                                <td className="px-6 py-3">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-bold 
                                                        ${record.status === 'PRESENT' ? 'bg-green-100 text-green-700' : 
                                                          record.status === 'ABSENT' ? 'bg-red-100 text-red-700' : 
                                                          'bg-yellow-100 text-yellow-700'}`}>
                                                        {record.status === 'PRESENT' ? t.present : record.status === 'ABSENT' ? t.absent : t.late}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={3} className="px-6 py-8 text-center text-zinc-500 text-sm">
                                                {t.noAttendance || 'No attendance records yet.'}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                );
            case 'FINANCIAL':
                return (
                    <div className="ds-card overflow-hidden animate-fade-in">
                        <div className="px-6 py-4 border-b border-zinc-100">
                            <h3 className="ds-section-title">{t.paymentHistory}</h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left min-w-[640px]">
                            <thead className="bg-zinc-50 text-zinc-500">
                                <tr>
                                    <th className="px-6 py-3 font-medium">{t.invoiceId || 'Receipt'}</th>
                                    <th className="px-6 py-3 font-medium">{t.date}</th>
                                    <th className="px-6 py-3 font-medium">{t.item || 'Item'}</th>
                                    <th className="px-6 py-3 font-medium">{t.amount}</th>
                                    <th className="px-6 py-3 font-medium">{t.paymentMethod || 'Method'}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                    {paymentHistory.length > 0 ? (
                                        paymentHistory.map(payment => (
                                        <tr key={payment.id}>
                                            <td className="px-6 py-3 text-zinc-600 font-mono">{payment.receiptId || payment.id}</td>
                                            <td className="px-6 py-3 text-zinc-600">{formatDate(payment.receivedAt)}</td>
                                                <td className="px-6 py-3 text-zinc-900 font-medium">{payment.courseTitle}</td>
                                                <td className="px-6 py-3 text-zinc-900 font-bold">{formatCurrency(payment.amount)}</td>
                                            <td className="px-6 py-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-bold ${getMethodBadgeClass(payment.paymentMethod)}`}>
                                                        {resolvePaymentMethod(payment.paymentMethod)}
                                                    </span>
                                                    {payment.collectedBy && (
                                                        <span className="text-[11px] text-zinc-500">
                                                            {(t.collectedByLabel || t.collectedBy || 'Collected by')}: {payment.collectedBy}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-zinc-500 text-sm">
                                            {t.noPayments || 'No payments recorded yet.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                            </table>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <div className="min-h-screen pb-12 bg-transparent">
            {/* Header/Cover */}
            <div className="h-48 bg-gradient-to-r from-red-600 to-zinc-900 relative">
                <button 
                    onClick={onBack}
                    className="absolute top-6 left-6 bg-white/20 hover:bg-white/30 text-white p-2 rounded-full backdrop-blur-sm transition-all"
                >
                    <ArrowLeft className="h-6 w-6" />
                </button>
            </div>

            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 -mt-20 relative z-10">
                <div className="ds-card flex flex-col md:flex-row items-start md:items-end gap-6 mb-8">
                    <div className="relative group">
                        <div className="h-32 w-32 rounded-full border-4 border-white shadow-lg bg-zinc-200 overflow-hidden relative">
                            {editForm.avatar ? (
                                <img src={editForm.avatar} className="h-full w-full object-cover" alt={editForm.name} />
                            ) : (
                                <div className="h-full w-full flex items-center justify-center bg-red-100 text-red-600 text-4xl font-bold">
                                    {editForm.name[0]}
                                </div>
                            )}
                            {isEditing && (
                                <label className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Camera className="h-8 w-8 text-white" />
                                    <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                                </label>
                            )}
                        </div>
                        {!isEditing && <div className="absolute bottom-2 right-2 h-6 w-6 bg-green-500 border-4 border-white rounded-full"></div>}
                    </div>
                    
                    <div className="flex-1 w-full">
                        {isEditing ? (
                            <div className="space-y-4 w-full">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Name</label>
                                        <input 
                                            className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                            value={editForm.name}
                                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                                            placeholder="Full Name"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Email</label>
                                        <input 
                                            className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-500"
                                            value={editForm.email}
                                            onChange={e => setEditForm({...editForm, email: e.target.value})}
                                            placeholder="Email"
                                            disabled={isStudent}
                                            readOnly={isStudent}
                                            title={isStudent ? (t.emailLocked || 'Email cannot be changed by students') : undefined}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">Phone</label>
                                        <PhoneInput
                                            value={phoneValue}
                                            onChange={(val) => {
                                                setPhoneValue(val);
                                                setEditForm({
                                                    ...editForm,
                                                    phone: val.full || val.number.trim() || undefined,
                                                    phoneCountryCode: val.countryCode || undefined
                                                });
                                            }}
                                            placeholder="Phone"
                                            className="w-full"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{(t as any).genderLabel || 'Gender'}</label>
                                        <select
                                            className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none bg-white"
                                            value={editForm.gender || ''}
                                            onChange={e => setEditForm({...editForm, gender: e.target.value === '' ? undefined : e.target.value as 'male' | 'female'})}
                                        >
                                            <option value="">{lang === 'ar' ? 'غير محدد' : '— Not specified —'}</option>
                                            <option value="male">{(t as any).genderMale || 'Male'}</option>
                                            <option value="female">{(t as any).genderFemale || 'Female'}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{(t as any).expertiseLabel || 'Area of Expertise/Field of Study'}</label>
                                        <input
                                            className="w-full border border-zinc-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                            value={editForm.specialization || ''}
                                            onChange={e => setEditForm({...editForm, specialization: e.target.value})}
                                            placeholder={lang === 'ar' ? 'مجال الخبرة أو التخصص' : 'e.g. Computer Science, Business Administration'}
                                        />
                                    </div>
                                </div>
                                
                                {/* Password Change Section */}
                                <div className="pt-4 border-t border-zinc-200">
                                    <h4 className="text-sm font-bold text-zinc-700 mb-3">{t.changePassword}</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{t.currentPassword}</label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                                >
                                                    {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <input 
                                                    type={showCurrentPassword ? "text" : "password"}
                                                    className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                                                    value={passwordForm.currentPassword}
                                                    onChange={e => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                                                    placeholder={t.currentPassword}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{t.newPassword}</label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                                >
                                                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <input 
                                                    type={showNewPassword ? "text" : "password"}
                                                    className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                                                    value={passwordForm.newPassword}
                                                    onChange={e => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                                                    placeholder={t.newPassword}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-zinc-400 uppercase mb-1">{t.confirmNewPassword}</label>
                                            <div className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                                >
                                                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                                <input 
                                                    type={showConfirmPassword ? "text" : "password"}
                                                    className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                                                    value={passwordForm.confirmNewPassword}
                                                    onChange={e => setPasswordForm({...passwordForm, confirmNewPassword: e.target.value})}
                                                    placeholder={t.confirmNewPassword}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center gap-3">
                                        <button 
                                            type="button"
                                            onClick={handlePasswordChange}
                                            className="bg-zinc-700 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-zinc-800"
                                        >
                                            {t.changePassword}
                                        </button>
                                        {passwordError && (
                                            <p className="text-red-600 text-sm">{passwordError}</p>
                                        )}
                                        {passwordSuccess && (
                                            <p className="text-green-600 text-sm">{t.passwordChanged}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div>
                                <h1 className="ds-page-title mb-2">{user.name}</h1>
                                <div className="flex flex-wrap gap-4 text-sm text-zinc-500">
                                    <div className="flex items-center gap-1">
                                        <Mail className="h-4 w-4" /> {user.email}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Phone className="h-4 w-4" /> <span dir="ltr" className="inline-block text-left">{formatPhoneNumberDisplay(user.phone, user.phoneCountryCode) || 'N/A'}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Calendar className="h-4 w-4" /> {t.joined} {user.joinDate}
                                    </div>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-6 text-sm">
                                    <div>
                                        <p className="text-xs font-bold text-zinc-400 uppercase">{(t as any).genderLabel || 'Gender'}</p>
                                        <p className="text-zinc-700">
                                            {user.gender ? (user.gender === 'male' ? ((t as any).genderMale || 'Male') : ((t as any).genderFemale || 'Female')) : '—'}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-zinc-400 uppercase">{(t as any).expertiseLabel || 'Area of Expertise/Field of Study'}</p>
                                        <p className="text-zinc-700">{user.specialization || '—'}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                        {isEditing ? (
                            <>
                                <button onClick={handleCancel} disabled={isSaving} className="ds-btn ds-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">
                                    <X className="h-4 w-4" /> {t.cancel}
                                </button>
                                <button onClick={handleSave} disabled={isSaving} className="ds-btn ds-btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                                    {isSaving ? (
                                        <>
                                            <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                            {lang === 'ar' ? 'جاري الحفظ...' : 'Saving...'}
                                        </>
                                    ) : (
                                        <>
                                            <Save className="h-4 w-4" /> {t.save}
                                        </>
                                    )}
                                </button>
                            </>
                        ) : (
                            <button 
                                onClick={() => {
                                    // Block guests from editing
                                    if (isGuest && onShowRestrictionModal) {
                                        onShowRestrictionModal();
                                        return;
                                    }
                                    setEditForm(user);
                                    setPhoneValue(resolvePhoneValue(user));
                                    setIsEditing(true);
                                }}
                                className="ds-btn ds-btn-secondary"
                            >
                                {t.editProfile}
                            </button>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Navigation Sidebar */}
                    <div className="lg:col-span-1">
                        <div className="ds-card overflow-hidden lg:sticky lg:top-24">
                            <nav className="flex flex-col p-2 space-y-1">
                                <button 
                                    onClick={() => setActiveTab('OVERVIEW')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'OVERVIEW' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Award className="h-4 w-4" /> {t.overview}
                                    </div>
                                    {activeTab === 'OVERVIEW' && <ChevronRight className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('SCHEDULE')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'SCHEDULE' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Calendar className="h-4 w-4" /> {t.schedule}
                                    </div>
                                    {activeTab === 'SCHEDULE' && <ChevronRight className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('ACADEMIC')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'ACADEMIC' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <FileText className="h-4 w-4" /> {t.academicRecord}
                                    </div>
                                    {activeTab === 'ACADEMIC' && <ChevronRight className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => setActiveTab('FINANCIAL')}
                                    className={`flex items-center justify-between px-4 py-3 rounded-lg text-sm font-medium transition-colors ${activeTab === 'FINANCIAL' ? 'bg-red-50 text-red-700' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <DollarSign className="h-4 w-4" /> {t.financials}
                                    </div>
                                    {activeTab === 'FINANCIAL' && <ChevronRight className="h-4 w-4" />}
                                </button>
                            </nav>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="lg:col-span-3">
                        {renderTabContent()}
                    </div>
                </div>
            </div>

            {/* Test Results Modal */}
            {showResultModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="ds-card w-full max-w-lg overflow-hidden animate-fade-in">
                        <div className={`px-6 py-4 flex justify-between items-center ${showResultModal.score >= 70 ? 'bg-green-600' : 'bg-red-900'}`}>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                {showResultModal.score >= 70 ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                                {t.testResults}
                            </h3>
                            <button onClick={() => setShowResultModal(null)} className="text-white hover:bg-white/20 p-1 rounded">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="p-6">
                            <div className="text-center mb-6">
                                <h4 className="text-xl font-bold text-zinc-900">{showResultModal.title}</h4>
                                <p className="text-sm text-zinc-500">{showResultModal.courseTitle}</p>
                                <div className={`inline-block mt-4 px-4 py-2 rounded-full text-2xl font-black ${showResultModal.score >= 70 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {showResultModal.score}/100
                                </div>
                            </div>
                            
                            <div className="bg-zinc-50 p-4 rounded-lg border border-zinc-200">
                                <h5 className="font-bold text-sm text-zinc-700 mb-2 uppercase">{t.instructorFeedback || 'Instructor/AI Feedback'}</h5>
                                <p className="text-sm text-zinc-600 italic">"{showResultModal.feedback || (t.noFeedback || 'No feedback provided.')}"</p>
                            </div>

                            <div className="mt-6 flex justify-end">
                                <button onClick={() => setShowResultModal(null)} className="bg-zinc-100 hover:bg-zinc-200 text-zinc-700 px-4 py-2 rounded-lg font-medium text-sm">
                                    {t.close}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Certificate Modal */}
            {selectedCertificate && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto relative">
                        <div className="p-8">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <Award className="h-8 w-8 text-red-600" />
                                    <h2 className="text-3xl font-bold text-zinc-900">{t.certificate || 'Certificate'}</h2>
                                </div>
                                <button 
                                    onClick={() => setSelectedCertificate(null)}
                                    className="text-zinc-400 hover:text-zinc-600"
                                >
                                    <X className="h-6 w-6" />
                                </button>
                            </div>
                            <CertificateDisplay 
                                certificate={selectedCertificate}
                                studentName={user.name}
                                courseName={selectedCertificate.courseTitle}
                                courseLevel={selectedCertificate.courseLevel}
                                t={t}
                                lang={lang}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
