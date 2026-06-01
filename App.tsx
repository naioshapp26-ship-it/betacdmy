import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ViewState, UserRole, User, Course, RewardsConfig, BlogPost, PaymentRecord, AttendanceRecord, Certificate, Discount, Notification, LiveClass, StaticPageContent, CreditTransaction, CreditRedemptionOption, CreditRedemption, CourseProgress, RewardGrantRequest, LivePlatformConfig, PaymentGatewayConfig, NotificationCategory, TenantAppearanceConfig, TenantBrandingConfig, InstructorPayout, CourseCategory, AdAnnouncement } from './types';
import { REWARDS_CONFIG, BRAND_LOGO_PATH } from './constants';
import { Menu, X, LogOut, Bell, Globe, Coins, GraduationCap, Briefcase, CalendarDays, BookOpen, Video, MessageSquare, Sparkles, CheckCircle, AlertCircle, Download, Eye, EyeOff, ArrowLeft, ArrowRight, Facebook, Instagram, Linkedin, Youtube } from 'lucide-react';
import { getErrorMessage } from './utils/errorMessages';
import { translations } from './translations';
import { extractBlogPostSlugFromPath, extractBlogPostIdFromPath } from './utils/blogNavigation.js';
import { useNotification } from './components/NotificationContext';
import { InlineFieldError } from './components/InlineNotification';
import GlobalSearchBar from './components/GlobalSearchBar';
import { GlobalSearchItem } from './utils/globalSearch';
import PhoneInput, { parsePhoneValue, type PhoneValue } from './components/PhoneInput';

const extractInstructorIdFromPath = (pathname: string, basePath?: string): string | null => {
    let normalizedPath = pathname;
    if (basePath) {
        const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
        if (normalizedPath.startsWith(normalizedBase)) {
            normalizedPath = normalizedPath.slice(normalizedBase.length) || '/';
        }
    }
    const match = normalizedPath.match(/^\/instructor-profile\/([^\/]+)$/);
    return match ? match[1] : null;
};

const extractAdIdFromPath = (pathname: string, basePath?: string): string | null => {
    let normalizedPath = pathname;
    if (basePath) {
        const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
        if (normalizedPath.startsWith(normalizedBase)) {
            normalizedPath = normalizedPath.slice(normalizedBase.length) || '/';
        }
    }
    const match = normalizedPath.match(/^\/ads\/([^\/]+)$/);
    return match ? match[1] : null;
};
import MainLanding from './components/MainLanding';
import SignupFlow from './components/SignupFlow';
import SuperAdminDashboard from './components/SuperAdminDashboard';
import SuperAdminConsole from './components/SuperAdminConsole';
import useTenant from './hooks/useTenant';
import { usePublicPaymentConfig, PlanPricingMap } from './hooks/usePublicPaymentConfig';
import { RoleSelectionModal } from './components/RoleSelectionModal';
import { RestrictionModal } from './components/RestrictionModal';
import { GuestBanner } from './components/GuestBanner';
import { getGuestMode, setGuestMode, clearGuestMode, GuestRole } from './utils/guestManager';
import FloatingActionButtons from './components/FloatingActionButtons';
import { parseHomePageContent } from './utils/homePage';

// Lazy load heavy components for code splitting
const Hero = lazy(() => import('./components/PublicPages').then(m => ({ default: m.Hero })));
const HeroStats = lazy(() => import('./components/PublicPages').then(m => ({ default: m.HeroStats })));
const ImportantNews = lazy(() => import('./components/PublicPages').then(m => ({ default: m.ImportantNews })));
const FeaturedCourses = lazy(() => import('./components/PublicPages').then(m => ({ default: m.FeaturedCourses })));
const FreelancerMembershipSection = lazy(() => import('./components/PublicPages').then(m => ({ default: m.FreelancerMembershipSection })));
const ServicesPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.ServicesPage })));
const BlogPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.BlogPage })));
const BlogPostPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.BlogPostPage })));
const TermsOfService = lazy(() => import('./components/PublicPages').then(m => ({ default: m.TermsOfService })));
const CoursesPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.CoursesPage })));
const AdsPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.AdsPage })));
const AdDetailsPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.AdDetailsPage })));
const EnrollmentPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.EnrollmentPage })));
const PrivacyPolicyPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.PrivacyPolicyPage })));
const AboutUsPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.AboutUsPage })));
const CareerPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.CareerPage })));
const ContactUsPage = lazy(() => import('./components/PublicPages').then(m => ({ default: m.ContactUsPage })));
const StudentDashboard = lazy(() => import('./components/Dashboards').then(m => ({ default: m.StudentDashboard })));
const InstructorDashboard = lazy(() => import('./components/Dashboards').then(m => ({ default: m.InstructorDashboard })));
const AdminDashboard = lazy(() => import('./components/Dashboards').then(m => ({ default: m.AdminDashboard })));
import { CoursePlayer } from './components/CoursePlayer';
const StudentProfile = lazy(() => import('./components/StudentProfile').then(m => ({ default: m.StudentProfile })));
const InstructorProfile = lazy(() => import('./components/InstructorProfile').then(m => ({ default: m.InstructorProfile })));
const PublicInstructorProfile = lazy(() => import('./components/PublicInstructorProfile').then(m => ({ default: m.default })));
const AISupport = lazy(() => import('./components/AISupport').then(m => ({ default: m.AISupport })));
const NotFoundPage = lazy(() => import('./components/NotFoundPage').then(m => ({ default: m.default })));
const PageGuide = lazy(() => import('./components/PageGuide').then(m => ({ default: m.PageGuide })));

const Footer: React.FC<{t: any; setView?: (view: ViewState) => void; branding?: TenantBrandingConfig | null; isMainSite?: boolean; homePageContent?: StaticPageContent}> = ({ t, setView, branding, isMainSite, homePageContent }) => {
    const currentYear = new Date().getFullYear();
    const logoSrc = (branding?.logoUrl && branding.logoUrl.trim()) || BRAND_LOGO_PATH;
    const parsedHome = useMemo(() => parseHomePageContent(homePageContent?.content), [homePageContent?.content]);
    const footerConfig = parsedHome.footer;
    const footerCopy = (footerConfig.copyrightText && footerConfig.copyrightText.trim()) || (branding?.footerText && branding.footerText.trim()) || `© ${currentYear} Betacademy Inc. ${t.rightsReserved || ''}`;
    const footerDescription = (footerConfig.description && footerConfig.description.trim()) || 'Empowering the next generation of learners with AI-driven education tools.';
    const contactEmail = (footerConfig.contactEmail && footerConfig.contactEmail.trim()) || 'hello@betacademy.edu';
    const contactPhone = (footerConfig.contactPhone && footerConfig.contactPhone.trim()) || '+1 (555) 123-4567';
    const socialLinks = (footerConfig.socialLinks || []).filter((item) => (item?.url || '').trim());
    const footerBackgroundColor = (branding?.footerBackgroundColor && branding.footerBackgroundColor.trim()) || '';
    const footerUsesCustomColor = Boolean(footerBackgroundColor);

    const renderSocialIcon = (label: string) => {
        const normalized = label.trim().toLowerCase();
        if (normalized.includes('facebook')) return <Facebook className="h-4 w-4" />;
        if (normalized.includes('instagram')) return <Instagram className="h-4 w-4" />;
        if (normalized.includes('linkedin')) return <Linkedin className="h-4 w-4" />;
        if (normalized.includes('youtube')) return <Youtube className="h-4 w-4" />;
        return <Globe className="h-4 w-4" />;
    };

    return (
        <footer
            id="footer"
            className={`${footerUsesCustomColor ? '' : 'bg-gradient-to-r from-red-950 via-red-900 to-black'} text-white border-t border-white/10 pt-16 pb-8`}
            style={footerUsesCustomColor ? { backgroundColor: footerBackgroundColor } : undefined}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                    <div className="col-span-1 md:col-span-1">
                        <div className="flex items-center mb-4">
                            <img src={logoSrc} alt="Betacademy Logo" className="h-20 w-20 object-contain" />
                        </div>
                        <p className="text-sm text-white/70 leading-relaxed">
                            {footerDescription}
                        </p>
                    </div>
                
                <div>
                    <h3 className="font-bold text-white mb-4">{t.academy}</h3>
                    <ul className="space-y-2 text-sm text-white/70">
                        <li><button onClick={() => setView?.(ViewState.WHO_WE_ARE)} className="hover:text-white text-left">{t.whoWeAre}</button></li>
                        <li><button onClick={() => setView?.(ViewState.CAREERS)} className="hover:text-white text-left">{t.careers}</button></li>
                        <li><button onClick={() => setView?.(ViewState.BLOG)} className="hover:text-white text-left">{t.blog}</button></li>
                        {isMainSite && (
                            <li className="pt-2">
                                <Link to="/saas" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-900 text-white text-sm font-semibold hover:bg-red-950 transition-colors">
                                    <GraduationCap className="h-4 w-4" />
                                    {t.launchYourAcademy}
                                </Link>
                            </li>
                        )}
                    </ul>
                </div>
                
                <div>
                    <h3 className="font-bold text-white mb-4">{t.legal}</h3>
                    <ul className="space-y-2 text-sm text-white/70">
                        <li><Link to="/privacy" className="hover:text-white">{t.privacyPolicy}</Link></li>
                        <li><Link to="/tos" className="hover:text-white">{t.tos}</Link></li>
                        <li><Link to="/contact-us" className="hover:text-white">{t.contactUs}</Link></li>
                    </ul>
                </div>

                <div>
                    <h3 className="font-bold text-white mb-4">Contact</h3>
                    <ul className="space-y-2 text-sm text-white/70">
                        <li>{contactEmail}</li>
                        <li>{contactPhone}</li>
                        {socialLinks.length > 0 && (
                            <li className="pt-2">
                                <div className="flex gap-3 mt-2">
                                    {socialLinks.map((social, index) => {
                                        const url = (social.url || '').trim();
                                        const label = (social.label || '').trim() || `Social ${index + 1}`;
                                        return (
                                            <a
                                                key={`${label}-${index}`}
                                                href={url}
                                                target="_blank"
                                                rel="noreferrer"
                                                title={label}
                                                aria-label={label}
                                                className="h-8 w-8 inline-flex items-center justify-center bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                                            >
                                                {renderSocialIcon(label)}
                                            </a>
                                        );
                                    })}
                                </div>
                            </li>
                        )}
                    </ul>
                </div>
            </div>
            
            <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
                <p className="text-xs text-white/60">{footerCopy}</p>
                <div className="flex gap-6 text-xs text-white/60">
                    <span>English</span>
                    <span>العربية</span>
                </div>
            </div>
        </div>
    </footer>
    );
};

const routePairs: Array<[ViewState, string]> = [
    [ViewState.HOME, '/'],
    [ViewState.ADS, '/ads'],
    [ViewState.COURSES, '/courses'],
    [ViewState.SERVICES, '/services'],
    [ViewState.BLOG, '/blog'],
    [ViewState.BLOG_POST, '/blog/:id'],
    [ViewState.WHO_WE_ARE, '/about-us'],
    [ViewState.CAREERS, '/career'],
    [ViewState.CONTACT_US, '/contact-us'],
    [ViewState.PRIVACY, '/privacy'],
    [ViewState.TOS, '/tos'],
    [ViewState.LOGIN, '/login'],
    [ViewState.FORGOT_PASSWORD, '/forgot-password'],
    [ViewState.RESET_PASSWORD, '/reset-password'],
    [ViewState.REGISTER, '/register'],
    [ViewState.DASHBOARD, '/dashboard'],
    [ViewState.ENROLLMENT, '/enrollment'],
    [ViewState.STUDENT_PROFILE, '/student-profile'],
    [ViewState.INSTRUCTOR_PROFILE, '/my-instructor-profile'],
    [ViewState.PUBLIC_INSTRUCTOR_PROFILE, '/instructor-profile/:id'],
    [ViewState.COURSE_PLAYER, '/course-player'],
    [ViewState.NOT_FOUND, '/404']
];

const VIEW_TO_PATH = routePairs.reduce<Partial<Record<ViewState, string>>>((acc, [v, path]) => {
    acc[v] = path;
    return acc;
}, {});

const COURSE_PLAYER_PATH = VIEW_TO_PATH[ViewState.COURSE_PLAYER] || '/course-player';

const DEFAULT_LIVE_PLATFORM_CONFIG: LivePlatformConfig = {
    smrrtxEnabled: true,
    smrrtxPermanentRoomLink: '',
    zoomEnabled: false,
    zoomConfigLink: '',
    zoomClientId: '',
    zoomClientSecret: '',
    zoomAccountId: '',
    zoomUserId: '',
    meetEnabled: false,
    meetConfigLink: '',
    googleSaEmail: '',
    googleSaKey: '',
    googleCalendarId: '',
};

const DEFAULT_PAYMENT_GATEWAY_CONFIG: PaymentGatewayConfig = {
    paypalEnabled: false,
    paypalClientId: '',
    paypalSecretKey: '',
    stripeEnabled: false,
    stripePublicKey: '',
    stripeSecretKey: '',
    stripeWebhookSecret: ''
};

const dashboardTabPaths = [
    '/dashboard/overview',
    '/dashboard/users',
    '/dashboard/students',
    '/dashboard/courses',
    '/dashboard/assignments',
    '/dashboard/certificates',
    '/dashboard/messages',
    '/dashboard/live',
    '/dashboard/credits',
    '/dashboard/offers',
    '/dashboard/financial',
    '/dashboard/attendance',
    '/dashboard/reports',
    '/dashboard/blog',
    '/dashboard/pages',
    '/dashboard/seo',
    '/dashboard/ads',
    '/dashboard/settings'
];

const PATH_TO_VIEW = [...routePairs, ...dashboardTabPaths.map((path) => [ViewState.DASHBOARD, path] as const)]
    .reduce<Record<string, ViewState>>((acc, [v, path]) => {
    acc[path] = v;
    return acc;
}, {});

const normalizePath = (path: string) => {
    if (!path || path === '/') return '/';
    return path.replace(/\/+$/, '') || '/';
};

const MAX_VISIBLE_NOTIFICATIONS = 8;

type SaasCopy = NonNullable<(typeof translations)['en']['saas']>;
const SAAS_PLAN_KEYS = ['basic', 'pro', 'enterprise'] as const;
type SaasPlanKey = (typeof SAAS_PLAN_KEYS)[number];
const isSaasPlanKey = (value: string): value is SaasPlanKey => SAAS_PLAN_KEYS.some((plan) => plan === value);

const formatPlanPriceLabel = (amount: number, currency: string, locale: string) => {
    const hasDecimals = !Number.isInteger(amount);
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            minimumFractionDigits: hasDecimals ? 2 : 0,
            maximumFractionDigits: hasDecimals ? 2 : 0
        }).format(amount);
    } catch {
        return `${currency} ${hasDecimals ? amount.toFixed(2) : amount.toFixed(0)}`;
    }
};

const applyPricingToSaasCopy = (copy: SaasCopy, pricing?: PlanPricingMap | null): SaasCopy => {
    if (!pricing || !copy?.landing?.plans?.length) {
        return copy;
    }
    const plans = copy.landing.plans.map((plan) => {
        if (!plan?.key || !isSaasPlanKey(plan.key)) {
            return plan;
        }
        const override = pricing[plan.key];
        if (!override?.formatted) {
            return plan;
        }
        return { ...plan, price: override.formatted };
    });
    return {
        ...copy,
        landing: {
            ...copy.landing,
            plans
        }
    };
};

type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void> | void;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const PWA_INSTALL_PROMPT_STORAGE_KEY = 'pwa-install-prompted';
const PWA_AUTO_PROMPT_DELAY_MS = 10000;

type NotificationCategoryMeta = {
    label: { en: string; ar: string };
    icon: React.ComponentType<{ className?: string }>;
    badgeBg: string;
    badgeText: string;
};

const NOTIFICATION_CATEGORY_META: Record<NotificationCategory, NotificationCategoryMeta> = {
    SYSTEM: {
        label: { en: 'System update', ar: 'تحديث النظام' },
        icon: Bell,
        badgeBg: 'bg-zinc-100',
        badgeText: 'text-zinc-600'
    },
    COURSE_UPDATE: {
        label: { en: 'Course update', ar: 'تحديث الدورة' },
        icon: BookOpen,
        badgeBg: 'bg-blue-50',
        badgeText: 'text-blue-600'
    },
    ASSIGNMENT_DEADLINE: {
        label: { en: 'Assignment due', ar: 'موعد الواجب' },
        icon: CalendarDays,
        badgeBg: 'bg-amber-50',
        badgeText: 'text-amber-600'
    },
    EXAM_RESULT: {
        label: { en: 'Exam result', ar: 'نتيجة الاختبار' },
        icon: CheckCircle,
        badgeBg: 'bg-emerald-50',
        badgeText: 'text-emerald-600'
    },
    NEW_CONTENT: {
        label: { en: 'New content', ar: 'محتوى جديد' },
        icon: Sparkles,
        badgeBg: 'bg-fuchsia-50',
        badgeText: 'text-fuchsia-600'
    },
    LIVE_MEETING: {
        label: { en: 'Live meeting', ar: 'حصة مباشرة' },
        icon: Video,
        badgeBg: 'bg-purple-50',
        badgeText: 'text-purple-600'
    },
    MESSAGE: {
        label: { en: 'Message', ar: 'رسالة' },
        icon: MessageSquare,
        badgeBg: 'bg-cyan-50',
        badgeText: 'text-cyan-600'
    }
};

const FALLBACK_NOTIFICATION_META: NotificationCategoryMeta = {
    label: { en: 'Update', ar: 'تحديث' },
    icon: AlertCircle,
    badgeBg: 'bg-zinc-100',
    badgeText: 'text-zinc-600'
};

const getNotificationCategoryMeta = (category?: NotificationCategory | string) => {
    if (!category) return FALLBACK_NOTIFICATION_META;
    return NOTIFICATION_CATEGORY_META[category as NotificationCategory] || FALLBACK_NOTIFICATION_META;
};

const formatNotificationTimestamp = (value?: string, locale: 'ar' | 'en' = 'en') => {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString(locale === 'ar' ? 'ar' : 'en-US', {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
    } catch {
        return value;
    }
};

const translateNotificationMessage = (message: string, t: any) => {
    if (!message || !t) return message;
    
    // Pattern: "TITLE" has new updates from INSTRUCTOR.
    const hasUpdatesMatch = message.match(/^"(.+?)" has new updates from (.+?)\.$/i);
    if (hasUpdatesMatch) {
        return (t.notifHasNewUpdatesFrom || message)
            .replace('{{title}}', hasUpdatesMatch[1])
            .replace('{{instructor}}', hasUpdatesMatch[2]);
    }
    
    // Pattern: NAME scheduled a Smrrtx lab review.
    const smrrtxMatch = message.match(/^(.+?) scheduled a Smrrtx (.+?)\.$/i);
    if (smrrtxMatch) {
        return (t.notifScheduledSmrrtx || message)
            .replace('{{name}}', smrrtxMatch[1])
            .replace('{{topic}}', smrrtxMatch[2]);
    }
    
    // Pattern: Your course "TITLE" is now live.
    const liveMatch = message.match(/^Your course "(.+?)" is now live\.$/i);
    if (liveMatch) {
        return (t.notifCourseIsNowLive || message).replace('{{title}}', liveMatch[1]);
    }
    
    // Pattern: Your course "TITLE" changes are live.
    const changesMatch = message.match(/^Your course "(.+?)" changes are live\.$/i);
    if (changesMatch) {
        return (t.notifCourseChangesAreLive || message).replace('{{title}}', changesMatch[1]);
    }
    
    // Pattern: NAME sent a new message in COURSE.
    const messageInCourseMatch = message.match(/^(.+?) sent a new message in (.+?)\.$/i);
    if (messageInCourseMatch) {
        return (t.notifSentMessageInCourse || message)
            .replace('{{name}}', messageInCourseMatch[1])
            .replace('{{course}}', messageInCourseMatch[2]);
    }
    
    // Pattern: NAME sent you a new message.
    const messageMatch = message.match(/^(.+?) sent you a new message\.$/i);
    if (messageMatch) {
        return (t.notifSentYouMessage || message).replace('{{name}}', messageMatch[1]);
    }
    
    return message;
};

const sortNotificationsByNewest = (items: Notification[]) =>
    [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const detectStandaloneMode = () => {
    if (typeof window === 'undefined') {
        return false;
    }
    const mediaQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null;
    const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
    return Boolean(mediaQuery?.matches || navigatorWithStandalone?.standalone);
};

const hasStoredPwaPromptFlag = () => {
    if (typeof window === 'undefined') {
        return false;
    }
    try {
        return localStorage.getItem(PWA_INSTALL_PROMPT_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const App: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { subdomain: tenantSubdomain, mainDomain, isMainSite, config: tenantConfig, loading: tenantLoading, notFound: tenantNotFound } = useTenant();
    const { notify, confirm, prompt } = useNotification();
    const normalizedPath = useMemo(() => normalizePath(location.pathname), [location.pathname]);
    const isSaasRoute = normalizedPath === '/saas' || normalizedPath.startsWith('/saas/');
    const tenantBasePath = isSaasRoute && isMainSite ? '/saas' : '';
    const experiencePath = useMemo(() => {
        if (!isSaasRoute) {
            const tenantPrefix = tenantSubdomain ? `/${tenantSubdomain}/` : null;
            // Only strip path-based tenant prefixes when the URL contains an explicit
            // `/{tenant}/...` segment. Do not strip plain routes like `/dashboard`.
            if (tenantPrefix && normalizedPath.startsWith(tenantPrefix)) {
                const trimmedTenantPath = normalizedPath.slice(tenantPrefix.length - 1) || '/';
                return trimmedTenantPath.startsWith('/') ? trimmedTenantPath : `/${trimmedTenantPath}`;
            }
            return normalizedPath;
        }
        const trimmed = normalizedPath.slice(5) || '/';
        return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }, [isSaasRoute, normalizedPath, tenantSubdomain]);
    const tenantBranding = tenantConfig?.branding || null;
    const tenantPricing = tenantConfig?.pricing || null;
    const tenantDisplayName = useMemo(() => {
        return [tenantConfig?.companyName, tenantConfig?.name]
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .find(Boolean) || null;
    }, [tenantConfig?.companyName, tenantConfig?.name]);
    const tenantFaviconHref = useMemo(() => {
        return [tenantBranding?.faviconUrl, tenantBranding?.logoUrl]
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .find(Boolean) || null;
    }, [tenantBranding?.faviconUrl, tenantBranding?.logoUrl]);
    const { data: publicPaymentConfig } = usePublicPaymentConfig({ enabled: isMainSite && isSaasRoute });
  // Default to 'ar' as requested
  const [lang, setLang] = useState<'ar' | 'en'>('ar');
    const planPricing = useMemo<PlanPricingMap | null>(() => {
        if (!publicPaymentConfig) {
            return null;
        }
        const locale = lang === 'ar' ? 'ar' : 'en-US';
        const entries: Array<[SaasPlanKey, number | null, string | null]> = [
            ['basic', publicPaymentConfig.planBasicMonthlyAmount, publicPaymentConfig.planBasicMonthlyCurrency],
            ['pro', publicPaymentConfig.planProMonthlyAmount, publicPaymentConfig.planProMonthlyCurrency],
            ['enterprise', publicPaymentConfig.planEnterpriseMonthlyAmount, publicPaymentConfig.planEnterpriseMonthlyCurrency]
        ];
        const result: PlanPricingMap = {};
        for (const [key, amount, currency] of entries) {
            if (typeof amount !== 'number' || amount <= 0 || !currency) {
                continue;
            }
            const formattedValue = `${formatPlanPriceLabel(amount, currency, locale)}/mo`;
            result[key] = { monthlyAmount: amount, currency, formatted: formattedValue };
        }
        return Object.keys(result).length ? result : null;
    }, [publicPaymentConfig, lang]);
  const [view, setViewState] = useState<ViewState>(ViewState.HOME);
  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem('betacademy_user');
      if (savedUser) {
        return JSON.parse(savedUser);
      }
      
      // Check for guest mode
      const guestSession = getGuestMode();
      if (guestSession) {
        return {
          id: guestSession.sessionId,
          name: guestSession.role === 'STUDENT' ? 'زائر (متدرب)' : 'زائر (مدرب)',
          email: '',
          role: UserRole.GUEST,
          guestRole: guestSession.role,
          credits: 0,
          streak: 0,
          enrolledCourses: []
        };
      }
      
      return null;
    } catch {
      return null;
    }
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [selectedCourse, setSelectedCourseState] = useState<Course | null>(null);
    const [selectedInstructor, setSelectedInstructorState] = useState<User | null>(null);
    const [selectedBlogPost, setSelectedBlogPostState] = useState<BlogPost | null>(null);
    const seoAbortRef = useRef<AbortController | null>(null);

    // Ref to track when we've intentionally cleared the blog post to prevent URL effect from re-navigating
    const navigationClearedBlogPostRef = useRef(false);
    // Ref to track when we've intentionally cleared the instructor to prevent URL effect from re-navigating
    const navigationClearedInstructorRef = useRef(false);

    const setSelectedCourse = useCallback((course: Course | null) => {
        setSelectedCourseState(course);
    }, []);

    const setSelectedInstructor = useCallback((instructor: User | null) => {
        setSelectedInstructorState(instructor);
    }, []);

    const setSelectedBlogPost = useCallback((post: BlogPost | null) => {
        setSelectedBlogPostState(post);
    }, []);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
        const [unreadNotifications, setUnreadNotifications] = useState(0);
        const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
        const [notificationsError, setNotificationsError] = useState<string | null>(null);
        const notificationStreamRef = useRef<EventSource | null>(null);
        const notificationReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [rewardsConfig, setRewardsConfig] = useState<RewardsConfig>(REWARDS_CONFIG);
    const [blogPosts, setBlogPosts] = useState<BlogPost[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [courseCategories, setCourseCategories] = useState<CourseCategory[]>([]);
    const [platformUsers, setPlatformUsers] = useState<User[]>([]);
    const [coursePayments, setCoursePayments] = useState<PaymentRecord[]>([]);
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [liveClasses, setLiveClasses] = useState<LiveClass[]>([]);
    const [instructorPayouts, setInstructorPayouts] = useState<InstructorPayout[]>([]);
    const [creditTransactions, setCreditTransactions] = useState<CreditTransaction[]>([]);
    const [creditRedemptionOptions, setCreditRedemptionOptions] = useState<CreditRedemptionOption[]>([]);
    const [creditRedemptions, setCreditRedemptions] = useState<CreditRedemption[]>([]);
    const [livePlatformConfig, setLivePlatformConfig] = useState<LivePlatformConfig>(DEFAULT_LIVE_PLATFORM_CONFIG);
    const [paymentGatewayConfig, setPaymentGatewayConfig] = useState<PaymentGatewayConfig>(DEFAULT_PAYMENT_GATEWAY_CONFIG);
    const [courseProgress, setCourseProgress] = useState<CourseProgress[]>([]);
    const [staticPages, setStaticPages] = useState<StaticPageContent[]>([]);
    const [isBootstrapping, setIsBootstrapping] = useState(true);
    const [bootError, setBootError] = useState<string | null>(null);
    const [isInstalled, setIsInstalled] = useState(() => detectStandaloneMode());
    const [isInstallable, setIsInstallable] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [hasPromptedInstall, setHasPromptedInstall] = useState(() => hasStoredPwaPromptFlag());
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [isPromptingInstall, setIsPromptingInstall] = useState(false);
    const installPromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isInstalledRef = useRef(isInstalled);
    const hasPromptedInstallRef = useRef(hasPromptedInstall);
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
    
    // Guest mode modals
    const [showRoleSelectionModal, setShowRoleSelectionModal] = useState(false);
    const [showRestrictionModal, setShowRestrictionModal] = useState(false);
    const [topAnnouncements, setTopAnnouncements] = useState<AdAnnouncement[]>([]);
    const [announcementDurationSeconds, setAnnouncementDurationSeconds] = useState(24);
    const announcementMarqueeRef = useRef<HTMLDivElement | null>(null);
    
    // Track processed payment session IDs to prevent re-processing
    const processedSessionIdsRef = useRef<Set<string>>(new Set());
    const processingSessionIdRef = useRef<string | null>(null);
    const isMountedRef = useRef(true);

    // Set language and text direction for Arabic RTL support
    useEffect(() => {
        if (typeof document !== 'undefined') {
            document.documentElement.lang = lang;
            document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
        }
    }, [lang]);

    const updateMetaTag = useCallback((attr: 'name' | 'property', key: string, value?: string | null) => {
        if (!value || typeof document === 'undefined') {
            return;
        }
        const selector = `meta[${attr}="${key}"]`;
        let element = document.head.querySelector(selector) as HTMLMetaElement | null;
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute(attr, key);
            document.head.appendChild(element);
        }
        element.setAttribute('content', value);
    }, []);

    const updateLinkTag = useCallback((rel: string, href?: string | null) => {
        if (!href || typeof document === 'undefined') {
            return;
        }
        const selector = `link[rel="${rel}"]`;
        let element = document.head.querySelector(selector) as HTMLLinkElement | null;
        if (!element) {
            element = document.createElement('link');
            element.setAttribute('rel', rel);
            document.head.appendChild(element);
        }
        element.setAttribute('href', href);
    }, []);

    const updateJsonLd = useCallback((value?: string | null) => {
        if (typeof document === 'undefined') {
            return;
        }
        const existing = document.head.querySelector('script[data-seo-jsonld]') as HTMLScriptElement | null;
        if (!value) {
            if (existing) {
                existing.remove();
            }
            return;
        }
        const script = existing || document.createElement('script');
        script.type = 'application/ld+json';
        script.setAttribute('data-seo-jsonld', 'true');
        script.text = value;
        if (!existing) {
            document.head.appendChild(script);
        }
    }, []);

    const buildDynamicSeoFallback = useCallback(() => {
        if (experiencePath.startsWith('/blog/') && selectedBlogPost) {
            return {
                title: selectedBlogPost.title,
                description: selectedBlogPost.excerpt,
                image: selectedBlogPost.uploadedImagePath || selectedBlogPost.image,
                ogType: 'article'
            };
        }
        if (experiencePath === '/course-player' && selectedCourse) {
            return {
                title: selectedCourse.title,
                description: selectedCourse.description,
                image: selectedCourse.thumbnail,
                ogType: 'website'
            };
        }
        if (experiencePath.startsWith('/instructor-profile/') && selectedInstructor) {
            return {
                title: selectedInstructor.name,
                description: selectedInstructor.bio,
                image: selectedInstructor.avatar,
                ogType: 'profile'
            };
        }
        return {} as {
            title?: string;
            description?: string;
            image?: string;
            ogType?: string;
        };
    }, [experiencePath, selectedBlogPost, selectedCourse, selectedInstructor]);

    useEffect(() => {
        if (typeof document === 'undefined') {
            return;
        }

        seoAbortRef.current?.abort();
        const controller = new AbortController();
        seoAbortRef.current = controller;

        const pathForSeo = experiencePath || '/';
        const langParam = lang || 'en';
        const requestUrl = `/api/seo/settings/page?path=${encodeURIComponent(pathForSeo)}&lang=${langParam}`;

        const applySeo = (payload?: any) => {
            const dynamic = buildDynamicSeoFallback();
            const payloadTitle = typeof payload?.title === 'string' ? payload.title.trim() : '';
            const homeTenantTitle = tenantSubdomain && experiencePath === '/' && tenantDisplayName
                ? tenantDisplayName
                : '';
            const title = homeTenantTitle || payloadTitle || dynamic.title || tenantDisplayName || 'Betacademy';
            const description = payload?.description || dynamic.description || '';
            const keywords = payload?.keywords || '';
            const canonical = payload?.canonical_url || window.location.href;
            const robots = payload?.robots || (payload?.indexable === false ? 'noindex,nofollow' : 'index,follow');
            const ogTitle = payload?.og_title || payload?.og?.title || title;
            const ogDescription = payload?.og_description || payload?.og?.description || description;
            const ogImage = payload?.og_image_url || payload?.og?.image || dynamic.image;
            const ogType = payload?.og_type || payload?.og?.type || dynamic.ogType || 'website';
            const ogSiteName = payload?.og_site_name || payload?.og?.site_name || tenantConfig?.companyName;
            const twitterCard = payload?.twitter_card || payload?.twitter?.card || 'summary_large_image';
            const twitterTitle = payload?.twitter_title || payload?.twitter?.title || title;
            const twitterDescription = payload?.twitter_description || payload?.twitter?.description || description;
            const twitterImage = payload?.twitter_image_url || payload?.twitter?.image || ogImage;
            const jsonld = payload?.jsonld || null;

            document.title = title;
            updateMetaTag('name', 'description', description);
            updateMetaTag('name', 'keywords', keywords);
            updateMetaTag('name', 'robots', robots);
            updateLinkTag('canonical', canonical);

            updateMetaTag('property', 'og:title', ogTitle);
            updateMetaTag('property', 'og:description', ogDescription);
            updateMetaTag('property', 'og:image', ogImage);
            updateMetaTag('property', 'og:type', ogType);
            updateMetaTag('property', 'og:site_name', ogSiteName);
            updateMetaTag('property', 'og:url', canonical);
            updateMetaTag('property', 'og:locale', payload?.locale);
            updateMetaTag('property', 'og:locale:alternate', payload?.locale_alternate);

            updateMetaTag('name', 'twitter:card', twitterCard);
            updateMetaTag('name', 'twitter:title', twitterTitle);
            updateMetaTag('name', 'twitter:description', twitterDescription);
            updateMetaTag('name', 'twitter:image', twitterImage);

            if (tenantFaviconHref) {
                updateLinkTag('icon', tenantFaviconHref);
                updateLinkTag('shortcut icon', tenantFaviconHref);
                updateLinkTag('apple-touch-icon', tenantFaviconHref);
            }

            updateJsonLd(jsonld);
        };

        fetch(requestUrl, { signal: controller.signal })
            .then((response) => response.json().catch(() => null))
            .then((payload) => {
                if (controller.signal.aborted) {
                    return;
                }
                if (payload?.success && payload?.data) {
                    applySeo(payload.data);
                } else {
                    applySeo();
                }
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    applySeo();
                }
            });

        return () => {
            controller.abort();
        };
    }, [experiencePath, lang, tenantSubdomain, tenantDisplayName, tenantFaviconHref, buildDynamicSeoFallback, updateMetaTag, updateLinkTag, updateJsonLd]);

    useEffect(() => {
        isInstalledRef.current = isInstalled;
    }, [isInstalled]);

    useEffect(() => {
        hasPromptedInstallRef.current = hasPromptedInstall;
    }, [hasPromptedInstall]);

    useEffect(() => {
        deferredPromptRef.current = deferredPrompt;
    }, [deferredPrompt]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const clearInstallPromptTimer = useCallback(() => {
        if (installPromptTimerRef.current) {
            clearTimeout(installPromptTimerRef.current);
            installPromptTimerRef.current = null;
        }
    }, []);

    const persistInstallPrompted = useCallback(() => {
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(PWA_INSTALL_PROMPT_STORAGE_KEY, 'true');
            } catch (error) {
                console.warn('PWA install flag persistence failed', error);
            }
        }
        setHasPromptedInstall(true);
        hasPromptedInstallRef.current = true;
    }, []);

    const showManualInstallInstructions = useCallback(async () => {
        if (typeof window === 'undefined') {
            return;
        }
        const installUrl = window.location.href;
        let copied = false;
        if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(installUrl);
                copied = true;
            } catch (error) {
                console.warn('Unable to copy PWA install URL', error);
            }
        }
        const dictionary = translations[lang];
        const linkLine = copied
            ? (dictionary.installInstructionsLinkCopied || 'Link copied to clipboard:')
            : (dictionary.installInstructionsLink || 'App link:');
        const message = [
            dictionary.installInstructionsIntro || 'Install tips:',
            dictionary.installInstructionsChrome || 'Desktop Chrome: Use the install icon in the address bar.',
            dictionary.installInstructionsEdge || 'Desktop Edge: Menu -> Apps -> Install this site as an app.',
            dictionary.installInstructionsAndroid || 'Android Chrome: Tap "Add to Home screen" in the menu.',
            dictionary.installInstructionsIos || 'iPhone/iPad Safari: Share -> "Add to Home Screen".',
            '',
            `${linkLine} ${installUrl}`
        ].join('\n');
        notify('info', message);
    }, [lang]);

    const requestInstall = useCallback(async (source: 'button' | 'modal') => {
        if (!deferredPrompt) {
            setIsInstallable(false);
            if (source === 'modal') {
                setShowInstallModal(false);
                persistInstallPrompted();
            }
            await showManualInstallInstructions();
            return;
        }
        clearInstallPromptTimer();
        setIsPromptingInstall(true);
        try {
            await Promise.resolve(deferredPrompt.prompt());
            const choice = await deferredPrompt.userChoice;
            if (choice?.outcome === 'accepted') {
                setIsInstalled(true);
                isInstalledRef.current = true;
            }
        } catch (error) {
            console.error('PWA install prompt error', error);
        } finally {
            setIsPromptingInstall(false);
            setDeferredPrompt(null);
            deferredPromptRef.current = null;
            setIsInstallable(false);
            if (source === 'modal') {
                setShowInstallModal(false);
                persistInstallPrompted();
            }
        }
    }, [deferredPrompt, persistInstallPrompted, showManualInstallInstructions, clearInstallPromptTimer]);

    const handleInstallButtonClick = useCallback(() => {
        if (isInstallable && !isInstalled && deferredPrompt) {
            void requestInstall('button');
            return;
        }
        void showManualInstallInstructions();
    }, [deferredPrompt, isInstallable, isInstalled, requestInstall, showManualInstallInstructions]);

    const handleInstallModalInstall = useCallback(() => {
        void requestInstall('modal');
    }, [requestInstall]);

    const handleInstallModalLater = useCallback(() => {
        setShowInstallModal(false);
        persistInstallPrompted();
        clearInstallPromptTimer();
    }, [persistInstallPrompted, clearInstallPromptTimer]);

    const handleUserUpdate = useCallback((updatedUser: User) => {
        localStorage.setItem('betacademy_user', JSON.stringify(updatedUser));
        setUser(updatedUser);
        setPlatformUsers(prev => {
            const exists = prev.some(u => u.id === updatedUser.id);
            return exists ? prev.map(u => (u.id === updatedUser.id ? updatedUser : u)) : [...prev, updatedUser];
        });
    }, [setUser, setPlatformUsers]);

    const handleAddCreditTransaction = useCallback((transaction: CreditTransaction) => {
        setCreditTransactions(prev => [transaction, ...prev]);
    }, [setCreditTransactions]);

    const handleAddCreditRedemption = useCallback((redemption: CreditRedemption) => {
        setCreditRedemptions(prev => [redemption, ...prev]);
    }, [setCreditRedemptions]);

    const handleAddCoursePayment = useCallback((payment: PaymentRecord) => {
        setCoursePayments((prev) => [payment, ...prev]);
    }, []);

    const handleAddInstructorPayout = useCallback((payout: InstructorPayout) => {
        setInstructorPayouts((prev) => [payout, ...prev]);
    }, []);

    const handleUpdateCoursePayment = useCallback((payment: PaymentRecord) => {
        setCoursePayments((prev) => prev.map((entry) => (entry.id === payment.id ? payment : entry)));
    }, []);

    const handleDeleteCoursePayment = useCallback((paymentId: string) => {
        setCoursePayments((prev) => prev.filter((entry) => entry.id !== paymentId));
    }, []);

    const handleUpdateInstructorPayout = useCallback((payout: InstructorPayout) => {
        setInstructorPayouts((prev) => prev.map((entry) => (entry.id === payout.id ? payout : entry)));
    }, []);

    const handleDeleteInstructorPayout = useCallback((payoutId: string) => {
        setInstructorPayouts((prev) => prev.filter((entry) => entry.id !== payoutId));
    }, []);

    const handleCourseProgressSync = useCallback((record: CourseProgress) => {
        setCourseProgress(prev => {
            const existing = prev.filter(item => item.courseId !== record.courseId);
            const next = [record, ...existing];
            return next.sort((a, b) => {
                const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
                const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
                return bTime - aTime;
            });
        });
    }, []);

    const handleAttendanceSnapshot = useCallback((record: AttendanceRecord) => {
        if (!record) {
            return;
        }
        setAttendance((prev) => {
            const index = prev.findIndex((entry) => entry.id === record.id);
            if (index === -1) {
                return [record, ...prev];
            }
            const next = [...prev];
            next[index] = record;
            return next;
        });
    }, []);

    const hydrateCourseWithProgress = useCallback((course: Course): Course => {
        if (!course) {
            return course;
        }
        const record = courseProgress.find(entry => entry.courseId === course.id);
        const completedItemIds = record?.completedItemIds || [];
        if (!completedItemIds.length) {
            return course;
        }
        const completedSet = new Set(
            completedItemIds
                .map(item => (typeof item === 'string' ? item.trim() : ''))
                .filter(Boolean)
        );
        if (!completedSet.size) {
            return course;
        }

        let mutated = false;
        const modules = (course.modules || []).map((module, moduleIndex) => {
            let moduleMutated = false;
            const moduleId = typeof module.id === 'string' && module.id.trim().length ? module.id.trim() : `module-${moduleIndex + 1}`;
            const updatedItems = module.items.map((item, itemIndex) => {
                const itemId = typeof item.id === 'string' && item.id.trim().length
                    ? item.id.trim()
                    : `${moduleId}-item-${itemIndex + 1}`;
                if (completedSet.has(itemId) && !item.completed) {
                    moduleMutated = true;
                    mutated = true;
                    return { ...item, completed: true };
                }
                return item;
            });
            if (moduleMutated) {
                return { ...module, items: updatedItems };
            }
            return module;
        });

        if (!mutated) {
            return course;
        }

        return { ...course, modules };
    }, [courseProgress]);

    const handleUpsertCreditOption = useCallback((option: CreditRedemptionOption) => {
        setCreditRedemptionOptions(prev => {
            const existingIndex = prev.findIndex((item) => item.id === option.id);
            if (existingIndex === -1) {
                return [option, ...prev];
            }
            const next = [...prev];
            next[existingIndex] = option;
            return next;
        });
    }, [setCreditRedemptionOptions]);

    const disconnectNotificationStream = useCallback(() => {
        if (notificationReconnectTimerRef.current) {
            clearTimeout(notificationReconnectTimerRef.current);
            notificationReconnectTimerRef.current = null;
        }
        if (notificationStreamRef.current) {
            notificationStreamRef.current.close();
            notificationStreamRef.current = null;
        }
    }, []);

    const appendNotifications = useCallback((incoming: Notification | Notification[]) => {
        const items = Array.isArray(incoming) ? incoming : [incoming];
        if (!items.length) {
            return;
        }
        setNotifications((prev) => {
            const map = new Map(prev.map((item) => [item.id, item]));
            items.forEach((item) => map.set(item.id, item));
            return sortNotificationsByNewest(Array.from(map.values()));
        });
    }, []);

    const upsertNotificationEntry = useCallback((updated: Notification) => {
        setNotifications((prev) => {
            let found = false;
            const next = prev.map((item) => {
                if (item.id !== updated.id) {
                    return item;
                }
                found = true;
                return updated;
            });
            if (!found) {
                next.unshift(updated);
            }
            return sortNotificationsByNewest(next);
        });
    }, []);

    const applyNotificationReadState = useCallback((ids: string[], read: boolean) => {
        if (!ids.length) {
            return;
        }
        const idSet = new Set(ids);
        const timestamp = read ? new Date().toISOString() : undefined;
        setNotifications((prev) =>
            prev.map((item) => (idSet.has(item.id) ? { ...item, read, readAt: read ? timestamp : undefined } : item))
        );
    }, []);

    const fetchUserNotifications = useCallback(async (targetUserId: string) => {
        if (!targetUserId) {
            return;
        }
        setIsLoadingNotifications(true);
        setNotificationsError(null);
        try {
            const response = await fetch(`/api/users/${targetUserId}/notifications?limit=50`);
            if (!response.ok) {
                throw new Error('Failed to load notifications');
            }
            const payload = await response.json();
            const list: Notification[] = Array.isArray(payload.notifications) ? payload.notifications : [];
            setNotifications(sortNotificationsByNewest(list));
            if (typeof payload.unreadCount === 'number') {
                setUnreadNotifications(payload.unreadCount);
            }
        } catch (error) {
            console.error('Notifications fetch error', error);
            setNotificationsError(error instanceof Error ? error.message : 'Unable to load notifications');
        } finally {
            setIsLoadingNotifications(false);
        }
    }, []);

    const getPathForView = useCallback((path?: string) => {
        if (!path) {
            return path;
        }
        if (!tenantBasePath) {
            return path;
        }
        if (path === '/') {
            return tenantBasePath;
        }
        return `${tenantBasePath}${path}`;
    }, [tenantBasePath]);

    const logNavigationAttempt = useCallback((toView: ViewState, resolvedPath?: string, options?: { skipNavigate?: boolean }) => {
        try {
            const currentPath = normalizePath(location.pathname);
            const shouldLog = currentPath.startsWith('/blog')
                || (resolvedPath ? resolvedPath.startsWith('/blog') : false)
                || toView === ViewState.BLOG
                || toView === ViewState.BLOG_POST;
            if (!shouldLog) {
                return;
            }
            const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;
            void fetch('/api/debug/navigation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fromPath: currentPath,
                    toView,
                    resolvedPath: resolvedPath || null,
                    skipNavigate: Boolean(options?.skipNavigate),
                    tenantBasePath: tenantBasePath || null,
                    timestamp: new Date().toISOString(),
                    userAgent
                })
            }).catch(() => {});
        } catch (error) {
            console.warn('Navigation debug logging failed', error);
        }
    }, [location.pathname, tenantBasePath]);

    const setView = useCallback((nextView: ViewState, options?: { skipNavigate?: boolean }) => {
        const targetPath = VIEW_TO_PATH[nextView];
        const currentPath = normalizePath(location.pathname);
        const resolvedPath = targetPath ? (getPathForView(targetPath) || targetPath) : null;

        if (resolvedPath) {
            logNavigationAttempt(nextView, resolvedPath, options);
        }

        // Clear state BEFORE changing view to prevent URL effects from reverting navigation
        // This must happen synchronously before any navigation
        if (view === ViewState.BLOG_POST && nextView !== ViewState.BLOG_POST) {
            setSelectedBlogPostState(null);
            navigationClearedBlogPostRef.current = true;
        }
        if (view === ViewState.PUBLIC_INSTRUCTOR_PROFILE && nextView !== ViewState.PUBLIC_INSTRUCTOR_PROFILE) {
            setSelectedInstructorState(null);
            navigationClearedInstructorRef.current = true;
        }

        setViewState(nextView);
        if (options?.skipNavigate) {
            return;
        }
        if (resolvedPath && resolvedPath !== currentPath) {
            navigate(resolvedPath);
        }
    }, [getPathForView, navigate, location.pathname, logNavigationAttempt, view]);

    const fetchPlatformData = useCallback(async () => {
        try {
            console.log('\n========== FRONTEND: BOOTSTRAP REQUEST START ==========');
            console.log('Timestamp:', new Date().toISOString());
            
            setBootError(null);
            setIsBootstrapping(true);
            
            console.log('Fetching /api/bootstrap...');
            const response = await fetch('/api/bootstrap');
            console.log('Response status:', response.status, response.statusText);
            
            if (!response.ok) {
                throw new Error('Failed to load platform data');
            }
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                throw new Error('Received non-JSON response from API');
            }
            
            console.log('Parsing JSON response...');
            const data = await response.json();
            
            console.log('Bootstrap data received:');
            console.log('  - Courses:', data.courses?.length || 0);
            console.log('  - Blog Posts:', data.blogPosts?.length || 0);
            console.log('  - Notifications: handled via SSE stream');
            console.log('  - Users:', data.users?.length || 0);
            console.log('  - Course Payments:', data.coursePayments?.length || 0);
            console.log('  - Instructor Payouts:', data.instructorPayouts?.length || 0);
            console.log('  - Attendance:', data.attendance?.length || 0);
            console.log('  - Certificates:', data.certificates?.length || 0);
            console.log('  - Discounts:', data.discounts?.length || 0);
            console.log('  - Live Classes:', data.liveClasses?.length || 0);
            console.log('  - Rewards Config:', data.rewardsConfig ? 'Present' : 'Missing');
            console.log('  - Credit Options:', data.creditRedemptionOptions?.length || 0);
            console.log('  - Credit Transactions:', data.creditTransactions?.length || 0);
            console.log('  - Credit Redemptions:', data.creditRedemptions?.length || 0);
            
            setCourses(data.courses || []);
            setBlogPosts(data.blogPosts || []);
            setPlatformUsers(data.users || []);
            setCoursePayments(data.coursePayments || []);
            setInstructorPayouts(data.instructorPayouts || []);
            setAttendance(data.attendance || []);
            setCertificates(data.certificates || []);
            setDiscounts(data.discounts || []);
            setLiveClasses(data.liveClasses || []);
            setStaticPages(data.staticPages || []);
            setCourseCategories(data.courseCategories || []);
            setCreditRedemptionOptions(data.creditRedemptionOptions || []);
            setCreditTransactions(data.creditTransactions || []);
            setCreditRedemptions(data.creditRedemptions || []);
            if (data.rewardsConfig) {
                setRewardsConfig(data.rewardsConfig);
            }
            if (data.livePlatformConfig) {
                setLivePlatformConfig({
                    ...DEFAULT_LIVE_PLATFORM_CONFIG,
                    ...data.livePlatformConfig
                });
            } else {
                setLivePlatformConfig(DEFAULT_LIVE_PLATFORM_CONFIG);
            }
            if (data.paymentGatewayConfig) {
                setPaymentGatewayConfig({
                    ...DEFAULT_PAYMENT_GATEWAY_CONFIG,
                    ...data.paymentGatewayConfig
                });
            } else {
                setPaymentGatewayConfig(DEFAULT_PAYMENT_GATEWAY_CONFIG);
            }
            
            console.log('Bootstrap data successfully loaded into state');
            console.log('========== FRONTEND: BOOTSTRAP REQUEST END ==========\n');
        } catch (error) {
            console.error('\n========== FRONTEND: BOOTSTRAP ERROR ==========');
            console.error('Error details:', error);
            console.error('========== FRONTEND: BOOTSTRAP ERROR END ==========\n');
            setBootError(error instanceof Error ? error.message : 'Failed to load platform data');
        } finally {
            setIsBootstrapping(false);
        }
    }, []);

    const fetchUserProgress = useCallback(async (targetUserId: string) => {
        if (!targetUserId) return;
        try {
            const response = await fetch(`/api/users/${targetUserId}/progress`);
            if (!response.ok) {
                throw new Error('Failed to load progress');
            }
            const payload = await response.json();
            setCourseProgress(payload.courseProgress || []);
            if (payload.user) {
                handleUserUpdate(payload.user);
            }
        } catch (error) {
            console.error('Progress fetch error', error);
        }
    }, [handleUserUpdate]);

    useEffect(() => {
        fetchPlatformData();
    }, [fetchPlatformData]);

    useEffect(() => {
        if (user?.id) {
            fetchUserProgress(user.id);
        } else {
            setCourseProgress([]);
        }
    }, [user?.id, fetchUserProgress]);

    useEffect(() => {
        if (!user?.id) {
            setNotifications([]);
            setUnreadNotifications(0);
            setNotificationsError(null);
            disconnectNotificationStream();
            return;
        }
        fetchUserNotifications(user.id);
    }, [user?.id, fetchUserNotifications, disconnectNotificationStream]);

    useEffect(() => {
        if (!user?.id) {
            return;
        }

        let isMounted = true;

        const connect = () => {
            if (!isMounted || !user?.id) {
                return;
            }
            disconnectNotificationStream();
            const source = new EventSource(`/api/notifications/events?userId=${user.id}`);
            notificationStreamRef.current = source;

            const parseEvent = (event: MessageEvent) => {
                if (!event.data) {
                    return null;
                }
                try {
                    return JSON.parse(event.data);
                } catch (error) {
                    console.warn('Notification stream parse error', error);
                    return null;
                }
            };

            source.addEventListener('ready', (event) => {
                const payload = parseEvent(event);
                if (payload && typeof payload.unreadCount === 'number') {
                    setUnreadNotifications(payload.unreadCount);
                }
            });

            source.addEventListener('notification:new', (event) => {
                const payload = parseEvent(event);
                if (!payload) {
                    return;
                }
                if (Array.isArray(payload.notifications)) {
                    appendNotifications(payload.notifications as Notification[]);
                } else {
                    appendNotifications(payload as Notification);
                }
            });

            source.addEventListener('notification:updated', (event) => {
                const payload = parseEvent(event);
                if (payload) {
                    upsertNotificationEntry(payload as Notification);
                }
            });

            source.addEventListener('notification:bulk-updated', (event) => {
                const payload = parseEvent(event);
                if (payload?.ids && Array.isArray(payload.ids)) {
                    applyNotificationReadState(payload.ids as string[], Boolean(payload.read));
                }
            });

            source.addEventListener('notification:unread', (event) => {
                const payload = parseEvent(event);
                if (payload && typeof payload.unreadCount === 'number') {
                    setUnreadNotifications(payload.unreadCount);
                }
            });

            source.onerror = () => {
                if (!isMounted) {
                    return;
                }
                disconnectNotificationStream();
                notificationReconnectTimerRef.current = window.setTimeout(connect, 4000);
            };
        };

        connect();

        return () => {
            isMounted = false;
            disconnectNotificationStream();
        };
    }, [user?.id, appendNotifications, applyNotificationReadState, disconnectNotificationStream, upsertNotificationEntry]);

    useEffect(() => {
        const matchedView = PATH_TO_VIEW[experiencePath];
        if (!matchedView) {
            return;
        }
        setViewState((prev) => (prev === matchedView ? prev : matchedView));
    }, [experiencePath]);

    useEffect(() => {
        if (isMainSite && isSaasRoute) {
            return;
        }
        if (PATH_TO_VIEW[experiencePath] || experiencePath === '/enrollment-success') {
            return;
        }

        const blogSlug = extractBlogPostSlugFromPath(location.pathname, tenantBasePath);
        if (blogSlug) {
            if (!blogPosts.length) {
                return;
            }
            const hasPost = blogPosts.some((post) => post.slug === blogSlug || post.id === blogSlug);
            if (hasPost) {
                return;
            }
        }

        const instructorId = extractInstructorIdFromPath(location.pathname, tenantBasePath);
        if (instructorId) {
            if (!platformUsers.length) {
                return;
            }
            const hasInstructor = platformUsers.some(
                (user) => user.id === instructorId && user.role === UserRole.INSTRUCTOR
            );
            if (hasInstructor) {
                return;
            }
        }

        const adId = extractAdIdFromPath(location.pathname, tenantBasePath);
        if (adId) {
            return;
        }

        const targetPath = getPathForView(VIEW_TO_PATH[ViewState.NOT_FOUND] || '/404') || '/404';
        const currentPath = normalizePath(location.pathname);
        const normalizedTarget = normalizePath(targetPath);
        if (view !== ViewState.NOT_FOUND) {
            setViewState(ViewState.NOT_FOUND);
        }
        if (currentPath !== normalizedTarget) {
            navigate(targetPath, { replace: true });
        }
    }, [
        blogPosts,
        experiencePath,
        getPathForView,
        isMainSite,
        isSaasRoute,
        location.pathname,
        navigate,
        platformUsers,
        tenantBasePath,
        view
    ]);

    useEffect(() => {
        const adId = extractAdIdFromPath(location.pathname, tenantBasePath);
        if (!adId) {
            return;
        }
        if (view !== ViewState.AD_DETAIL) {
            setViewState(ViewState.AD_DETAIL);
        }
    }, [location.pathname, tenantBasePath, view]);

    // Handle blog post URLs (/blog/:slug) - now using slugs instead of IDs
    useEffect(() => {
        if (!blogPosts.length) return;

        const slug = extractBlogPostSlugFromPath(location.pathname, tenantBasePath);
        if (!slug) {
            // Clear selected blog post when navigating away from blog post view
            if (selectedBlogPost && view === ViewState.BLOG_POST) {
                setSelectedBlogPostState(null);
            }
            navigationClearedBlogPostRef.current = false;
            return;
        }

        // If we just intentionally cleared the blog post via navigation, skip re-setting it
        // This prevents the race condition where navigate() is async but state updates are sync
        if (navigationClearedBlogPostRef.current) {
            navigationClearedBlogPostRef.current = false;
            return;
        }

        // Try to find post by slug first, fall back to ID for backward compatibility
        let post = blogPosts.find((p) => p.slug === slug);
        if (!post) {
            post = blogPosts.find((p) => p.id === slug);
        }
        
        if (post) {
            if (!selectedBlogPost || selectedBlogPost.id !== post.id) {
                setSelectedBlogPostState(post);
            }
            if (view !== ViewState.BLOG_POST) {
                setViewState(ViewState.BLOG_POST);
            }
        }
    }, [location.pathname, tenantBasePath, blogPosts, selectedBlogPost, view]);

    // Handle instructor profile URLs (/instructor-profile/:id)
    useEffect(() => {
        if (!platformUsers.length) return;

        const instructorId = extractInstructorIdFromPath(location.pathname, tenantBasePath);
        if (!instructorId) {
            // Only clear selected instructor if we're still marked as being on the instructor profile view
            // This prevents conflicts when we've already cleared state during navigation
            if (selectedInstructor && view === ViewState.PUBLIC_INSTRUCTOR_PROFILE) {
                setSelectedInstructorState(null);
            }
            navigationClearedInstructorRef.current = false;
            return;
        }

        // If we just intentionally cleared the instructor via navigation, skip re-setting it
        // This prevents the race condition where navigate() is async but state updates are sync
        if (navigationClearedInstructorRef.current) {
            navigationClearedInstructorRef.current = false;
            return;
        }

        const instructor = platformUsers.find((u) => u.id === instructorId && u.role === UserRole.INSTRUCTOR);
        if (instructor) {
            if (!selectedInstructor || selectedInstructor.id !== instructor.id) {
                setSelectedInstructorState(instructor);
            }
            if (view !== ViewState.PUBLIC_INSTRUCTOR_PROFILE) {
                setViewState(ViewState.PUBLIC_INSTRUCTOR_PROFILE);
            }
        }
    }, [location.pathname, tenantBasePath, platformUsers, selectedInstructor, view]);

    // Restore selected course from URL when courses are loaded
    useEffect(() => {
        if (!courses.length) return;
        const searchParams = new URLSearchParams(location.search);
        const courseId = searchParams.get('courseId');
        if (!courseId) return;
        const course = courses.find(c => c.id === courseId);
        if (course && (!selectedCourse || selectedCourse.id !== course.id)) {
            setSelectedCourseState(course);
        }
    }, [courses, location.search, selectedCourse]);

    useEffect(() => {
        if (experiencePath !== COURSE_PLAYER_PATH) {
            return;
        }
        const searchParams = new URLSearchParams(location.search);
        const currentId = searchParams.get('courseId');
        if (selectedCourse) {
            if (currentId === selectedCourse.id) {
                return;
            }
            searchParams.set('courseId', selectedCourse.id);
            const nextQuery = searchParams.toString();
            const target = nextQuery ? `${location.pathname}?${nextQuery}` : location.pathname;
            navigate(target, { replace: true });
        } else if (currentId) {
            searchParams.delete('courseId');
            const nextQuery = searchParams.toString();
            const target = nextQuery ? `${location.pathname}?${nextQuery}` : location.pathname;
            navigate(target, { replace: true });
        }
    }, [selectedCourse, location.pathname, location.search, navigate, experiencePath]);

    // Update URL when blog post is selected (using slugs for SEO-friendly URLs)
    useEffect(() => {
        // Exit early if not in BLOG_POST view or no selected post
        if (view !== ViewState.BLOG_POST || !selectedBlogPost) {
            // Reset the navigation flag when we're NOT on a blog post view
            navigationClearedBlogPostRef.current = false;
            return;
        }

        // Use slug instead of ID for SEO-friendly URLs
        const targetPath = `/blog/${selectedBlogPost.slug}`;
        const resolvedPath = getPathForView(targetPath) || targetPath;
        const currentPath = normalizePath(location.pathname);
        const normalizedTarget = normalizePath(resolvedPath);

        // If already on the correct URL, do nothing
        if (currentPath === normalizedTarget) {
            return;
        }

        // Navigate to the blog post URL
        navigate(resolvedPath, { replace: true });
    }, [selectedBlogPost, view, location.pathname, navigate, getPathForView]);

    // Update URL when instructor is selected for public profile
    useEffect(() => {
        if (view !== ViewState.PUBLIC_INSTRUCTOR_PROFILE || !selectedInstructor) {
            // Reset the navigation flag when we're NOT on an instructor profile view
            navigationClearedInstructorRef.current = false;
            return;
        }

        const targetPath = `/instructor-profile/${selectedInstructor.id}`;
        const resolvedPath = getPathForView(targetPath) || targetPath;
        const currentPath = normalizePath(location.pathname);
        const normalizedTarget = normalizePath(resolvedPath);

        if (currentPath !== normalizedTarget) {
            navigate(resolvedPath, { replace: true });
        }
    }, [selectedInstructor, view, location.pathname, navigate, getPathForView]);

    useEffect(() => {
        if (view !== ViewState.COURSE_PLAYER || selectedCourse || !courses.length) {
            return;
        }
        const searchParams = new URLSearchParams(location.search);
        const courseId = searchParams.get('courseId');
        const courseFromQuery = courseId ? courses.find(c => c.id === courseId) : null;
        if (courseFromQuery) {
            setSelectedCourseState(courseFromQuery);
            return;
        }
        const preferredCourseId = user?.enrolledCourses?.find(enrolledId => courses.some(course => course.id === enrolledId));
        const fallbackCourse = (preferredCourseId ? courses.find(course => course.id === preferredCourseId) : undefined) || courses[0];
        if (fallbackCourse) {
            setSelectedCourseState(fallbackCourse);
        }
    }, [view, selectedCourse, courses, user, location.search]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const updateStandaloneStatus = () => {
            const nextValue = detectStandaloneMode();
            setIsInstalled(nextValue);
            isInstalledRef.current = nextValue;
        };
        updateStandaloneStatus();
        const mediaQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(display-mode: standalone)')
            : null;
        const handleDisplayModeChange = () => updateStandaloneStatus();
        if (mediaQuery) {
            if (typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', handleDisplayModeChange);
            } else if (typeof mediaQuery.addListener === 'function') {
                mediaQuery.addListener(handleDisplayModeChange);
            }
        }
        window.addEventListener('visibilitychange', updateStandaloneStatus);
        return () => {
            if (mediaQuery) {
                if (typeof mediaQuery.removeEventListener === 'function') {
                    mediaQuery.removeEventListener('change', handleDisplayModeChange);
                } else if (typeof mediaQuery.removeListener === 'function') {
                    mediaQuery.removeListener(handleDisplayModeChange);
                }
            }
            window.removeEventListener('visibilitychange', updateStandaloneStatus);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            const promptEvent = event as BeforeInstallPromptEvent;
            setDeferredPrompt(promptEvent);
            deferredPromptRef.current = promptEvent;
            setIsInstallable(true);
            if (!hasPromptedInstallRef.current && !isInstalledRef.current) {
                clearInstallPromptTimer();
                installPromptTimerRef.current = window.setTimeout(() => {
                    if (!isInstalledRef.current && deferredPromptRef.current && !hasPromptedInstallRef.current) {
                        setShowInstallModal(true);
                    }
                    clearInstallPromptTimer();
                }, PWA_AUTO_PROMPT_DELAY_MS);
            }
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
            clearInstallPromptTimer();
        };
    }, [clearInstallPromptTimer]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        const handleAppInstalled = () => {
            setIsInstalled(true);
            isInstalledRef.current = true;
            setIsInstallable(false);
            setDeferredPrompt(null);
            deferredPromptRef.current = null;
            setShowInstallModal(false);
            clearInstallPromptTimer();
        };
        window.addEventListener('appinstalled', handleAppInstalled);
        return () => {
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [clearInstallPromptTimer]);

    useEffect(() => {
        if (isInstalled) {
            setShowInstallModal(false);
            clearInstallPromptTimer();
        }
    }, [isInstalled, clearInstallPromptTimer]);

    const hasCriticalBootError = Boolean(bootError) && courses.length === 0 && blogPosts.length === 0 && platformUsers.length === 0;

    const staticPageMap = useMemo(() => {
        return staticPages.reduce<Record<string, StaticPageContent>>((acc, page) => {
            acc[page.slug] = page;
            return acc;
        }, {});
    }, [staticPages]);

    const hydratedSelectedCourse = useMemo(() => {
        return selectedCourse ? hydrateCourseWithProgress(selectedCourse) : null;
    }, [hydrateCourseWithProgress, selectedCourse]);

  // Apply RTL/LTR direction
  useEffect(() => {
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

    const t = translations[lang];
  const navItems: Array<{ view: ViewState; label: string }> = useMemo(() => ([
        { view: ViewState.HOME, label: t.home },
      { view: ViewState.ADS, label: t.adsMarketplace || 'Ads' },
        { view: ViewState.COURSES, label: t.courses },
        { view: ViewState.SERVICES, label: t.services },
        { view: ViewState.BLOG, label: t.blog }
  ]), [t]);

  useEffect(() => {
      if (experiencePath !== '/enrollment-success') {
          return;
      }

      const params = new URLSearchParams(location.search);
      const sessionId = params.get('session_id');
      const tenantId = tenantConfig?.id || 'central';

      console.log('[Enrollment] Enrollment success page loaded', { 
          sessionId, 
          tenantId, 
          userId: user?.id,
          userEmail: user?.email,
          hasUser: !!user 
      });

      // Skip if no session ID or already processed this session
      if (!sessionId) {
          console.warn('[Enrollment] No session ID in URL');
          return;
      }

      if (processedSessionIdsRef.current.has(sessionId)) {
          console.log('[Enrollment] Session already processed, skipping', { sessionId });
          return;
      }

      if (processingSessionIdRef.current === sessionId) {
          console.log('[Enrollment] Session already processing, skipping', { sessionId });
          return;
      }

      if (!user?.id) {
          console.error('[Enrollment] No user logged in, cannot process enrollment');
          notify('error', lang === 'ar' ? 'يجب تسجيل الدخول أولاً' : 'Please log in first');
          navigate(`${tenantBasePath}/login`, { replace: true });
          return;
      }

    // Mark this session as being processed
    processingSessionIdRef.current = sessionId;
    console.log('[Enrollment] Marked session as processing', { sessionId });

      const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      const refreshUser = async () => {
          if (!user?.id) return;
          const response = await fetch(`/api/users/${user.id}`);
          if (!response.ok) {
              throw new Error(t.userUpdateError || 'Failed to update user. Please try again.');
          }
          const payload = await response.json().catch(() => ({}));
          if (payload && isMountedRef.current) {
              handleUserUpdate(payload as User);
          }
      };

      const confirmCoursePayment = async () => {
          if (!sessionId || !tenantId) {
              console.warn('[Enrollment] Missing sessionId or tenantId', { sessionId, tenantId });
              return;
          }
          console.log('[Enrollment] Calling confirm endpoint', { sessionId, tenantId });
          const response = await fetch('/api/course-payment/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tenantId, sessionId })
          });
          if (!response.ok) {
              const payload = await response.json().catch(() => ({}));
              console.error('[Enrollment] Confirm endpoint failed', { status: response.status, payload });
              throw new Error(payload?.error || payload?.message || t.paymentFailed || 'Unable to verify payment');
          }
          const responseData = await response.json().catch(() => ({}));
          console.log('[Enrollment] Confirm endpoint succeeded', responseData);
      };

      const pollPaymentRecord = async (): Promise<any | null> => {
          if (!sessionId || !tenantId) {
              console.warn('[Enrollment] Missing sessionId or tenantId for polling', { sessionId, tenantId });
              return null;
          }
          console.log('[Enrollment] Starting payment record polling', { sessionId, tenantId });
          
          for (let attempt = 0; attempt < 6; attempt += 1) {
              console.log(`[Enrollment] Poll attempt ${attempt + 1}/6`);
              const response = await fetch(`/api/course-payment/session/${sessionId}?tenantId=${tenantId}`);
              if (response.ok) {
                  const payment = await response.json().catch(() => null);
                  console.log('[Enrollment] Payment record found', payment);
                  return payment;
              }
              if (response.status !== 404) {
                  const payload = await response.json().catch(() => ({}));
                  console.error('[Enrollment] Unexpected response during polling', { status: response.status, payload });
                  throw new Error(payload?.error || payload?.message || t.paymentFailed || 'Unable to verify payment');
              }
              console.log(`[Enrollment] Payment record not found yet (404), waiting...`);
              await wait(1500);
          }

          console.log('[Enrollment] Payment record not found after 6 attempts, calling confirm endpoint');
          await confirmCoursePayment();

          console.log('[Enrollment] Performing final check after confirm');
          const finalCheck = await fetch(`/api/course-payment/session/${sessionId}?tenantId=${tenantId}`);
          if (!finalCheck.ok) {
              const payload = await finalCheck.json().catch(() => ({}));
              console.error('[Enrollment] Final check failed', { status: finalCheck.status, payload });
              throw new Error(payload?.error || payload?.message || t.paymentFailed || 'Unable to verify payment');
          }
          const finalPayment = await finalCheck.json().catch(() => null);
          console.log('[Enrollment] Final check passed, payment record confirmed', finalPayment);
          return finalPayment;
      };

      const run = async () => {
          try {
              console.log('[Enrollment] Starting verification process', { sessionId, tenantId, userId: user?.id });
              notify('info', t.verifyingEnrollment || 'Verifying enrollment...');
              
              const paymentRecord = await pollPaymentRecord();
              console.log('[Enrollment] Payment record verified');

              const enrolledCourseId = paymentRecord?.course_id || paymentRecord?.courseId;
              if (enrolledCourseId && user) {
                  const currentCourses = Array.isArray(user.enrolledCourses) ? user.enrolledCourses : [];
                  if (!currentCourses.includes(enrolledCourseId)) {
                      handleUserUpdate({
                          ...user,
                          enrolledCourses: [...currentCourses, enrolledCourseId]
                      });
                      console.log('[Enrollment] Updated user enrolled courses', { enrolledCourseId });
                  }
              }
              
              await refreshUser();
              console.log('[Enrollment] User data refreshed');
              if (!isMountedRef.current) return;
              
              // Refresh platform data to ensure newly enrolled course is loaded
              await fetchPlatformData();
              console.log('[Enrollment] Platform data refreshed');
              if (!isMountedRef.current) return;
              
              setViewState(ViewState.DASHBOARD);
              navigate(`${tenantBasePath}${VIEW_TO_PATH[ViewState.DASHBOARD] || '/dashboard'}`, { replace: true });
              notify('success', t.enrollmentSuccess || 'Student enrolled successfully');
              console.log('[Enrollment] Verification complete, redirected to dashboard');
              processedSessionIdsRef.current.add(sessionId);
          } catch (error) {
              console.error('[Enrollment] Verification failed:', error);
              if (!isMountedRef.current) return;
              notify('error', error instanceof Error ? error.message : t.paymentFailed || 'Unable to verify payment');
              setViewState(ViewState.DASHBOARD);
              navigate(`${tenantBasePath}${VIEW_TO_PATH[ViewState.DASHBOARD] || '/dashboard'}`, { replace: true });
          } finally {
              if (processingSessionIdRef.current === sessionId) {
                  processingSessionIdRef.current = null;
              }
          }
      };

      run();

  }, [experiencePath, location.search, tenantConfig?.id, user?.id, lang, t, notify, handleUserUpdate, navigate, tenantBasePath, fetchPlatformData]);

  const handleNavLink = useCallback((event: React.MouseEvent<HTMLAnchorElement>, targetView: ViewState, shouldCloseMenu = false) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
            return;
        }
        event.preventDefault();
        
        setView(targetView);
        if (shouldCloseMenu) {
            setIsMenuOpen(false);
        }
  }, [setView]);

  const handleMobileNavigate = useCallback((targetView: ViewState) => {
      setView(targetView);
      setIsMenuOpen(false);
  }, [setView]);

  // --- REWARDS SYSTEM ---
  const handleReward = useCallback(async (reward: RewardGrantRequest) => {
      if (!user?.id) {
          return;
      }
      try {
          const response = await fetch('/api/rewards/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  userId: user.id,
                  courseId: reward.courseId,
                  rewardType: reward.rewardType,
                  rewardKey: reward.rewardKey,
                  amount: reward.amount,
                  reason: reward.reason,
                  moduleId: reward.moduleId,
                  itemId: reward.itemId
              })
          });

          if (!response.ok) {
              console.error('Reward grant failed', response.statusText);
              return;
          }

          const payload = await response.json();
          if (payload.alreadyGranted) {
              return;
          }

          if (payload.user) {
              handleUserUpdate(payload.user as User);
          }

          if (payload.transaction) {
              setCreditTransactions(prev => [payload.transaction as CreditTransaction, ...prev]);
          }

          const amountLabel = reward.amount.toLocaleString();
          const message = lang === 'ar'
              ? `حصلت على ${amountLabel} ${t.credits}! (${reward.reason})`
              : `You earned ${amountLabel} ${t.credits}! (${reward.reason})`;
          console.info(message);
      } catch (error) {
          console.error('Reward grant error', error);
      }
    }, [handleUserUpdate, lang, setCreditTransactions, t, user]);

  // --- ENROLLMENT LOGIC ---
  const handleEnrollmentSuccess = async (): Promise<boolean> => {
      if (!user || !selectedCourse) {
          notify('error', t.signInTitle || 'Please sign in to continue');
          return false;
      }
      try {
          const response = await fetch('/api/enrollments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: user.id, courseId: selectedCourse.id })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
              throw new Error(payload?.error || t.courseEnrollmentFailed || 'Failed to enroll in course');
          }
          const updatedUser: User = payload?.user || payload;
          handleUserUpdate(updatedUser);
          console.info(`Successfully enrolled in ${selectedCourse.title}`);
          return true;
      } catch (error) {
          notify('error', error instanceof Error ? error.message : t.courseEnrollmentFailed || 'Unable to enroll right now.');
          return false;
      }
  };

    // --- AUTH ---
    const demoPasswordsByRole: Record<UserRole, string | undefined> = {
        [UserRole.STUDENT]: 'student123',
        [UserRole.MEMBER]: 'member123',
        [UserRole.INSTRUCTOR]: 'instructor123',
        [UserRole.ADMIN]: 'admin123',
        [UserRole.SUPER_ADMIN]: '12345678',
        [UserRole.VISITOR]: 'visitor123',
        [UserRole.GUEST]: undefined
    };

    const handleLogin = async (role: UserRole) => {
        const candidate = platformUsers.find((u) => u.role === role);
        if (!candidate?.email) {
            notify('warning', lang === 'ar' ? 'لا يوجد مستخدم لهذا الدور بعد.' : 'No user exists for this role yet.');
            return;
        }

        const password = demoPasswordsByRole[role];
        if (!password) {
            notify('error', lang === 'ar' ? 'بيانات تسجيل الدخول غير متاحة لهذا الدور.' : 'Demo credentials are not available for this role.');
            return;
        }

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept-Language': lang === 'ar' ? 'ar' : 'en'
                },
                body: JSON.stringify({ email: candidate.email, password })
            });

            if (!response.ok) {
                const error = await response.json();
                notify('error', error.error || getErrorMessage('errors.authLoginFailed', lang as 'en' | 'ar', 'Login failed'));
                return;
            }

            const userData: User = await response.json();
            handleUserUpdate(userData);
            setView(ViewState.DASHBOARD);
        } catch (error) {
            console.error('Demo login error:', error);
            notify('error', getErrorMessage('errors.authLoginFailed', lang as 'en' | 'ar', 'An error occurred during login'));
        }
    };

  const handleLogout = () => {
    localStorage.removeItem('betacademy_user');
    clearGuestMode(); // Clear guest session on logout
    setUser(null);
    setView(ViewState.HOME);
  };

  // Guest mode handlers
  const handleOpenGuestModal = () => {
    setShowRoleSelectionModal(true);
  };

  const handleSelectGuestRole = (role: GuestRole) => {
    const session = setGuestMode(role);
    const guestUser: User = {
      id: session.sessionId,
      name: role === 'STUDENT' ? 'زائر (متدرب)' : 'زائر (مدرب)',
      email: '',
      role: UserRole.GUEST,
      guestRole: role,
      credits: 0,
      streak: 0,
      enrolledCourses: []
    };
    setUser(guestUser);
    setShowRoleSelectionModal(false);
    setView(ViewState.DASHBOARD);
  };

  const handleShowRestrictionModal = () => {
    setShowRestrictionModal(true);
  };

  const handleRestrictionSignup = () => {
    setShowRestrictionModal(false);
    setView(ViewState.REGISTER);
  };

  const handleRestrictionLogin = () => {
    setShowRestrictionModal(false);
    setView(ViewState.LOGIN);
  };

    const scrollToAnchorWithHighlight = useCallback((anchor: string) => {
        if (!anchor || typeof window === 'undefined') {
            return;
        }

        let attempts = 0;
        const maxAttempts = 20;

        const focusTarget = () => {
            attempts += 1;
            const decodedAnchor = decodeURIComponent(anchor);
            const target =
                document.getElementById(decodedAnchor) ||
                document.querySelector<HTMLElement>(`[data-anchor="${decodedAnchor}"]`) ||
                document.querySelector<HTMLElement>(`[id="${decodedAnchor}"]`);

            if (!target) {
                if (attempts < maxAttempts) {
                    window.setTimeout(focusTarget, 140);
                }
                return;
            }

            const y = window.scrollY + target.getBoundingClientRect().top - 132;
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });

            const originalTransition = target.style.transition;
            const originalShadow = target.style.boxShadow;
            const originalBackground = target.style.backgroundColor;

            target.style.transition = 'box-shadow 200ms ease, background-color 200ms ease';
            target.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.35)';
            target.style.backgroundColor = 'rgba(254, 242, 242, 0.9)';

            window.setTimeout(() => {
                target.style.boxShadow = originalShadow;
                target.style.backgroundColor = originalBackground;
                target.style.transition = originalTransition;
            }, 1800);
        };

        focusTarget();
    }, []);

    const handleGlobalSearchSelect = useCallback((item: GlobalSearchItem) => {
        const basePath = getPathForView(item.route) || item.route;
        const hashSuffix = item.anchor ? `#${encodeURIComponent(item.anchor)}` : '';
        const targetPath = `${basePath}${hashSuffix}`;
        const currentPathWithHash = `${normalizePath(location.pathname)}${location.hash || ''}`;

        if (currentPathWithHash === targetPath) {
            if (item.anchor) {
                scrollToAnchorWithHighlight(item.anchor);
            }
            return;
        }

        navigate(targetPath);
        if (item.anchor) {
            window.setTimeout(() => scrollToAnchorWithHighlight(item.anchor as string), 60);
        }
    }, [getPathForView, location.hash, location.pathname, navigate, scrollToAnchorWithHighlight]);

    useEffect(() => {
        if (!location.hash) {
            return;
        }
        const anchor = decodeURIComponent(location.hash.replace(/^#/, '').trim());
        if (!anchor) {
            return;
        }
        scrollToAnchorWithHighlight(anchor);
    }, [location.hash, location.pathname, scrollToAnchorWithHighlight]);

    const dashboardSearchBar = user ? <GlobalSearchBar lang={lang} user={user} onSelect={handleGlobalSearchSelect} /> : null;

  const toggleLanguage = () => {
    setLang(prev => prev === 'ar' ? 'en' : 'ar');
  };

    const handleBackNavigation = useCallback(() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
            navigate(-1);
            return;
        }

        const fallbackPath = user
            ? (getPathForView('/dashboard/overview') || getPathForView('/dashboard') || '/dashboard')
            : (getPathForView('/') || '/');

        navigate(fallbackPath);
    }, [getPathForView, navigate, user]);

  // Automatically navigate guest users to dashboard
  useEffect(() => {
    if (user?.role === UserRole.GUEST && view === ViewState.HOME) {
      setView(ViewState.DASHBOARD);
    }
  }, [user?.role, view, setView]);

    const publicAnnouncementViews = useMemo(() => new Set<ViewState>([
        ViewState.HOME,
        ViewState.ADS,
        ViewState.AD_DETAIL,
        ViewState.COURSES,
        ViewState.SERVICES,
        ViewState.BLOG,
        ViewState.BLOG_POST,
        ViewState.WHO_WE_ARE,
        ViewState.CAREERS,
        ViewState.CONTACT_US,
        ViewState.PRIVACY,
        ViewState.TOS,
        ViewState.PUBLIC_INSTRUCTOR_PROFILE,
        ViewState.ENROLLMENT
    ]), []);

    const showAnnouncementBar = publicAnnouncementViews.has(view) && topAnnouncements.length > 0;

    const getAnnouncementText = useCallback((item: AdAnnouncement) => {
        if (lang === 'ar') {
            return item.textAr || item.textEn || item.text || '';
        }
        return item.textEn || item.textAr || item.text || '';
    }, [lang]);

    useEffect(() => {
        if (!showAnnouncementBar) {
            setAnnouncementDurationSeconds(24);
            return;
        }

        const updateDuration = () => {
            const marqueeEl = announcementMarqueeRef.current;
            if (!marqueeEl) {
                setAnnouncementDurationSeconds(24);
                return;
            }

            const loopDistancePx = marqueeEl.scrollWidth / 2;
            if (!loopDistancePx || !Number.isFinite(loopDistancePx)) {
                setAnnouncementDurationSeconds(24);
                return;
            }

            // Keep roughly constant movement speed across short/long announcement sets.
            const pxPerSecond = 100;
            const computed = loopDistancePx / pxPerSecond;
            const clamped = Math.min(24, Math.max(8, Math.round(computed)));
            setAnnouncementDurationSeconds(clamped);
        };

        updateDuration();
        window.addEventListener('resize', updateDuration);
        return () => {
            window.removeEventListener('resize', updateDuration);
        };
    }, [showAnnouncementBar, topAnnouncements, lang]);

    useEffect(() => {
        let disposed = false;
        const loadAnnouncements = async () => {
            try {
                const response = await fetch('/api/ads/announcements');
                const payload = await response.json().catch(() => []);
                if (!response.ok || !Array.isArray(payload)) {
                    throw new Error('Unable to load announcements');
                }
                if (!disposed) {
                    setTopAnnouncements(payload);
                }
            } catch {
                if (!disposed) {
                    setTopAnnouncements([]);
                }
            }
        };
        loadAnnouncements();
        return () => {
            disposed = true;
        };
    }, [tenantSubdomain, isMainSite]);

  const handleMarkNotificationRead = useCallback(async (notificationId: string, nextRead = true) => {
      if (!user?.id || !notificationId) {
          return;
      }
      try {
          const response = await fetch(`/api/users/${user.id}/notifications/${notificationId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ read: nextRead, viewerId: user.id })
          });
          if (!response.ok) {
              throw new Error('Unable to update notification');
          }
          const payload = await response.json();
          upsertNotificationEntry(payload as Notification);
      } catch (error) {
          console.error('Notification update error', error);
      }
  }, [upsertNotificationEntry, user?.id]);

  const handleMarkAllNotifications = useCallback(async () => {
      if (!user?.id) {
          return;
      }
      try {
          const response = await fetch(`/api/users/${user.id}/notifications/mark-all-read`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ viewerId: user.id })
          });
          if (!response.ok) {
              throw new Error('Unable to update notifications');
          }
          await response.json();
          setNotifications((prev) => {
              const timestamp = new Date().toISOString();
              return prev.map((item) => (item.read ? item : { ...item, read: true, readAt: timestamp }));
          });
          setUnreadNotifications(0);
      } catch (error) {
          console.error('Mark all notifications error', error);
      }
  }, [user?.id]);

  // --- NAVIGATION COMPONENT ---
      const Navbar = () => {
            const notificationPreview = notifications.slice(0, MAX_VISIBLE_NOTIFICATIONS);
            const logoutLabel = lang === 'ar' ? 'تسجيل الخروج' : 'Logout';
            const loginLabel = lang === 'ar' ? 'تسجيل الدخول' : 'Login';
            const backLabel = lang === 'ar' ? 'رجوع' : 'Back';
            const showNavbarBack = true;
        const installButtonLabel = t.installApp || 'Install App';
            const logoSrc = (tenantBranding?.logoUrl && tenantBranding.logoUrl.trim()) || BRAND_LOGO_PATH;
            return (
            <nav className={`bg-white shadow-sm sticky ${showAnnouncementBar ? 'top-10' : 'top-0'} z-40 border-b border-zinc-200`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16 gap-4">
                            <div className="flex items-center">
                            {showNavbarBack && (
                                <button
                                    type="button"
                                    onClick={handleBackNavigation}
                                    className="me-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 px-2.5 py-1.5 text-xs sm:text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                                    aria-label={backLabel}
                                    title={backLabel}
                                >
                                    <span className="inline-flex items-center justify-center rounded-full bg-red-900 p-1 text-white">
                                        {lang === 'ar' ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="hidden sm:inline">{backLabel}</span>
                                </button>
                            )}
                            <div className="flex-shrink-0 flex items-center cursor-pointer" onClick={() => setView(ViewState.HOME)}>
                                <img src={logoSrc} alt="Betacademy Logo" className="h-14 w-14 sm:h-20 sm:w-20 object-contain" />
                            </div>
                            <div className="hidden sm:ms-6 sm:flex sm:space-x-8 space-s-8">
                                {navItems.map(({ view: navView, label }) => {
                                        const path = getPathForView(VIEW_TO_PATH[navView] || '/') || '/';
                                            const isActive = view === navView;
                                            return (
                                                    <Link
                                                            key={navView}
                                                            to={path}
                                                            onClick={(event) => handleNavLink(event, navView)}
                                                            className={`${isActive ? 'border-red-600 text-zinc-900' : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'} inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium mx-2 transition-colors`}
                                                    >
                                                            {label}
                                                    </Link>
                                            );
                                })}
                            </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4">
                {isMainSite && (
                    <Link
                        to="/saas"
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-red-900 text-white px-4 py-2 text-sm font-semibold shadow-sm transition-colors hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-200"
                        aria-label={t.launchYourAcademy}
                    >
                        <GraduationCap className="h-4 w-4" />
                        <span>{t.launchYourAcademy}</span>
                    </Link>
                )}
                <button
                    onClick={handleInstallButtonClick}
                    className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 shadow-sm transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200"
                    aria-label={installButtonLabel}
                    title={installButtonLabel}
                >
                    <Download className="h-4 w-4" />
                    <span>{installButtonLabel}</span>
                </button>
                 <button 
                    onClick={toggleLanguage}
                    className="p-2 text-zinc-500 hover:text-red-600 flex items-center gap-1 text-sm font-medium transition-colors rounded-full"
                    aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
                 >
                    <Globe className="h-5 w-5" />
                    <span className="hidden sm:inline">{lang === 'ar' ? 'English' : 'العربية'}</span>
                 </button>

                 {user && (
                 <div className="relative">
                     <button
                        onClick={() => setIsNotificationsOpen((prev) => !prev)}
                        className="p-2 rounded-full text-zinc-500 hover:text-red-600 focus:outline-none transition-colors"
                        aria-haspopup="true"
                        aria-expanded={isNotificationsOpen}
                     >
                         <span className="sr-only">{t.notifications}</span>
                         <Bell className="h-5 w-5" />
                         {unreadNotifications > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-[1.15rem] h-4 bg-red-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                                {unreadNotifications > 9 ? '9+' : unreadNotifications}
                            </span>
                         )}
                     </button>
                     {isNotificationsOpen && (
                         <div className="origin-top-right absolute right-0 rtl:left-0 rtl:right-auto mt-2 w-[92vw] max-w-md sm:max-w-lg rounded-2xl shadow-2xl border border-zinc-100 bg-white focus:outline-none z-50">
                             <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
                                 <div>
                                     <p className="text-sm font-bold text-zinc-900">{t.notifications}</p>
                                     <p className="text-xs text-zinc-500">
                                         {user ? `${unreadNotifications} ${t.unread || 'unread'}` : (t.notificationsLoginPrompt || 'Sign in to receive alerts.')}
                                     </p>
                                 </div>
                                 {unreadNotifications > 0 && (
                                     <button
                                        onClick={handleMarkAllNotifications}
                                        className="text-xs font-semibold text-red-600 hover:text-red-700"
                                     >
                                        {t.markAllRead || 'Mark all read'}
                                     </button>
                                 )}
                             </div>
                             <div className="max-h-96 overflow-y-auto divide-y divide-zinc-100">
                                 {!user && (
                                     <div className="px-4 py-6 text-center text-sm text-zinc-400">
                                         {t.notificationsLoginPrompt || 'Sign in to receive alerts.'}
                                     </div>
                                 )}
                                 {user && isLoadingNotifications && (
                                     <div className="px-4 py-4 text-center text-sm text-zinc-500">
                                         {t.loadingNotifications || 'Loading notifications...'}
                                     </div>
                                 )}
                                 {user && !isLoadingNotifications && notificationsError && (
                                     <div className="px-4 py-4 text-center text-sm text-red-600">
                                         {t.notificationsError || 'Unable to load notifications.'}
                                     </div>
                                 )}
                                 {user && !isLoadingNotifications && !notificationsError && notificationPreview.length === 0 && (
                                     <div className="px-4 py-6 text-center text-sm text-zinc-400">
                                         {t.noNotifications || 'No notifications yet.'}
                                     </div>
                                 )}
                                 {user && !isLoadingNotifications && !notificationsError && notificationPreview.map((note) => {
                                     const meta = getNotificationCategoryMeta(note.category);
                                     const Icon = meta.icon;
                                     const timestamp = formatNotificationTimestamp(note.createdAt, lang);
                                     const translatedMessage = translateNotificationMessage(note.message, t);
                                     return (
                                         <div key={note.id} className={`px-4 py-3 flex gap-3 ${note.read ? 'bg-white' : 'bg-red-50/50'}`}>
                                             <div className={`${meta.badgeBg} ${meta.badgeText} h-10 w-10 rounded-xl flex items-center justify-center shrink-0`}>
                                                 <Icon className="h-4 w-4" />
                                             </div>
                                             <div className="flex-1 min-w-0">
                                                 <div className="flex items-center justify-between gap-3">
                                                     <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{meta.label[lang]}</span>
                                                     <span className="text-[11px] text-zinc-400">{timestamp}</span>
                                                 </div>
                                                 <p className="text-sm font-medium text-zinc-900 mt-0.5 line-clamp-2">{translatedMessage}</p>
                                                 {note.metadata?.courseTitle && (
                                                     <p className="text-xs text-zinc-500 mt-1">{note.metadata.courseTitle}</p>
                                                 )}
                                                 <div className="mt-2 flex items-center gap-3">
                                                     <span className={`text-[11px] font-semibold ${note.read ? 'text-zinc-400' : 'text-red-600'}`}>
                                                         {note.read ? (t.read || 'Read') : (t.unread || 'Unread')}
                                                     </span>
                                                     <button
                                                         onClick={() => handleMarkNotificationRead(note.id, !note.read)}
                                                         className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900"
                                                     >
                                                         {note.read ? (t.markUnread || 'Mark unread') : (t.markRead || 'Mark read')}
                                                     </button>
                                                 </div>
                                             </div>
                                         </div>
                                     );
                                 })}
                             </div>
                             {user && notifications.length > MAX_VISIBLE_NOTIFICATIONS && (
                                 <div className="px-4 py-2 text-[11px] text-zinc-500 text-center bg-zinc-50">
                                     {t.showingLatest || 'Showing latest updates'}
                                 </div>
                             )}
                         </div>
                     )}
                 </div>
                 )}

                {user ? (
                  <>
                    <div className="hidden sm:flex items-center gap-4">
                        <div className="flex items-center gap-1 bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full border border-yellow-200">
                            <Coins className="h-4 w-4" />
                            <span className="text-sm font-bold">{user.credits}</span>
                        </div>
                        <button onClick={() => setView(ViewState.DASHBOARD)} className="text-sm font-medium text-red-600 hover:text-red-700 transition-colors">
                            {t.dashboard}
                        </button>
                        <button onClick={handleLogout} className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors inline-flex items-center gap-2">
                            <LogOut className="h-4 w-4" />
                            <span>{logoutLabel}</span>
                        </button>
                    </div>
                    <div className="flex sm:hidden items-center gap-2">
                        <button onClick={() => handleMobileNavigate(ViewState.DASHBOARD)} className="px-3 py-1 rounded-full border border-red-200 text-xs font-semibold text-red-700">
                            {t.dashboard}
                        </button>
                        <button onClick={() => { handleLogout(); setIsMenuOpen(false); }} className="p-2 rounded-full text-zinc-500 hover:text-red-600" aria-label={logoutLabel}>
                            <LogOut className="h-4 w-4" />
                        </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="hidden sm:flex gap-2">
                        <button onClick={() => setView(ViewState.LOGIN)} className="text-zinc-600 hover:text-zinc-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">{t.login}</button>
                        <button onClick={() => setView(ViewState.REGISTER)} className="bg-red-900 text-white hover:bg-red-950 px-4 py-2 rounded-md text-sm font-medium shadow-sm transition-colors">{t.signup}</button>
                    </div>
                    <div className="flex sm:hidden items-center gap-1">
                        <button onClick={() => handleMobileNavigate(ViewState.LOGIN)} className="px-3 py-1 rounded-full border border-zinc-200 text-xs font-semibold text-zinc-600">
                            {loginLabel}
                        </button>
                        <button onClick={() => handleMobileNavigate(ViewState.REGISTER)} className="px-3 py-1 rounded-full bg-red-900 text-white text-xs font-semibold shadow-sm">
                            {t.signup}
                        </button>
                    </div>
                  </>
                )}

                <button onClick={() => setIsMenuOpen(!isMenuOpen)} className="-mr-2 inline-flex items-center justify-center p-2 rounded-md text-zinc-400 hover:text-zinc-500 hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-red-600 sm:hidden">
                  <span className="sr-only">Open main menu</span>
                  {isMenuOpen ? <X className="block h-6 w-6" /> : <Menu className="block h-6 w-6" />}
                </button>
              </div>
            </div>
          </div>
      
          {isMenuOpen && (
            <div className="sm:hidden bg-white border-b border-zinc-200">
                        <div className="pt-2 pb-3 space-y-1">
                                {navItems.map(({ view: navView, label }, index) => {
                                        const path = getPathForView(VIEW_TO_PATH[navView] || '/') || '/';
                                            const isPrimary = index === 0;
                                            return (
                                                    <Link
                                                            key={`mobile-${navView}`}
                                                            to={path}
                                                            onClick={(event) => handleNavLink(event, navView, true)}
                                                            className={`${isPrimary ? 'bg-red-50 border-red-600 text-red-700' : 'border-transparent text-zinc-500 hover:bg-zinc-50 hover:border-zinc-300 hover:text-zinc-700'} block ps-3 pe-4 py-2 border-l-4 rtl:border-l-0 rtl:border-r-4 text-base font-medium text-start w-full`}
                                                    >
                                                            {label}
                                                    </Link>
                                            );
                            })}
                                 <Link
                                    to={getPathForView(VIEW_TO_PATH[ViewState.DASHBOARD] || '/dashboard') || '/dashboard'}
                                    onClick={(event) => handleNavLink(event, ViewState.DASHBOARD, true)}
                                    className="border-transparent text-zinc-500 hover:bg-zinc-50 hover:border-zinc-300 hover:text-zinc-700 block ps-3 pe-4 py-2 border-l-4 rtl:border-l-0 rtl:border-r-4 text-base font-medium text-start w-full"
                            >
                                    {t.dashboard}
                            </Link>
                        </div>
                        <div className="border-t border-zinc-100 px-4 py-4 space-y-3">
                            {user ? (
                                <>
                                    <div className="flex items-center justify-between text-sm font-semibold text-zinc-600">
                                        <span>{t.credits}</span>
                                        <span className="text-yellow-600 flex items-center gap-1"><Coins className="h-4 w-4" /> {user.credits}</span>
                                    </div>
                                    <button onClick={() => handleMobileNavigate(ViewState.DASHBOARD)} className="w-full px-4 py-2 rounded-lg border border-red-200 text-red-700 font-semibold">
                                        {t.dashboard}
                                    </button>
                                    <button onClick={() => { handleLogout(); setIsMenuOpen(false); }} className="w-full px-4 py-2 rounded-lg bg-zinc-100 text-zinc-700 font-semibold">
                                        {logoutLabel}
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button onClick={() => handleMobileNavigate(ViewState.LOGIN)} className="w-full px-4 py-2 rounded-lg border border-zinc-200 text-zinc-700 font-semibold">
                                        {loginLabel}
                                    </button>
                                    <button onClick={() => handleMobileNavigate(ViewState.REGISTER)} className="w-full px-4 py-2 rounded-lg bg-red-900 text-white font-semibold shadow-sm">
                                        {t.signup}
                                    </button>
                                </>
                            )}
                        </div>
            </div>
          )}
        </nav>
        );
        };

  // --- LOGIN VIEW ---
  const LoginView = () => {
      const [email, setEmail] = useState('');
      const [password, setPassword] = useState('');
      const [isLoggingIn, setIsLoggingIn] = useState(false);
      const [showPassword, setShowPassword] = useState(false);

      const handleEmailLogin = async (e: React.FormEvent) => {
          e.preventDefault();
          if (!email || !password) {
              notify('error', getErrorMessage('errors.authEmailRequired', lang as 'en' | 'ar', 'Please enter email and password'));
              return;
          }

          try {
              setIsLoggingIn(true);
              const response = await fetch('/api/auth/login', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'Accept-Language': lang === 'ar' ? 'ar' : 'en'
                  },
                  body: JSON.stringify({ email, password })
              });

              if (!response.ok) {
                  const error = await response.json();
                  notify('error', error.error || getErrorMessage('errors.authLoginFailed', lang as 'en' | 'ar', 'Login failed'));
                  return;
              }

              const data = await response.json();
              const userData: User = data.user || data;
              handleUserUpdate(userData);
              setView(ViewState.DASHBOARD);
          } catch (error) {
              console.error('Login error:', error);
              notify('error', getErrorMessage('errors.authLoginFailed', lang as 'en' | 'ar', 'An error occurred during login'));
          } finally {
              setIsLoggingIn(false);
          }
      };

      return (
          <div className="min-h-screen flex items-center justify-center bg-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
              <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-xl shadow-lg border border-zinc-100">
                  <div>
                      <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">{t.signInTitle}</h2>
                  </div>

                  {/* Email/Password Login Form */}
                  <form onSubmit={handleEmailLogin} className="space-y-4">
                      <div>
                          <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">
                              {t.emailLabel}
                          </label>
                          <input
                              id="email"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="appearance-none relative block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 rounded-md focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                              placeholder={t.emailLabel}
                              disabled={isLoggingIn}
                          />
                      </div>
                      <div>
                          <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1">
                              {t.passwordLabel}
                          </label>
                          <div className="relative">
                              <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                  disabled={isLoggingIn}
                              >
                                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                              <input
                                  id="password"
                                  type={showPassword ? "text" : "password"}
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  className="appearance-none relative block w-full pl-10 pr-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 rounded-md focus:outline-none focus:ring-red-500 focus:border-red-500 focus:z-10 sm:text-sm"
                                  placeholder={t.passwordLabel}
                                  disabled={isLoggingIn}
                              />
                          </div>
                      </div>
                      <button
                          type="submit"
                          disabled={isLoggingIn}
                          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-900 hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors disabled:bg-zinc-400 disabled:cursor-not-allowed"
                      >
                          {isLoggingIn ? (lang === 'ar' ? 'جاري تسجيل الدخول...' : 'Logging in...') : t.login}
                      </button>
                      <div className="text-end">
                          <button
                              type="button"
                              onClick={() => setView(ViewState.FORGOT_PASSWORD)}
                              className="text-sm font-medium text-red-600 hover:text-red-700"
                          >
                              {lang === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot password?'}
                          </button>
                      </div>
                  </form>

                  <div className="text-center text-sm mt-4">
                      <span className="text-zinc-600">{t.noAccount} </span>
                      <button onClick={() => setView(ViewState.REGISTER)} className="font-medium text-red-600 hover:text-red-500">
                          {t.signupLink}
                      </button>
                  </div>
              </div>
          </div>
      );
  };

  // --- FORGOT PASSWORD VIEW ---
  const ForgotPasswordView = () => {
      const [email, setEmail] = useState('');
      const [loading, setLoading] = useState(false);
      const [submitted, setSubmitted] = useState(false);

      const handleSubmit = async (e: React.FormEvent) => {
          e.preventDefault();
          if (!email.trim()) {
              notify('error', lang === 'ar' ? 'يرجى إدخال البريد الإلكتروني' : 'Please enter your email');
              return;
          }
          try {
              setLoading(true);
              const response = await fetch('/api/auth/forgot-password', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'Accept-Language': lang === 'ar' ? 'ar' : 'en'
                  },
                  body: JSON.stringify({ email: email.trim() })
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                  throw new Error(payload?.error || payload?.message || 'Request failed');
              }
              setSubmitted(true);
          } catch (error) {
              notify('error', error instanceof Error ? error.message : (lang === 'ar' ? 'فشل إرسال الطلب' : 'Failed to submit request'));
          } finally {
              setLoading(false);
          }
      };

      return (
          <div className="min-h-screen flex items-center justify-center bg-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
              <div className="max-w-md w-full space-y-6 bg-white p-10 rounded-xl shadow-lg border border-zinc-100">
                  <h2 className="text-center text-3xl font-extrabold text-zinc-900">
                      {lang === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset Password'}
                  </h2>

                  {!submitted ? (
                      <form onSubmit={handleSubmit} className="space-y-4">
                          <p className="text-sm text-zinc-600 text-center">
                              {lang === 'ar'
                                  ? 'أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور.'
                                  : 'Enter your email and we will send you a password reset link.'}
                          </p>
                          <div>
                              <label htmlFor="forgot-email" className="block text-sm font-medium text-zinc-700 mb-1">
                                  {t.emailLabel}
                              </label>
                              <input
                                  id="forgot-email"
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                  className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-red-500 focus:border-red-500"
                                  disabled={loading}
                              />
                          </div>
                          <button
                              type="submit"
                              disabled={loading}
                              className="w-full flex justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-red-900 hover:bg-red-950 disabled:bg-zinc-400"
                          >
                              {loading ? (lang === 'ar' ? 'جاري الإرسال...' : 'Sending...') : (lang === 'ar' ? 'إرسال الرابط' : 'Send reset link')}
                          </button>
                      </form>
                  ) : (
                      <div className="space-y-4 text-center">
                          <p className="text-sm text-zinc-600">
                              {lang === 'ar'
                                  ? 'إذا كان البريد الإلكتروني موجوداً، تم إرسال رابط إعادة التعيين.'
                                  : 'If the email exists, a reset link has been sent.'}
                          </p>
                      </div>
                  )}

                  <button
                      onClick={() => setView(ViewState.LOGIN)}
                      className="w-full py-2 px-4 rounded-md border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                      {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to login'}
                  </button>
              </div>
          </div>
      );
  };

  // --- RESET PASSWORD VIEW ---
  const ResetPasswordView = () => {
      const [password, setPassword] = useState('');
      const [confirmPassword, setConfirmPassword] = useState('');
      const [loading, setLoading] = useState(false);
      const [done, setDone] = useState(false);
      const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search]);

      const handleSubmit = async (e: React.FormEvent) => {
          e.preventDefault();
          if (!token) {
              notify('error', lang === 'ar' ? 'رابط إعادة التعيين غير صالح' : 'Invalid reset link');
              return;
          }
          if (password.length < 8) {
              notify('error', lang === 'ar' ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters');
              return;
          }
          if (password !== confirmPassword) {
              notify('error', lang === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
              return;
          }

          try {
              setLoading(true);
              const response = await fetch('/api/auth/reset-password', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'Accept-Language': lang === 'ar' ? 'ar' : 'en'
                  },
                  body: JSON.stringify({ token, newPassword: password })
              });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) {
                  throw new Error(payload?.error || payload?.message || 'Reset failed');
              }
              setDone(true);
          } catch (error) {
              notify('error', error instanceof Error ? error.message : (lang === 'ar' ? 'فشل إعادة تعيين كلمة المرور' : 'Failed to reset password'));
          } finally {
              setLoading(false);
          }
      };

      return (
          <div className="min-h-screen flex items-center justify-center bg-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
              <div className="max-w-md w-full space-y-6 bg-white p-10 rounded-xl shadow-lg border border-zinc-100">
                  <h2 className="text-center text-3xl font-extrabold text-zinc-900">
                      {lang === 'ar' ? 'تعيين كلمة مرور جديدة' : 'Set New Password'}
                  </h2>

                  {!token ? (
                      <p className="text-sm text-center text-red-600">
                          {lang === 'ar' ? 'رابط إعادة التعيين غير صالح أو منتهي الصلاحية.' : 'Reset link is invalid or expired.'}
                      </p>
                  ) : done ? (
                      <p className="text-sm text-center text-zinc-600">
                          {lang === 'ar' ? 'تم تغيير كلمة المرور بنجاح.' : 'Password updated successfully.'}
                      </p>
                  ) : (
                      <form onSubmit={handleSubmit} className="space-y-4">
                          <div>
                              <label htmlFor="reset-password" className="block text-sm font-medium text-zinc-700 mb-1">
                                  {t.passwordLabel}
                              </label>
                              <input
                                  id="reset-password"
                                  type="password"
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-red-500 focus:border-red-500"
                                  disabled={loading}
                              />
                          </div>
                          <div>
                              <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-zinc-700 mb-1">
                                  {t.confirmPasswordLabel}
                              </label>
                              <input
                                  id="reset-confirm-password"
                                  type="password"
                                  value={confirmPassword}
                                  onChange={(e) => setConfirmPassword(e.target.value)}
                                  className="w-full px-3 py-2 border border-zinc-300 rounded-md focus:outline-none focus:ring-red-500 focus:border-red-500"
                                  disabled={loading}
                              />
                          </div>
                          <button
                              type="submit"
                              disabled={loading}
                              className="w-full flex justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-red-900 hover:bg-red-950 disabled:bg-zinc-400"
                          >
                              {loading ? (lang === 'ar' ? 'جاري الحفظ...' : 'Saving...') : (lang === 'ar' ? 'تحديث كلمة المرور' : 'Update password')}
                          </button>
                      </form>
                  )}

                  <button
                      onClick={() => setView(ViewState.LOGIN)}
                      className="w-full py-2 px-4 rounded-md border border-zinc-200 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                      {lang === 'ar' ? 'العودة لتسجيل الدخول' : 'Back to login'}
                  </button>
              </div>
          </div>
      );
  };

  // --- REGISTER VIEW ---
    const RegisterView = () => {
        const [role, setRole] = useState<UserRole>(UserRole.STUDENT);
        const [formData, setFormData] = useState({
          name: '',
          email: '',
          password: '',
          confirmPassword: '',
          phone: '',
                    nationalId: '',
          expertise: '',
          gender: '',
          bio: '',
          portfolioUrl: ''
      });
        const [phoneValue, setPhoneValue] = useState<PhoneValue>(parsePhoneValue(''));
        const [isSubmitting, setIsSubmitting] = useState(false);
        const [expertiseError, setExpertiseError] = useState<string | null>(null);
        const [bioError, setBioError] = useState<string | null>(null);
        const [emailError, setEmailError] = useState<string | null>(null);
        const [showPassword, setShowPassword] = useState(false);
        const [showConfirmPassword, setShowConfirmPassword] = useState(false);

        const signupRoleOptions = useMemo<Array<{ value: UserRole; label: string }>>(() => [
            { value: UserRole.STUDENT, label: t.signupRoleStudent || 'Student' },
            { value: UserRole.MEMBER, label: t.signupRoleMember || 'Member' },
            { value: UserRole.INSTRUCTOR, label: t.signupRoleInstructor || 'Instructor' },
            { value: UserRole.ADMIN, label: t.signupRoleAdmin || 'Admin' },
            { value: UserRole.VISITOR, label: t.signupRoleVisitor || 'Visitor' }
        ], [t]);

        useEffect(() => {
            if (!isMainSite && role === UserRole.SUPER_ADMIN) {
                setRole(UserRole.STUDENT);
            }
        }, [isMainSite, role]);

        const requiredFieldHint = lang === 'ar' ? 'حقل مطلوب' : 'Required field';
        const renderLabel = (label: string, isRequired = false) => (
            <span className="inline-flex items-center gap-1">
                <span>{label}</span>
                {isRequired && (
                    <>
                        <span className="text-red-600" aria-hidden="true">*</span>
                        <span className="sr-only">{requiredFieldHint}</span>
                    </>
                )}
            </span>
        );

        const expertisePlaceholder = lang === 'ar'
            ? 'مجال الخبرة/التخصص (مثال: تطوير الويب، علوم البيانات)'
            : 'e.g. Web Development, Data Science';
        const expertiseErrorId = 'expertise-error';
        const bioErrorId = 'bio-error';
        const sanitizeExpertise = (value: string) => value.replace(/[^A-Za-z\u0600-\u06FF\s/]/g, '');
        const hasAlphabeticalChar = (value: string) => /[A-Za-z\u0600-\u06FF]/.test(value);
        
        const handleExpertiseChange = (rawValue: string) => {
            const sanitized = sanitizeExpertise(rawValue);
            if (sanitized !== rawValue) {
                setExpertiseError(lang === 'ar' ? 'يرجى استخدام الحروف والمسافات فقط' : 'Use letters and spaces only');
            } else {
                setExpertiseError(null);
            }
            setFormData(prev => ({ ...prev, expertise: sanitized }));
        };
        
        const handleBioChange = (rawValue: string) => {
            setFormData(prev => ({ ...prev, bio: rawValue }));
            setBioError(null);
        };

        const validateEmail = (email: string) => {
            if (!email) {
                setEmailError(null);
                return true;
            }
            if (!email.includes('@')) {
                setEmailError(getErrorMessage('errors.validationEmailMissingAt', lang as 'en' | 'ar', 'Please include @ in the email address, is missing an @'));
                return false;
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                setEmailError(getErrorMessage('errors.validationInvalidEmail', lang as 'en' | 'ar', 'Please enter a valid email address.'));
                return false;
            }
            setEmailError(null);
            return true;
        };

        const handleEmailChange = (email: string) => {
            setFormData(prev => ({ ...prev, email }));
            if (email) validateEmail(email);
        };

      const duplicateEmailMessage = getErrorMessage('errors.authDuplicateEmail', lang as 'en' | 'ar');

      const buildRegistrationErrorMessage = (status: number, serverMessage?: string) => {
          const normalized = (serverMessage || '').toLowerCase();
          const duplicateIndicators = ['already exists', 'duplicate', 'unique constraint', 'email'];
          if (status === 409 || (serverMessage && duplicateIndicators.some(token => normalized.includes(token)))) {
              return duplicateEmailMessage;
          }
          if (serverMessage) {
              return serverMessage;
          }
          return getErrorMessage('errors.apiRequestFailed', lang as 'en' | 'ar', 'Registration failed');
      };

        const handleSubmit = async (e: React.FormEvent) => {
          e.preventDefault();
          if (!validateEmail(formData.email)) {
              return;
          }
          if (formData.password !== formData.confirmPassword) {
              notify('error', getErrorMessage('errors.authPasswordMismatch', lang as 'en' | 'ar', 'Passwords do not match'));
              return;
          }

          if (!formData.gender) {
              const errorMsg = lang === 'ar' ? 'يرجى تحديد النوع' : 'Please select your gender';
              notify('error', errorMsg);
              return;
          }

            if (role === UserRole.INSTRUCTOR) {
                if (expertiseError) {
                    notify('error', expertiseError);
                    return;
                }
                
                const trimmedExpertise = formData.expertise.trim();
                if (!trimmedExpertise || !hasAlphabeticalChar(trimmedExpertise)) {
                    const errorMsg = lang === 'ar' 
                        ? 'يجب إدخال حرف واحد على الأقل في مجال الخبرة' 
                        : 'Area of Expertise must contain at least one letter';
                    setExpertiseError(errorMsg);
                    notify('error', errorMsg);
                    return;
                }
                
                const trimmedBio = formData.bio.trim();
                if (!trimmedBio || !hasAlphabeticalChar(trimmedBio)) {
                    const errorMsg = lang === 'ar' 
                        ? 'يجب إدخال حرف واحد على الأقل في السيرة الذاتية' 
                        : 'Short Bio must contain at least one letter';
                    setBioError(errorMsg);
                    notify('error', errorMsg);
                    return;
                }
            }

          const normalizedEmail = formData.email.trim().toLowerCase();
          const emailExistsLocally = platformUsers.some(existing => existing.email?.toLowerCase() === normalizedEmail);
          if (emailExistsLocally) {
              notify('error', duplicateEmailMessage);
              return;
          }

          if (!phoneValue.number.trim()) {
              notify('error', lang === 'ar' ? 'رقم الهاتف مطلوب' : 'Phone number is required');
              return;
          }

          const payload = {
              name: formData.name,
              email: formData.email,
              password: formData.password,
              role,
              phone: phoneValue.full || undefined,
              phoneCountryCode: phoneValue.countryCode || undefined,
              nationalId: formData.nationalId.trim() || undefined,
              gender: formData.gender || undefined,
              specialization: formData.expertise.trim() || undefined,
              bio: role === UserRole.INSTRUCTOR ? formData.bio : undefined,
              yearsOfExperience: role === UserRole.INSTRUCTOR ? 0 : undefined,
              portfolioUrl: role === UserRole.INSTRUCTOR ? formData.portfolioUrl : undefined,
              socialLinks: role === UserRole.INSTRUCTOR && formData.portfolioUrl ? { website: formData.portfolioUrl } : undefined
          };

          try {
              setIsSubmitting(true);
              const response = await fetch('/api/users', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
              });
              let responseBody: any = null;
              try {
                  responseBody = await response.json();
              } catch {
                  responseBody = null;
              }

              if (!response.ok || !responseBody) {
                  const serverMessage = typeof responseBody?.error === 'string' ? responseBody.error : undefined;
                  throw new Error(buildRegistrationErrorMessage(response.status, serverMessage));
              }

              const createdUser: User = responseBody as User;
              setPlatformUsers(prev => [createdUser, ...prev]);
              handleUserUpdate(createdUser);
              setView(ViewState.DASHBOARD);
              console.info(lang === 'ar' ? 'مرحباً بك في Betacademy!' : 'Welcome to Betacademy!');
          } catch (error) {
              const fallbackMessage = getErrorMessage('errors.apiRequestFailed', lang as 'en' | 'ar', 'Failed to create account');
              notify('error', error instanceof Error ? error.message : fallbackMessage);
          } finally {
              setIsSubmitting(false);
          }
      };

        const headingCopy = useMemo(() => {
            switch (role) {
                case UserRole.MEMBER:
                    return t.createMemberAccountTitle || t.createAccountTitle;
                case UserRole.INSTRUCTOR:
                    return t.createInstructorAccountTitle || t.createAccountTitle;
                case UserRole.ADMIN:
                    return t.createAdminAccountTitle || t.createAccountTitle;
                case UserRole.SUPER_ADMIN:
                    return t.createSuperAdminAccountTitle || t.createAccountTitle;
                case UserRole.VISITOR:
                    return t.createVisitorAccountTitle || t.createAccountTitle;
                case UserRole.STUDENT:
                default:
                    return t.createStudentAccountTitle || t.createAccountTitle;
            }
        }, [role, t]);

        return (
          <div className="min-h-screen flex items-center justify-center bg-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
              <div className="max-w-md w-full space-y-8 bg-white p-10 rounded-xl shadow-lg border border-zinc-100">
                  <div>
                        <h2 className="mt-6 text-center text-3xl font-extrabold text-zinc-900">{headingCopy}</h2>
                  </div>

                  <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                      <div className="rounded-md shadow-sm space-y-4">
                          <div>
                            <label htmlFor="signupRole" className="block text-sm font-medium text-zinc-700 mb-1">
                                {renderLabel(t.signupRoleLabel || 'I want to sign up as', true)}
                            </label>
                              <select
                                  id="signupRole"
                                  name="signupRole"
                                  required
                                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 bg-white text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                  value={role}
                                  onChange={(e) => setRole(e.target.value as UserRole)}
                              >
                                  {signupRoleOptions.map(option => (
                                      <option key={option.value} value={option.value}>
                                          {option.label}
                                      </option>
                                  ))}
                              </select>
                          </div>
                          <div>
                            <label htmlFor="name" className="block text-sm font-medium text-zinc-700 mb-1">{renderLabel(t.fullName, true)}</label>
                              <input
                                  id="name"
                                  name="name"
                                  type="text"
                                  required
                                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                  value={formData.name}
                                  onChange={e => setFormData({...formData, name: e.target.value})}
                              />
                          </div>
                          <div>
                            <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">{renderLabel(t.emailLabel, true)}</label>
                              <input
                                  id="email"
                                  name="email"
                                  type="text"
                                  inputMode="email"
                                  required
                                  className={`appearance-none rounded-lg relative block w-full px-3 py-2 border placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm ${emailError ? 'border-red-500' : 'border-zinc-300'}`}
                                  value={formData.email}
                                  onChange={e => handleEmailChange(e.target.value)}
                                  onBlur={e => validateEmail(e.target.value)}
                              />
                              {emailError && (
                                  <p className="mt-1 text-xs text-red-600">{emailError}</p>
                              )}
                          </div>
                          <div>
                              <label htmlFor="phone" className="block text-sm font-medium text-zinc-700 mb-1">
                                  {renderLabel(
                                      lang === 'ar' ? 'رقم الهاتف' : 'Phone Number',
                                      true
                                  )}
                              </label>
                              <PhoneInput
                                  id="phone"
                                  name="phone"
                                  required
                                  value={phoneValue}
                                  onChange={setPhoneValue}
                                  placeholder={lang === 'ar' ? 'أدخل رقم الهاتف' : 'Enter phone number'}
                                  aria-label={lang === 'ar' ? 'رقم الهاتف' : 'Phone Number'}
                              />
                          </div>
                          <div>
                              <label htmlFor="nationalId" className="block text-sm font-medium text-zinc-700 mb-1">{t.nationalIdLabel || 'National ID number (Optional)'}</label>
                              <input
                                  id="nationalId"
                                  name="nationalId"
                                  type="text"
                                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                  value={formData.nationalId}
                                  onChange={e => setFormData({...formData, nationalId: e.target.value})}
                                  placeholder={t.nationalIdPlaceholder || 'Enter National ID number'}
                              />
                          </div>

                          {/* Gender field — all roles */}
                          <div>
                              <label htmlFor="gender" className="block text-sm font-medium text-zinc-700 mb-1">
                                  {renderLabel(t.genderLabel || (lang === 'ar' ? 'النوع' : 'Gender'), true)}
                              </label>
                              <select
                                  id="gender"
                                  name="gender"
                                  required
                                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 bg-white text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                  value={formData.gender}
                                  onChange={e => setFormData({...formData, gender: e.target.value})}
                              >
                                  <option value="">{lang === 'ar' ? 'اختر النوع' : 'Select gender'}</option>
                                  <option value="male">{t.genderMale || (lang === 'ar' ? 'ذكر' : 'Male')}</option>
                                  <option value="female">{t.genderFemale || (lang === 'ar' ? 'انثى' : 'Female')}</option>
                              </select>
                          </div>

                          {/* Area of Expertise / field of study — all roles */}
                          <div>
                              <label htmlFor="expertise" className="block text-sm font-medium text-zinc-700 mb-1">
                                  {renderLabel(
                                      t.expertiseLabel || (lang === 'ar' ? 'مجال الخبرة/التخصص الجامعى' : 'Area of Expertise/field of study'),
                                      role === UserRole.INSTRUCTOR
                                  )}
                              </label>
                              <input
                                  id="expertise"
                                  name="expertise"
                                  type="text"
                                  required={role === UserRole.INSTRUCTOR}
                                  placeholder={expertisePlaceholder}
                                  className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                  value={formData.expertise}
                                  onChange={e => handleExpertiseChange(e.target.value)}
                                  inputMode="text"
                                  pattern="^[A-Za-z\u0600-\u06FF /]+$"
                                  title={lang === 'ar' ? 'أدخل حروفاً ومسافات فقط' : 'Enter letters and spaces only'}
                                  aria-invalid={Boolean(expertiseError)}
                                  aria-describedby={expertiseError ? expertiseErrorId : undefined}
                              />
                              {expertiseError && (
                                  <p id={expertiseErrorId} className="mt-1 text-xs text-red-600">{expertiseError}</p>
                              )}
                          </div>

                          {/* Instructor Specific Fields */}
                          {role === UserRole.INSTRUCTOR && (
                              <>
                                  <div>
                                      <label htmlFor="portfolio" className="block text-sm font-medium text-zinc-700 mb-1">{t.portfolioLabel}</label>
                                      <input
                                          id="portfolio"
                                          name="portfolio"
                                          type="url"
                                          placeholder="https://..."
                                          className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                          value={formData.portfolioUrl}
                                          onChange={e => setFormData({...formData, portfolioUrl: e.target.value})}
                                      />
                                  </div>
                                  <div>
                                    <label htmlFor="bio" className="block text-sm font-medium text-zinc-700 mb-1">{renderLabel(t.bioLabel, true)}</label>
                                      <textarea
                                          id="bio"
                                          name="bio"
                                          rows={3}
                                          required
                                          className="appearance-none rounded-lg relative block w-full px-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                          value={formData.bio}
                                          onChange={e => handleBioChange(e.target.value)}
                                          aria-invalid={Boolean(bioError)}
                                          aria-describedby={bioError ? bioErrorId : undefined}
                                      />
                                    {bioError && (
                                        <p id={bioErrorId} className="mt-1 text-xs text-red-600">{bioError}</p>
                                    )}
                                  </div>
                              </>
                          )}

                          <div>
                            <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1">{renderLabel(t.passwordLabel, true)}</label>
                              <div className="relative">
                                  <button
                                      type="button"
                                      onClick={() => setShowPassword(!showPassword)}
                                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                  >
                                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                  <input
                                      id="password"
                                      name="password"
                                      type={showPassword ? "text" : "password"}
                                      required
                                      className="appearance-none rounded-lg relative block w-full pl-10 pr-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                      value={formData.password}
                                      onChange={e => setFormData({...formData, password: e.target.value})}
                                  />
                              </div>
                          </div>
                          <div>
                            <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-700 mb-1">{renderLabel(t.confirmPasswordLabel, true)}</label>
                              <div className="relative">
                                  <button
                                      type="button"
                                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                  >
                                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  </button>
                                  <input
                                      id="confirmPassword"
                                      name="confirmPassword"
                                      type={showConfirmPassword ? "text" : "password"}
                                      required
                                      className="appearance-none rounded-lg relative block w-full pl-10 pr-3 py-2 border border-zinc-300 placeholder-zinc-500 text-zinc-900 focus:outline-none focus:ring-red-500 focus:border-red-500 sm:text-sm"
                                      value={formData.confirmPassword}
                                      onChange={e => setFormData({...formData, confirmPassword: e.target.value})}
                                  />
                              </div>
                          </div>
                      </div>

                      <div>
                          <button
                              type="submit"
                              disabled={isSubmitting}
                              className="group relative w-full flex justify-center items-center gap-2 py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-red-900 hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                              {isSubmitting && <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
                              {isSubmitting ? t.processing : t.createAccount}
                          </button>
                      </div>
                      
                      <div className="text-center text-sm">
                          <span className="text-zinc-600">{t.alreadyHaveAccount} </span>
                          <button onClick={() => setView(ViewState.LOGIN)} className="font-medium text-red-600 hover:text-red-500">
                              {t.loginLink}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      );
  };

  // --- RENDER CONTENT BASED ON VIEW ---
  const renderContent = () => {
        // Handle enrollment success verification page
        if (experiencePath === '/enrollment-success') {
                return (
                        <div className="flex items-center justify-center min-h-[60vh]">
                                <div className="flex flex-col items-center gap-4 text-center px-4">
                                        <div className="h-12 w-12 border-4 border-zinc-200 border-t-red-600 rounded-full animate-spin"></div>
                                        <h2 className="text-xl font-semibold text-zinc-900">{t.verifyingEnrollment || 'Verifying enrollment...'}</h2>
                                        <p className="text-sm text-zinc-500">{lang === 'ar' ? 'جاري التحقق من عملية الدفع وتفعيل الدورة...' : 'Verifying payment and activating course...'}</p>
                                </div>
                        </div>
                );
        }

        if (isBootstrapping) {
                return (
                        <div className="flex items-center justify-center min-h-[60vh]">
                                <div className="flex flex-col items-center gap-4 text-zinc-500">
                                        <div className="h-10 w-10 border-4 border-zinc-200 border-t-red-600 rounded-full animate-spin"></div>
                                        <p>{lang === 'ar' ? 'جاري تحميل البيانات الحية...' : 'Loading live data...'}</p>
                                </div>
                        </div>
                );
        }

        if (hasCriticalBootError) {
                return (
                        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
                    <p className="text-lg text-red-600 font-semibold">{bootError}</p>
                                <button onClick={fetchPlatformData} className="bg-red-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-950">
                                        {lang === 'ar' ? 'أعد المحاولة' : 'Retry'}
                                </button>
                        </div>
                );
        }

    switch (view) {
      case ViewState.HOME:
        return (
          <>
                        <ImportantNews t={t} blogPosts={blogPosts} />
                        <Hero setView={setView} t={t} branding={tenantBranding} onGuestMode={handleOpenGuestModal} />
                                                <HeroStats t={t} courses={courses} users={platformUsers} />
                                                <FeaturedCourses t={t} setView={setView} user={user} setSelectedCourse={setSelectedCourse} setSelectedInstructor={setSelectedInstructor} onShowRestrictionModal={handleShowRestrictionModal} courses={courses} users={platformUsers} pageContent={staticPageMap['home']} isMainSite={isMainSite} />
                                                                                                <FreelancerMembershipSection t={t} />
          </>
        );
      case ViewState.COURSES:
                    return <CoursesPage t={t} setView={setView} user={user} setSelectedCourse={setSelectedCourse} setSelectedInstructor={setSelectedInstructor} onShowRestrictionModal={handleShowRestrictionModal} courses={courses} users={platformUsers} />;
      case ViewState.ADS:
                    return <AdsPage t={t} setView={setView} />;
      case ViewState.AD_DETAIL:
                    return <AdDetailsPage t={t} setView={setView} />;
      case ViewState.ENROLLMENT:
          return (
              <EnrollmentPage
                  t={t}
                  course={selectedCourse || undefined}
                  onConfirmEnroll={handleEnrollmentSuccess}
                  paymentGatewayConfig={paymentGatewayConfig}
                  setView={setView}
                  setSelectedInstructor={setSelectedInstructor}
                  users={platformUsers}
                  user={user}
                  tenantId={tenantConfig?.id || 'central'}
                  tenantSlug={tenantSubdomain || 'central'}
              />
          );
    case ViewState.SERVICES:
            return <ServicesPage t={t} pageContent={staticPageMap['services']} branding={tenantBranding} />;
      case ViewState.BLOG:
        return <BlogPage t={t} blogPosts={blogPosts} setView={setView} setSelectedBlogPost={setSelectedBlogPost} />;
      case ViewState.BLOG_POST:
        return <BlogPostPage t={t} selectedBlogPost={selectedBlogPost} setView={setView} setSelectedBlogPost={setSelectedBlogPost} />;
      case ViewState.WHO_WE_ARE:
                    return <AboutUsPage t={t} pageContent={staticPageMap['about-us']} />;
      case ViewState.CAREERS:
                    return <CareerPage t={t} pageContent={staticPageMap['career']} />;
      case ViewState.CONTACT_US:
                    return <ContactUsPage t={t} pageContent={staticPageMap['contact-us']} />;
      case ViewState.PRIVACY:
                    return <PrivacyPolicyPage t={t} pageContent={staticPageMap['privacy']} />;
      case ViewState.TOS:
                    return <TermsOfService t={t} pageContent={staticPageMap['tos']} />;
      case ViewState.LOGIN:
        return <LoginView />;
            case ViewState.FORGOT_PASSWORD:
                return <ForgotPasswordView />;
            case ViewState.RESET_PASSWORD:
                return <ResetPasswordView />;
      case ViewState.REGISTER:
        return <RegisterView />;
      case ViewState.DASHBOARD:
        if (!user) return <LoginView />;
                                const showStudentDashboard = user.role === UserRole.STUDENT || user.role === UserRole.MEMBER || user.role === UserRole.VISITOR || (user.role === UserRole.GUEST && user.guestRole !== 'INSTRUCTOR');
                const showInstructorDashboard = user.role === UserRole.INSTRUCTOR || (user.role === UserRole.GUEST && user.guestRole === 'INSTRUCTOR');

                if (showStudentDashboard) return (
            <StudentDashboard
                user={user}
                dashboardSearchBar={dashboardSearchBar}
                setView={setView}
                setSelectedCourse={setSelectedCourse}
                t={t}
                lang={lang}
                courses={courses}
                liveClasses={liveClasses}
                certificates={certificates}
                users={platformUsers}
                notifications={notifications}
                rewardsConfig={rewardsConfig}
                coursePayments={coursePayments}
                creditTransactions={creditTransactions}
                creditRedemptionOptions={creditRedemptionOptions}
                creditRedemptions={creditRedemptions}
                onUpdateUser={handleUserUpdate}
                onAddCreditTransaction={handleAddCreditTransaction}
                onAddCreditRedemption={handleAddCreditRedemption}
                courseProgress={courseProgress}
            />
        );
        if (showInstructorDashboard) return (
            <InstructorDashboard 
                t={t} 
                lang={lang}
                dashboardSearchBar={dashboardSearchBar}
                rewardsConfig={rewardsConfig}
                user={user} 
                blogPosts={blogPosts} 
                setBlogPosts={setBlogPosts} 
                setView={setView}
                courses={courses}
                onUpdateCourses={setCourses}
                courseCategories={courseCategories}
                onUpdateCourseCategories={setCourseCategories}
                users={platformUsers}
                coursePayments={coursePayments}
                    instructorPayouts={instructorPayouts}
                discounts={discounts}
                onUpdateDiscounts={setDiscounts}
                liveClasses={liveClasses}
                onUpdateLiveClasses={setLiveClasses}
                certificates={certificates}
                attendance={attendance}
                livePlatformConfig={livePlatformConfig}
            />
        );
        const renderAdminExperience = () => (
            <AdminDashboard 
                t={t} 
                lang={lang}
                dashboardSearchBar={dashboardSearchBar}
                user={user} 
                rewardsConfig={rewardsConfig} 
                setRewardsConfig={setRewardsConfig} 
                livePlatformConfig={livePlatformConfig}
                onUpdateLivePlatformConfig={setLivePlatformConfig}
                paymentGatewayConfig={paymentGatewayConfig}
                onUpdatePaymentGatewayConfig={setPaymentGatewayConfig}
                blogPosts={blogPosts} 
                setBlogPosts={setBlogPosts}
                courses={courses}
                onUpdateCourses={setCourses}
                courseCategories={courseCategories}
                onUpdateCourseCategories={setCourseCategories}
                users={platformUsers}
                onUpdateUsers={setPlatformUsers}
                coursePayments={coursePayments}
                attendance={attendance}
                instructorPayouts={instructorPayouts}
                discounts={discounts}
                onUpdateDiscounts={setDiscounts}
                certificates={certificates}
                staticPages={staticPages}
                onUpdateStaticPages={setStaticPages}
                creditTransactions={creditTransactions}
                creditRedemptionOptions={creditRedemptionOptions}
                creditRedemptions={creditRedemptions}
                onAddCreditTransaction={handleAddCreditTransaction}
                onAddCreditRedemption={handleAddCreditRedemption}
                onAddCoursePayment={handleAddCoursePayment}
                onUpdateCoursePayment={handleUpdateCoursePayment}
                onDeleteCoursePayment={handleDeleteCoursePayment}
                onAddInstructorPayout={handleAddInstructorPayout}
                onUpdateInstructorPayout={handleUpdateInstructorPayout}
                onDeleteInstructorPayout={handleDeleteInstructorPayout}
                onUpsertCreditOption={handleUpsertCreditOption}
            />
        );
        if (user.role === UserRole.SUPER_ADMIN) {
            const superAdminCopy = (translations[lang]?.saas || translations.en.saas)!;
            return (
                <SuperAdminConsole
                    t={t}
                    lang={lang}
                    adminView={renderAdminExperience()}
                    tenantView={<SuperAdminDashboard copy={superAdminCopy} variant="embedded" />}
                />
            );
        }
        if (user.role === UserRole.ADMIN) {
            return renderAdminExperience();
        }
        return <Hero setView={setView} t={t} branding={tenantBranding} />;
      case ViewState.STUDENT_PROFILE:
        if (!user || (user.role !== UserRole.STUDENT && user.role !== UserRole.MEMBER)) return <Hero setView={setView} t={t} branding={tenantBranding} />;
        return (
            <StudentProfile 
                user={user} 
                onUpdateUser={handleUserUpdate} 
                onBack={() => setView(ViewState.DASHBOARD)} 
                t={t} 
                lang={lang}
                courses={courses}
                attendance={attendance}
                coursePayments={coursePayments}
                certificates={certificates}
                liveClasses={liveClasses}
                courseProgress={courseProgress}
                onShowRestrictionModal={handleShowRestrictionModal}
            />
        );
      case ViewState.INSTRUCTOR_PROFILE:
        if (!user || user.role !== UserRole.INSTRUCTOR) return <Hero setView={setView} t={t} branding={tenantBranding} />;
        return (
            <InstructorProfile 
                user={user} 
                onUpdateUser={handleUserUpdate} 
                onBack={() => setView(ViewState.DASHBOARD)} 
                t={t} 
                lang={lang} 
                blogPosts={blogPosts}
                courses={courses}
                onShowRestrictionModal={handleShowRestrictionModal}
            />
        );
      case ViewState.PUBLIC_INSTRUCTOR_PROFILE:
        if (!selectedInstructor) {
          setView(ViewState.HOME);
          return null;
        }
        return (
            <PublicInstructorProfile 
                instructor={selectedInstructor} 
                onBack={() => setView(ViewState.COURSES)} 
                t={t} 
                lang={lang} 
                blogPosts={blogPosts}
                courses={courses}
            />
        );
      case ViewState.COURSE_PLAYER:
        if (!user) {
          setView(ViewState.LOGIN);
          return null;
        }
                if (!hydratedSelectedCourse) {
          // If courses are still loading, show loading state
          if (isBootstrapping) {
            return (
              <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                  <div className="animate-spin h-12 w-12 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p className="text-zinc-600">{t.loading || 'Loading...'}</p>
                </div>
              </div>
            );
          }
          // If courses loaded but no course selected, redirect to dashboard
          setView(ViewState.DASHBOARD);
          return null;
        }
                                return <CoursePlayer 
                                    course={hydratedSelectedCourse} 
                  onBack={() => setView(ViewState.DASHBOARD)} 
                  t={t} 
                  lang={lang} 
                  onReward={handleReward} 
                  rewardsConfig={rewardsConfig}
                  user={user}
                  progressRecord={courseProgress.find(record => record.courseId === hydratedSelectedCourse.id)}
                  onProgressSync={({ courseProgress: record, user: updatedUser }) => {
                      handleCourseProgressSync(record);
                      handleUserUpdate(updatedUser);
                                    }}
                                    onAttendanceSync={handleAttendanceSnapshot}
               />;
      case ViewState.NOT_FOUND:
        return <NotFoundPage t={t} lang={lang} onBack={() => window.history.back()} />;
      default:
        return <NotFoundPage t={t} lang={lang} onBack={() => window.history.back()} />;
    }
  };

  const LoadingFallback = () => (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <div className="animate-spin h-12 w-12 border-4 border-red-600 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-zinc-600">{t.loading || 'Loading...'}</p>
      </div>
    </div>
  );

    const renderSaasExperience = () => {
        if (!isMainSite || !isSaasRoute) {
            return null;
        }
        const saasCopyBase = (translations[lang]?.saas || translations.en.saas)! as SaasCopy;
        const saasCopy = applyPricingToSaasCopy(saasCopyBase, planPricing);
        const languageOptions: Array<'en' | 'ar'> = ['en', 'ar'];
        const BackIcon = lang === 'ar' ? ArrowRight : ArrowLeft;
        const renderShell = (content: React.ReactNode) => (
            <div className="min-h-screen bg-white" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <div className="sticky top-0 z-40 border-b border-zinc-100 bg-white/90 backdrop-blur shadow-sm">
                    <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:text-red-900 transition-colors"
                        >
                            <BackIcon className="h-4 w-4" />
                            {lang === 'ar' ? 'العودة للرئيسية' : 'Back to Home'}
                        </button>
                        <div className="flex items-center gap-3 text-sm">
                            <span className="text-zinc-500">{saasCopy.languageLabel}</span>
                            <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5">
                                {languageOptions.map((locale) => (
                                    <button
                                        key={locale}
                                        type="button"
                                        onClick={() => lang !== locale && setLang(locale)}
                                        className={`${
                                            lang === locale
                                                ? 'bg-red-900 text-white shadow'
                                                : 'text-zinc-600 hover:text-red-600'
                                        } px-3 py-1 rounded-full text-xs font-semibold transition-colors`}
                                        aria-pressed={lang === locale}
                                    >
                                        {saasCopy.languageOptions?.[locale] || locale.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
                {content}
            </div>
        );
        let content: React.ReactNode;
        if (experiencePath.startsWith('/signup')) {
            content = <SignupFlow mainDomain={mainDomain} copy={saasCopy} planPricing={planPricing} />;
        } else if (experiencePath.startsWith('/super-admin')) {
            content = <SuperAdminDashboard copy={saasCopy} />;
        } else {
            content = <MainLanding onStart={() => navigate('/saas/signup')} onGuestMode={handleOpenGuestModal} copy={saasCopy} isRtl={lang === 'ar'} />;
        }
        return renderShell(content);
    };

    if (isMainSite && isSaasRoute) {
        return renderSaasExperience();
    }

    // While the tenant config is being fetched for a subdomain, show a
    // minimal spinner so the unrelated platform UI never flashes.
    if (!isMainSite && tenantSubdomain && tenantLoading && !tenantConfig) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <div className="flex flex-col items-center gap-4 text-zinc-500">
                    <div className="h-10 w-10 border-4 border-zinc-200 border-t-red-600 rounded-full animate-spin"></div>
                    <p>{lang === 'ar' ? 'جاري تحميل البيانات...' : 'Loading...'}</p>
                </div>
            </div>
        );
    }

    // Block access when the subdomain does not match any registered tenant.
    if (!isMainSite && tenantSubdomain && tenantNotFound) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-zinc-50" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                <div className="text-center max-w-md mx-auto px-4">
                    <div className="text-6xl mb-6">🚫</div>
                    <h1 className="text-2xl font-bold text-red-600 mb-4">
                        {lang === 'ar' ? 'الموقع غير موجود' : 'Academy Not Found'}
                    </h1>
                    <p className="text-zinc-600 mb-6">
                        {lang === 'ar'
                            ? 'هذا الموقع الفرعي غير مسجل على منصتنا. تأكد من صحة الرابط أو تواصل معنا.'
                            : 'This subdomain is not registered on our platform. Please check the URL or contact support.'}
                    </p>
                    <a
                        href={`https://${mainDomain}`}
                        className="inline-block bg-red-900 text-white px-6 py-2 rounded-lg font-semibold hover:bg-red-950 transition-colors"
                    >
                        {lang === 'ar' ? 'العودة للرئيسية' : 'Back to Home'}
                    </a>
                </div>
            </div>
        );
    }

    const internalViews = new Set([
        ViewState.DASHBOARD,
        ViewState.COURSE_VIEW,
        ViewState.COURSE_PLAYER,
        ViewState.STUDENT_PROFILE,
        ViewState.INSTRUCTOR_PROFILE
    ]);
    const isInternalView = internalViews.has(view);
    const announcementBarColor = (tenantBranding?.announcementBarColor && tenantBranding.announcementBarColor.trim()) || '';
    const announcementUsesCustomColor = Boolean(announcementBarColor);
    const floatingPublicButtonTopClass = showAnnouncementBar ? 'top-28 sm:top-32' : 'top-20 sm:top-24';

    return (
        <div className={`min-h-screen flex flex-col font-sans ${isInternalView ? 'ds-gradient-bg' : 'bg-zinc-50'}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
            {showAnnouncementBar && (
                <div
                    className={`fixed top-0 left-0 right-0 z-[60] ${announcementUsesCustomColor ? '' : 'bg-gradient-to-r from-red-950 via-red-700 to-orange-500'} text-white shadow-md`}
                    style={announcementUsesCustomColor ? { backgroundColor: announcementBarColor } : undefined}
                >
                    <div className="h-10 overflow-hidden flex items-center">
                        <div
                            ref={announcementMarqueeRef}
                            className="top-announcement-marquee"
                            style={{
                                animationDirection: lang === 'ar' ? 'normal' : 'reverse',
                                animationDuration: `${announcementDurationSeconds}s`
                            }}
                            aria-label={t?.announcementsTabLabel || (lang === 'ar' ? 'شريط الإعلانات' : 'Announcement bar')}
                        >
                            {[...topAnnouncements, ...topAnnouncements].map((item, index) => (
                                <span key={`${item.id}-${index}`} className="inline-flex items-center px-6 text-sm sm:text-base font-bold whitespace-nowrap leading-10">
                                    {getAnnouncementText(item)}
                                    <span className="ms-6 text-white/80">•</span>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}
      {user?.role === UserRole.GUEST && view !== ViewState.HOME && view !== ViewState.LOGIN && view !== ViewState.REGISTER && (
        <GuestBanner
          onCreateAccount={() => setView(ViewState.REGISTER)}
          translations={{
            bannerText: t.guest?.bannerText || 'You are browsing as a guest',
            createAccountCTA: t.guest?.createAccountCTA || 'Create Account to Continue'
          }}
          language={lang}
        />
      )}
            <Navbar />
                        {!isInternalView && (
                                <FloatingActionButtons language={lang} onBack={handleBackNavigation} />
                        )}
      <div className="flex-grow">
        <Suspense fallback={<LoadingFallback />}>
          {renderContent()}
        </Suspense>
      </div>
    <Footer t={t} setView={setView} branding={tenantBranding} isMainSite={isMainSite} homePageContent={staticPageMap['home']} />
      <Suspense fallback={null}>
        <AISupport t={t} lang={lang} />
      </Suspense>
      <Suspense fallback={null}>
                <PageGuide currentView={view} currentPath={experiencePath} language={lang} buttonTopClassName={floatingPublicButtonTopClass} />
      </Suspense>
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div
                className="w-full max-w-sm rounded-2xl border border-zinc-100 bg-white p-6 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="pwa-install-title"
                aria-describedby="pwa-install-description"
            >
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-red-50 p-2 text-red-600">
                        <Download className="h-5 w-5" />
                    </div>
                    <div>
                        <h3 id="pwa-install-title" className="text-lg font-bold text-zinc-900">
                            {t.installAppTitle || 'Install Betacademy'}
                        </h3>
                        <p id="pwa-install-description" className="mt-1 text-sm text-zinc-600">
                            {t.installAppDescription || 'Install Betacademy on your device for faster access and offline-friendly support.'}
                        </p>
                    </div>
                </div>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                        type="button"
                        onClick={handleInstallModalLater}
                        className="flex-1 rounded-xl border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-600 transition-colors hover:bg-zinc-50"
                    >
                        {t.installAppLaterCta || 'Not now'}
                    </button>
                    <button
                        type="button"
                        onClick={handleInstallModalInstall}
                        disabled={isPromptingInstall}
                        className="flex-1 rounded-xl bg-red-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-950 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    >
                        {isPromptingInstall ? (t.installAppWorking || 'Installing...') : (t.installAppInstallCta || 'Install')}
                    </button>
                </div>
            </div>
        </div>
      )}
      {showRoleSelectionModal && (
        <RoleSelectionModal
          onSelectStudent={() => handleSelectGuestRole('STUDENT')}
          onSelectInstructor={() => handleSelectGuestRole('INSTRUCTOR')}
          onClose={() => setShowRoleSelectionModal(false)}
          translations={{
            title: t.guest?.roleSelectionTitle || 'Choose Your Experience',
            studentOption: t.guest?.studentOption || 'Student Experience',
            studentDesc: t.guest?.studentDesc || 'Explore courses, progress tracking, and learning tools',
            instructorOption: t.guest?.instructorOption || 'Instructor Experience',
            instructorDesc: t.guest?.instructorDesc || 'Explore course creation, student management, and analytics',
            enterAsStudent: t.guest?.enterAsStudent || 'Enter as Student',
            enterAsInstructor: t.guest?.enterAsInstructor || 'Enter as Instructor'
          }}
        />
      )}
      {showRestrictionModal && (
        <RestrictionModal
          onCreateAccount={handleRestrictionSignup}
          onLogin={handleRestrictionLogin}
          onClose={() => setShowRestrictionModal(false)}
          translations={{
            title: t.guest?.restrictionTitle || 'Create Account for Full Access',
            message: t.guest?.restrictionMessage,
            createAccount: t.createAccount || 'Create Account',
            login: t.login || 'Login'
          }}
        />
      )}
    </div>
  );
};

export default App;
