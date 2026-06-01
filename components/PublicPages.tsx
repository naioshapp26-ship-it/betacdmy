import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ViewState, Course, BlogPost, User, StaticPageContent, PaymentGatewayConfig, CareerJob, TenantBrandingConfig, TenantPricingConfig, TenantPricingPlan, Ad, UserRole, MediaGalleryItem } from '../types';
import { SERVICES } from '../constants';
import { renderMarkdown } from '../utils/richText';
import DOMPurify from 'dompurify';
import { parseServicesPageContent } from '../utils/servicesPage';
import { parseHomePageContent } from '../utils/homePage';
import { ArrowRight, ArrowLeft, Star, Check, Users, Award, Zap, Brain, Globe, ChevronDown, Sparkles, Play, BookOpen, CreditCard, Lock, CheckCircle, Share2, Twitter, Facebook, Linkedin, Link as LinkIcon, X, Clock, MapPin, Briefcase, Building, User as UserIcon, Mail, Phone, Send, Paperclip, RefreshCw, Upload, Eye, EyeOff } from 'lucide-react';
import { parseCareerJobs, DEFAULT_CAREER_APPLY_TEXT } from '../utils/career';
import PhoneInput, { parsePhoneValue, type PhoneValue } from './PhoneInput';

interface PublicProps {
    setView?: (view: ViewState) => void;
    t?: any;
    user?: User | null;
    tenantId?: string | null;
    tenantSlug?: string | null;
    setSelectedCourse?: (c: Course) => void;
    setSelectedInstructor?: (u: User) => void;
    setSelectedBlogPost?: (b: BlogPost) => void;
    selectedBlogPost?: BlogPost | null;
    course?: Course; // For EnrollmentPage
    onConfirmEnroll?: () => Promise<boolean> | boolean; // For EnrollmentPage
    onShowRestrictionModal?: () => void; // For guest restrictions
    onGuestMode?: () => void; // For guest mode activation
    blogPosts?: BlogPost[];
    courses?: Course[];
    users?: User[];
    pageContent?: StaticPageContent;
    paymentGatewayConfig?: PaymentGatewayConfig;
    branding?: TenantBrandingConfig | null;
    pricing?: TenantPricingConfig | null;
    isMainSite?: boolean;
}

const pickCopy = (value?: string | null, fallback = ''): string => {
    const trimmed = (value || '').trim();
    return trimmed || fallback;
};

const ARABIC_CHAR_REGEX = /[\u0600-\u06FF]/;

const pickLocalizedCopy = (
    candidates: Array<string | null | undefined>,
    isArabic: boolean,
    englishFallback: string,
    arabicFallback: string
): string => {
    for (const candidate of candidates) {
        const value = (candidate || '').trim();
        if (!value) continue;
        if (!isArabic && ARABIC_CHAR_REGEX.test(value)) continue;
        return value;
    }
    return isArabic ? arabicFallback : englishFallback;
};

const resolvePalette = (branding?: TenantBrandingConfig | null) => {
    const primary = pickCopy(branding?.primaryColor, '#dc2626');
    const secondary = pickCopy(branding?.secondaryColor, '#0f172a');
    const accent = pickCopy(branding?.accentColor, '#fb7185');
    return { primary, secondary, accent };
};

const hexToRgba = (hex: string, alpha = 1, fallback = 'rgba(220,38,38,0.35)') => {
    const normalized = hex.replace('#', '');
    const full = normalized.length === 3
        ? normalized.split('').map((char) => char + char).join('')
        : normalized;
    if (full.length !== 6) {
        return fallback;
    }
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        return fallback;
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const parseYouTubeId = (url: string): string | null => {
    const trimmed = url.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const pathParts = parsed.pathname.split('/').filter(Boolean);

        if (host === 'youtu.be') {
            return pathParts[0] || null;
        }

        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
            const searchVideoId = parsed.searchParams.get('v');
            if (searchVideoId) {
                return searchVideoId;
            }

            if (pathParts[0] === 'shorts' || pathParts[0] === 'live' || pathParts[0] === 'embed' || pathParts[0] === 'v') {
                return pathParts[1] || null;
            }
        }
    } catch {
        // Fallback regex parsing for malformed URLs.
    }

    const shortMatch = trimmed.match(/youtu\.be\/([^?&#/]+)/i);
    if (shortMatch?.[1]) {
        return shortMatch[1];
    }
    const shortsMatch = trimmed.match(/youtube(?:-nocookie)?\.com\/(?:shorts|live|embed|v)\/([^?&#/]+)/i);
    if (shortsMatch?.[1]) {
        return shortsMatch[1];
    }
    const watchMatch = trimmed.match(/[?&]v=([^?&#/]+)/i);
    if (watchMatch?.[1]) {
        return watchMatch[1];
    }
    return null;
};

const toBackgroundEmbedVideoUrl = (url: string): string | null => {
    const trimmed = url.trim();
    const youTubeId = parseYouTubeId(trimmed);
    if (youTubeId) {
        return `https://www.youtube.com/embed/${youTubeId}?autoplay=1&mute=1&loop=1&controls=0&playsinline=1&playlist=${youTubeId}&rel=0&modestbranding=1`;
    }

    const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoMatch?.[1]) {
        return `https://player.vimeo.com/video/${vimeoMatch[1]}?background=1&autoplay=1&loop=1&muted=1`;
    }

    return null;
};

const toInteractiveEmbedVideoUrl = (url: string, soundEnabled: boolean): string | null => {
    const trimmed = url.trim();
    const youTubeId = parseYouTubeId(trimmed);
    if (youTubeId) {
        return `https://www.youtube.com/embed/${youTubeId}?autoplay=1&mute=${soundEnabled ? 0 : 1}&controls=1&playsinline=1&loop=1&playlist=${youTubeId}&rel=0&modestbranding=1`;
    }

    const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoMatch?.[1]) {
        return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1&muted=${soundEnabled ? 0 : 1}&loop=1&controls=1`;
    }

    return null;
};

const toStandardEmbedVideoUrl = (url: string): string | null => {
    const trimmed = url.trim();
    const youTubeId = parseYouTubeId(trimmed);
    if (youTubeId) {
        return `https://www.youtube.com/embed/${youTubeId}?autoplay=0&mute=0&controls=1&playsinline=1&rel=0&modestbranding=1`;
    }
    const vimeoMatch = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    if (vimeoMatch?.[1]) {
        return `https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=0&muted=0&loop=0&controls=1`;
    }
    return null;
};

const normalizeMediaGallery = (gallery: Array<MediaGalleryItem | string> | undefined | null): MediaGalleryItem[] => {
    if (!Array.isArray(gallery)) {
        return [];
    }
    return gallery
        .map((item, index) => {
            if (typeof item === 'string') {
                const trimmed = item.trim();
                if (!trimmed) return null;
                return {
                    id: `media_${index}_${Math.random().toString(36).slice(2, 7)}`,
                    url: trimmed,
                    mediaType: 'image' as const,
                    order: index
                };
            }
            const url = typeof item?.url === 'string' ? item.url.trim() : '';
            if (!url) return null;
            return {
                id: typeof item.id === 'string' && item.id.trim() ? item.id : `media_${index}_${Math.random().toString(36).slice(2, 7)}`,
                url,
                mediaType: item.mediaType === 'video' ? 'video' : 'image',
                order: index
            };
        })
        .filter((item): item is MediaGalleryItem => Boolean(item));
};

// --- Animation Components & Hooks ---

const useScrollReveal = (threshold = 0.1) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            { threshold }
        );
        const currentRef = ref.current;
        if (currentRef) observer.observe(currentRef);
        return () => {
            if (currentRef) observer.unobserve(currentRef);
        };
    }, [threshold]);

    return { ref, isVisible };
};

const ScrollReveal: React.FC<{children: React.ReactNode, className?: string, delay?: string}> = ({ children, className = "", delay = "0ms" }) => {
    const { ref, isVisible } = useScrollReveal();
    return (
        <div 
            ref={ref} 
            className={`transition-all duration-1000 ease-out transform ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'} ${className}`}
            style={{ transitionDelay: delay }}
        >
            {children}
        </div>
    );
};

const HeroStatCard: React.FC<{
    label: string;
    value: number;
    icon: React.ReactNode;
    delay: string;
    numberFormatter: Intl.NumberFormat;
}> = ({ label, value, icon, delay, numberFormatter }) => {
    const { ref, isVisible } = useScrollReveal(0.25);
    const [animatedValue, setAnimatedValue] = useState(0);

    useEffect(() => {
        if (!isVisible) return;
        const duration = 1100;
        const target = Math.max(0, Number(value) || 0);
        const startedAt = performance.now();
        let frameId = 0;

        const tick = (now: number) => {
            const progress = Math.min((now - startedAt) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            setAnimatedValue(Math.round(target * eased));
            if (progress < 1) {
                frameId = requestAnimationFrame(tick);
            }
        };

        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [isVisible, value]);

    return (
        <div
            ref={ref}
            className={`rounded-2xl border border-zinc-200 bg-white shadow-xl px-6 py-5 transition-all duration-1000 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
            style={{ transitionDelay: delay }}
        >
            <div className="inline-flex p-2 rounded-lg bg-red-50 text-red-700 mb-3">{icon}</div>
            <p className="text-4xl font-black text-zinc-900 leading-none">{numberFormatter.format(animatedValue)}</p>
            <p className="text-sm text-zinc-500 mt-2">{label}</p>
        </div>
    );
};

const TiltCard: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = "", onClick }) => {
    const cardRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!cardRef.current) return;
        const card = cardRef.current;
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -5; // Subtle 3D effect
        const rotateY = ((x - centerX) / centerX) * 5;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    };

    const handleMouseLeave = () => {
        if (!cardRef.current) return;
        cardRef.current.style.transform = `perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)`;
    };

    return (
        <div 
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={onClick}
            className={`transition-transform duration-200 ease-out transform-gpu ${className}`}
            style={{ transformStyle: 'preserve-3d' }}
        >
            {children}
        </div>
    );
};

const StaticPageContentView: React.FC<{
    pageContent?: StaticPageContent;
    fallbackTitle: string;
    accentLabel?: string;
    description?: string;
    emptyMessage?: string;
    t?: any;
}> = ({ pageContent, fallbackTitle, accentLabel, description, emptyMessage, t }) => {
    const renderedHtml = useMemo(() => renderMarkdown(pageContent?.content), [pageContent?.content]);
    const title = pageContent?.title?.trim() ? pageContent.title : fallbackTitle;
    const updatedAtLabel = useMemo(() => {
        if (!pageContent?.updatedAt) return null;
        return new Date(pageContent.updatedAt).toLocaleString();
    }, [pageContent?.updatedAt]);

    return (
        <div className="ds-gradient-bg min-h-screen">
        <div className="max-w-4xl mx-auto py-24 px-4">
            <div className="mb-10 text-center">
                {accentLabel && (
                    <span className="text-xs font-semibold tracking-[0.3em] text-red-600 uppercase block mb-4">
                        {accentLabel}
                    </span>
                )}
                <h1 className="ds-page-title mb-4">{title}</h1>
                {description && (
                    <p className="ds-description leading-relaxed max-w-2xl mx-auto">{description}</p>
                )}
            </div>

            {renderedHtml ? (
                <div className="ds-card">
                    <div
                        className="cms-content text-base md:text-lg leading-relaxed text-zinc-700 space-y-4"
                        dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                </div>
            ) : (
                <div className="ds-card text-center text-zinc-500">
                    {emptyMessage || t?.pageContentEmpty || 'Content not published yet for this page.'}
                </div>
            )}

            {updatedAtLabel && (
                <p className="text-xs text-zinc-500 text-center mt-6">
                    {(t?.pageLastUpdated || 'Last updated') + ': ' + updatedAtLabel}
                </p>
            )}

            <style>{`
                .cms-content h1,
                .cms-content h2,
                .cms-content h3,
                .cms-content h4 {
                    margin-top: 2rem;
                    margin-bottom: 0.75rem;
                    font-weight: 700;
                    color: #18181b;
                }
                .cms-content p {
                    margin-bottom: 1rem;
                }
                .cms-content ul,
                .cms-content ol {
                    margin-bottom: 1.25rem;
                    padding-left: 1.5rem;
                }
                .cms-content ul {
                    list-style: disc;
                }
                .cms-content ol {
                    list-style: decimal;
                }
                .cms-content li {
                    display: list-item;
                    margin: 0.5rem 0;
                }
                .cms-content blockquote {
                    border-left: 4px solid #f87171;
                    padding-left: 1rem;
                    color: #52525b;
                    font-style: italic;
                    margin: 1.5rem 0;
                }
                .cms-content a {
                    color: #dc2626;
                    text-decoration: underline;
                }
                .cms-content img {
                    max-width: 100%;
                    border-radius: 0.75rem;
                    margin: 1.5rem 0;
                }
                .cms-content table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1.5rem 0;
                }
                .cms-content table,
                .cms-content th,
                .cms-content td {
                    border: 1px solid #e4e4e7;
                }
                .cms-content th,
                .cms-content td {
                    padding: 0.75rem;
                }
            `}</style>
        </div>
        </div>
    );
};

// --- Page Components ---

export const Hero: React.FC<PublicProps> = ({ setView, t, branding }) => {
    const isArabic = t?.lang === 'ar';
    const palette = useMemo(() => resolvePalette(branding), [branding]);
    const heroBackground = pickCopy(branding?.heroBackgroundColor, '#020617');
    const heroBackgroundImageUrl = pickCopy(branding?.heroBackgroundImageUrl);
    const heroBackgroundVideoUrl = pickCopy(branding?.heroBackgroundVideoUrl);
    const heroMediaGallery = useMemo(() => {
        const gallery = normalizeMediaGallery(branding?.heroMediaGallery);
        if (gallery.length > 0) {
            return gallery;
        }
        const fallbackItems: MediaGalleryItem[] = [];
        if (heroBackgroundImageUrl) {
            fallbackItems.push({
                id: `hero_media_image_${Math.random().toString(36).slice(2, 7)}`,
                url: heroBackgroundImageUrl,
                mediaType: 'image',
                order: fallbackItems.length
            });
        }
        if (heroBackgroundVideoUrl) {
            fallbackItems.push({
                id: `hero_media_video_${Math.random().toString(36).slice(2, 7)}`,
                url: heroBackgroundVideoUrl,
                mediaType: 'video',
                order: fallbackItems.length
            });
        }
        return fallbackItems;
    }, [branding?.heroMediaGallery, heroBackgroundImageUrl, heroBackgroundVideoUrl]);
    const hasCarousel = heroMediaGallery.length > 1;
    const [activeHeroMediaIndex, setActiveHeroMediaIndex] = useState(0);
    const [isHeroCarouselPaused, setIsHeroCarouselPaused] = useState(false);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const activeHeroMedia = heroMediaGallery[activeHeroMediaIndex] || null;
    const activeHeroMediaKey = activeHeroMedia?.id || `hero_media_${activeHeroMediaIndex}`;
    const activeHeroMediaUrl = activeHeroMedia?.url || '';
    const activeHeroMediaType = activeHeroMedia?.mediaType || 'image';
    const heroBackgroundModeRaw = pickCopy(branding?.heroBackgroundMode, 'color').toLowerCase();
    const heroBackgroundMode = heroBackgroundModeRaw === 'image' || heroBackgroundModeRaw === 'video' ? heroBackgroundModeRaw : 'color';
    const hasHeroBackgroundImage = Boolean(heroBackgroundImageUrl);
    const hasHeroBackgroundVideo = Boolean(heroBackgroundVideoUrl);
    const heroVideoEmbedUrl = activeHeroMediaType === 'video' && activeHeroMediaUrl
        ? toBackgroundEmbedVideoUrl(activeHeroMediaUrl)
        : hasHeroBackgroundVideo
            ? toBackgroundEmbedVideoUrl(heroBackgroundVideoUrl)
            : null;
    const [heroMediaSoundEnabled, setHeroMediaSoundEnabled] = useState(false);
    const heroMediaVideoRef = useRef<HTMLVideoElement>(null);
    const heroMediaEmbedUrl = activeHeroMediaType === 'video' && activeHeroMediaUrl
        ? toInteractiveEmbedVideoUrl(activeHeroMediaUrl, heroMediaSoundEnabled)
        : hasHeroBackgroundVideo
            ? toInteractiveEmbedVideoUrl(heroBackgroundVideoUrl, heroMediaSoundEnabled)
            : null;
    const effectiveHeroBackgroundMode =
        activeHeroMedia
            ? activeHeroMediaType
            : heroBackgroundMode === 'video' && hasHeroBackgroundVideo
            ? 'video'
            : heroBackgroundMode === 'image' && hasHeroBackgroundImage
                ? 'image'
                : hasHeroBackgroundImage
                    ? 'image'
                    : hasHeroBackgroundVideo
                        ? 'video'
                        : 'color';
    const heroBadge = pickCopy(branding?.heroBadge, 'AI-Powered Learning Experience');
    const heroTitleLeading = pickCopy(branding?.heroTitleLeading, t.heroTitlePre || 'Launch your academy on');
    const heroTitleHighlight = pickCopy(branding?.heroTitleHighlight, t.heroTitlePost || 'Betacademy');
    const heroSubtitle = pickCopy(branding?.heroSubtitle, t.heroSubtitle || 'Future-proof skills with AI-native learning paths.');
    const primaryCtaLabel = pickCopy(branding?.primaryCtaLabel, t.getStarted || 'Get started');
    const servicesCtaLabel = pickCopy(branding?.secondaryCtaLabel, t.viewServices || 'View Services');
    const viewCoursesCtaLabel = t.viewCourses || (t.lang === 'ar' ? 'عرض الدورات' : 'View Courses');
    const [scrollY, setScrollY] = useState(0);

    const goToHeroSlide = (index: number) => {
        if (!heroMediaGallery.length) return;
        const bounded = (index + heroMediaGallery.length) % heroMediaGallery.length;
        setActiveHeroMediaIndex(bounded);
        setHeroMediaSoundEnabled(false);
    };

    const goToNextHeroSlide = useCallback(() => {
        if (!heroMediaGallery.length) return;
        goToHeroSlide(activeHeroMediaIndex + 1);
    }, [activeHeroMediaIndex, heroMediaGallery.length]);

    const goToPrevHeroSlide = useCallback(() => {
        if (!heroMediaGallery.length) return;
        goToHeroSlide(activeHeroMediaIndex - 1);
    }, [activeHeroMediaIndex, heroMediaGallery.length]);

    useEffect(() => {
        let rafId = 0;
        const onScroll = () => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => setScrollY(window.scrollY || 0));
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(rafId);
        };
    }, []);

    useEffect(() => {
        if (activeHeroMediaIndex <= heroMediaGallery.length - 1) {
            return;
        }
        setActiveHeroMediaIndex(0);
    }, [activeHeroMediaIndex, heroMediaGallery.length]);

    useEffect(() => {
        if (effectiveHeroBackgroundMode !== 'video' || heroMediaEmbedUrl) {
            return;
        }
        const video = heroMediaVideoRef.current;
        if (!video) {
            return;
        }
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                // Ignore autoplay rejections; user can manually start playback.
            });
        }
    }, [activeHeroMediaKey, effectiveHeroBackgroundMode, heroMediaEmbedUrl]);

    useEffect(() => {
        if (!hasCarousel || isHeroCarouselPaused) {
            return;
        }
        const timerId = window.setInterval(() => {
            setActiveHeroMediaIndex((prev) => (prev + 1) % heroMediaGallery.length);
            setHeroMediaSoundEnabled(false);
        }, 5000);
        return () => window.clearInterval(timerId);
    }, [activeHeroMediaIndex, hasCarousel, heroMediaGallery.length, isHeroCarouselPaused]);

    const handleHeroMediaInteract = () => {
        setHeroMediaSoundEnabled(true);
        const video = heroMediaVideoRef.current;
        if (!video) return;
        video.muted = false;
        if (video.volume < 0.8) {
            video.volume = 0.8;
        }
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                // Ignore play interruption errors from aggressive browser autoplay policies.
            });
        }
    };

    const handleHeroTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        setTouchStartX(event.changedTouches[0]?.clientX ?? null);
        setIsHeroCarouselPaused(true);
    };

    const handleHeroTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        const touchEndX = event.changedTouches[0]?.clientX;
        if (touchStartX === null || typeof touchEndX !== 'number') {
            setTouchStartX(null);
            setIsHeroCarouselPaused(false);
            return;
        }
        const deltaX = touchEndX - touchStartX;
        if (Math.abs(deltaX) > 45) {
            if (deltaX < 0) {
                goToNextHeroSlide();
            } else {
                goToPrevHeroSlide();
            }
        }
        setTouchStartX(null);
        setIsHeroCarouselPaused(false);
    };

    return (
        <div
            className="relative min-h-[85vh] overflow-hidden -mt-16 pt-16"
            style={{ backgroundColor: heroBackground }}
        >
            <div className="absolute inset-0 z-0">
                <div className="absolute w-full h-full" style={{ backgroundColor: heroBackground }}></div>
                {effectiveHeroBackgroundMode === 'image' && (activeHeroMediaType === 'image' ? Boolean(activeHeroMediaUrl) : hasHeroBackgroundImage) && (
                    <img
                        src={activeHeroMediaType === 'image' && activeHeroMediaUrl ? activeHeroMediaUrl : heroBackgroundImageUrl}
                        alt=""
                        aria-hidden="true"
                        className="hero-slide-in absolute inset-0 w-full h-full object-cover opacity-70"
                        style={{ filter: 'blur(5px)', transform: 'scale(1.05)' }}
                    />
                )}
                {effectiveHeroBackgroundMode === 'video' && (activeHeroMediaType === 'video' ? Boolean(activeHeroMediaUrl) : hasHeroBackgroundVideo) && (
                    <>
                        {heroVideoEmbedUrl ? (
                            <iframe
                                key={`hero-bg-${activeHeroMediaKey}`}
                                src={heroVideoEmbedUrl}
                                title=""
                                aria-hidden="true"
                                className="hero-slide-in absolute inset-0 h-full w-full scale-[1.08] opacity-70 pointer-events-none"
                                style={{ filter: 'blur(5px)' }}
                                allow="autoplay; fullscreen"
                            />
                        ) : (
                            <video
                                key={`hero-bg-${activeHeroMediaKey}`}
                                className="hero-slide-in absolute inset-0 h-full w-full object-cover opacity-70"
                                style={{ filter: 'blur(5px)', transform: 'scale(1.05)' }}
                                autoPlay
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                aria-hidden="true"
                            >
                                <source
                                    key={`hero-bg-src-${activeHeroMediaKey}`}
                                    src={activeHeroMediaType === 'video' && activeHeroMediaUrl ? activeHeroMediaUrl : heroBackgroundVideoUrl}
                                />
                            </video>
                        )}
                    </>
                )}
                <div className="absolute inset-0 bg-black/35"></div>
                <div
                    className="absolute top-[-10%] left-[-5%] w-[45%] h-[45%] rounded-full blur-[120px] animate-pulse"
                    style={{ animationDuration: '5s', backgroundColor: hexToRgba(palette.primary, 0.22) }}
                ></div>
                <div
                    className="absolute bottom-[-15%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[120px] animate-pulse"
                    style={{ animationDuration: '8s', backgroundColor: hexToRgba(palette.accent, 0.2) }}
                ></div>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
                <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
            </div>

            <div className="relative z-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-16">
                <div className="grid items-center gap-10 lg:gap-14 lg:grid-cols-2">
                    <div
                        className={`text-center transition-transform duration-300 ${isArabic ? 'lg:text-right' : 'lg:text-left'}`}
                        style={{
                            transform: `translateY(${Math.max(-30, -scrollY * 0.08)}px)`,
                            opacity: Math.max(0.75, 1 - scrollY / 1200)
                        }}
                    >
                        <div
                            className="inline-flex mb-6 px-4 py-1.5 rounded-full border backdrop-blur-sm text-sm font-medium tracking-wide"
                            style={{
                                borderColor: hexToRgba(palette.primary, 0.35),
                                backgroundColor: hexToRgba(palette.primary, 0.12),
                                color: palette.primary
                            }}
                        >
                            <span className="flex items-center gap-2">
                                <Zap className="w-4 h-4" style={{ color: palette.primary }} /> {heroBadge}
                            </span>
                        </div>

                        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight drop-shadow-xl">
                            {heroTitleLeading}
                            <span className="block mt-2 bg-clip-text text-transparent" style={{ backgroundImage: `linear-gradient(120deg, ${palette.primary}, ${palette.accent})` }}>
                                {heroTitleHighlight}
                            </span>
                        </h1>

                        <p className="mt-6 max-w-2xl text-base sm:text-lg text-zinc-200 leading-relaxed lg:mx-0 mx-auto">
                            {heroSubtitle}
                        </p>

                        <div className={`mt-9 flex flex-col sm:flex-row sm:flex-wrap gap-4 ${isArabic ? 'justify-center lg:justify-end' : 'justify-center lg:justify-start'}`}>
                            <button
                                onClick={() => setView && setView(ViewState.REGISTER)}
                                className="group relative px-7 py-3.5 rounded-full font-bold text-base text-white overflow-hidden transition-transform hover:scale-105 active:scale-95 bg-red-900 hover:bg-red-950"
                                style={{ boxShadow: '0 24px 45px rgba(127, 29, 29, 0.35)' }}
                            >
                                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-shimmer"></div>
                                <span className="relative z-10 inline-flex items-center gap-2">{primaryCtaLabel} <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></span>
                            </button>
                            <button
                                onClick={() => setView && setView(ViewState.COURSES)}
                                className="px-7 py-3.5 bg-transparent border border-white/35 backdrop-blur-md rounded-full font-bold text-base transition-all hover:scale-105 active:scale-95 text-white hover:bg-white/10"
                            >
                                {viewCoursesCtaLabel}
                            </button>
                            <button
                                onClick={() => setView && setView(ViewState.SERVICES)}
                                className="px-7 py-3.5 bg-transparent border border-white/35 backdrop-blur-md rounded-full font-bold text-base transition-all hover:scale-105 active:scale-95 text-white hover:bg-white/10"
                            >
                                {servicesCtaLabel}
                            </button>
                        </div>
                    </div>

                    <div
                        className="relative w-full aspect-video max-h-[72vh] rounded-[2rem] border border-white/20 bg-black/25 backdrop-blur-md shadow-2xl overflow-hidden transition-transform duration-300"
                        style={{ transform: `translateY(${Math.min(40, scrollY * 0.08)}px)` }}
                        onMouseEnter={() => setIsHeroCarouselPaused(true)}
                        onMouseLeave={() => setIsHeroCarouselPaused(false)}
                        onTouchStart={handleHeroTouchStart}
                        onTouchEnd={handleHeroTouchEnd}
                    >
                        {effectiveHeroBackgroundMode === 'image' && (
                            <img
                                src={activeHeroMediaType === 'image' && activeHeroMediaUrl ? activeHeroMediaUrl : heroBackgroundImageUrl}
                                alt=""
                                aria-hidden="true"
                                className="hero-slide-in absolute inset-0 h-full w-full object-cover"
                            />
                        )}
                        {effectiveHeroBackgroundMode === 'video' && (
                            <>
                                {heroMediaEmbedUrl ? (
                                    <>
                                        <iframe
                                            key={`${activeHeroMediaKey}-${heroMediaSoundEnabled ? 'media-sound-on' : 'media-sound-off'}`}
                                            src={heroMediaEmbedUrl}
                                            title={t?.heroMediaTitle || (t?.lang === 'ar' ? 'فيديو المنصة' : 'Platform intro video')}
                                            className="hero-slide-in absolute inset-0 h-full w-full pointer-events-none md:pointer-events-auto"
                                            allow="autoplay; fullscreen; picture-in-picture"
                                            allowFullScreen
                                        />
                                        {!heroMediaSoundEnabled && (
                                            <button
                                                type="button"
                                                onClick={handleHeroMediaInteract}
                                                className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35 bg-black/60 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-black/75"
                                            >
                                                {t?.lang === 'ar' ? 'اضغط لتشغيل الصوت' : 'Tap to play with sound'}
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <video
                                        key={`hero-fg-${activeHeroMediaKey}`}
                                        ref={heroMediaVideoRef}
                                            className="hero-slide-in absolute inset-0 h-full w-full object-cover cursor-pointer"
                                        autoPlay
                                        muted={!heroMediaSoundEnabled}
                                        loop
                                        playsInline
                                        preload="metadata"
                                        controls
                                        onClick={handleHeroMediaInteract}
                                        onTouchStart={handleHeroMediaInteract}
                                    >
                                            <source
                                                key={`hero-fg-src-${activeHeroMediaKey}`}
                                                src={activeHeroMediaType === 'video' && activeHeroMediaUrl ? activeHeroMediaUrl : heroBackgroundVideoUrl}
                                            />
                                    </video>
                                )}
                            </>
                        )}
                        {effectiveHeroBackgroundMode === 'color' && (
                            <div
                                className="absolute inset-0"
                                style={{
                                    backgroundImage: `linear-gradient(140deg, ${hexToRgba(palette.primary, 0.7)}, ${hexToRgba(palette.secondary, 0.8)})`
                                }}
                            ></div>
                        )}
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/65 via-black/10 to-transparent"></div>
                        {hasCarousel && (
                            <>
                                <button
                                    type="button"
                                    onClick={goToPrevHeroSlide}
                                    className="absolute left-3 top-1/2 z-30 -translate-y-1/2 rounded-full border border-white/30 bg-black/45 p-2 text-white transition hover:bg-black/65"
                                    aria-label={t?.previous || 'Previous'}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={goToNextHeroSlide}
                                    className="absolute right-3 top-1/2 z-30 -translate-y-1/2 rounded-full border border-white/30 bg-black/45 p-2 text-white transition hover:bg-black/65"
                                    aria-label={t?.next || 'Next'}
                                >
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                                <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2">
                                    {heroMediaGallery.map((item, index) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => goToHeroSlide(index)}
                                            className={`h-2.5 rounded-full transition-all ${index === activeHeroMediaIndex ? 'w-7 bg-white' : 'w-2.5 bg-white/60 hover:bg-white/80'}`}
                                            aria-label={`${t?.slide || 'Slide'} ${index + 1}`}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
            
            <style>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
                .animate-shimmer {
                    animation: shimmer 1.5s infinite;
                }
                @keyframes heroSlideIn {
                    0% { opacity: 0.35; }
                    100% { opacity: 1; }
                }
                .hero-slide-in {
                    animation: heroSlideIn 520ms ease;
                }
            `}</style>
        </div>
    );
};

export const HeroStats: React.FC<PublicProps> = ({ t, courses = [], users = [] }) => {
    const studentsCount = users.filter((user) => user.role === UserRole.STUDENT || user.role === UserRole.MEMBER).length;
    const instructorsCount = users.filter((user) => user.role === UserRole.INSTRUCTOR).length;
    const numberFormatter = new Intl.NumberFormat('en-US');
    const stats = [
        {
            label: t?.heroStatCoursesAvailable || t?.availableCourses || (t?.lang === 'ar' ? 'الدورات المتاحة' : 'Courses Available'),
            value: courses.length,
            icon: <BookOpen className="w-5 h-5" />
        },
        {
            label: t?.heroStatStudents || t?.students || (t?.lang === 'ar' ? 'الطلاب' : 'Students'),
            value: studentsCount,
            icon: <Users className="w-5 h-5" />
        },
        {
            label: t?.heroStatInstructors || t?.instructors || (t?.lang === 'ar' ? 'المدربون' : 'Instructors'),
            value: instructorsCount,
            icon: <Award className="w-5 h-5" />
        }
    ];

    return (
        <section className="relative -mt-10 z-30 px-4 sm:px-6 lg:px-8 pb-6">
            <div className="max-w-7xl mx-auto">
                <div className="grid gap-4 sm:grid-cols-3">
                    {stats.map((item, idx) => (
                        <HeroStatCard
                            key={item.label}
                            label={item.label}
                            value={item.value}
                            icon={item.icon}
                            delay={`${idx * 140}ms`}
                            numberFormatter={numberFormatter}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
};

export const ImportantNews: React.FC<PublicProps> = ({ t, blogPosts, setView }) => {
    const [isVisible, setIsVisible] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const featured = (blogPosts || []).find(p => p.isFeatured);
    
    const renderedContent = useMemo(() => 
        featured ? DOMPurify.sanitize(featured.content, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'div'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
        }) : '', 
        [featured]
    );

    if (!featured || !isVisible) return null;

    return (
        <>
            <div className="relative z-30 mt-5 mx-auto max-w-4xl px-4 animate-fade-in">
                <TiltCard className="rounded-2xl border border-white/40 bg-white/90 p-1 shadow-xl backdrop-blur-md">
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-red-950 via-red-900 to-black text-white">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.18),transparent_50%),radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.1),transparent_45%)]"></div>
                        <div className="absolute -right-12 -top-12 h-28 w-28 rounded-full bg-white/10 blur-2xl"></div>
                        <div className="absolute -left-10 bottom-0 h-24 w-24 rounded-full bg-red-500/20 blur-2xl"></div>

                        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-4 px-4 py-4 md:px-6 md:py-5">
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em]">
                                    <Sparkles className="h-4 w-4" />
                                    <span>{t.breakingNews}</span>
                                </div>
                                <h3 className="text-base sm:text-lg font-black leading-tight">
                                    {featured.title}
                                </h3>
                                <p className="text-xs sm:text-sm text-red-100 max-w-lg leading-relaxed">
                                    {t.latestBlogDescription || (t.lang === 'ar'
                                        ? 'مقال مميز من مدونتنا يسلط الضوء على افكار جديدة وتجارب تعلم ملهمة.'
                                        : 'A featured post spotlighting fresh ideas, trends, and learning inspiration.')}
                                </p>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                                <button
                                    onClick={() => setShowModal(true)}
                                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-bold text-red-900 shadow-lg shadow-red-950/20 transition-transform hover:-translate-y-0.5"
                                >
                                    {t.readMore} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsVisible(false);
                                    }}
                                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/90 transition-colors hover:bg-white/20"
                                    title={t.dismiss || t.close || (t.lang === 'ar' ? 'إغلاق' : 'Dismiss')}
                                    aria-label={t.close || (t.lang === 'ar' ? 'إغلاق' : 'Close')}
                                >
                                    {t.dismiss || t.close || (t.lang === 'ar' ? 'إغلاق' : 'Dismiss')}
                                </button>
                            </div>
                        </div>
                    </div>
                </TiltCard>
            </div>

            {/* Featured Blog Post Modal */}
            {showModal && featured && (
                <div 
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
                    onClick={() => setShowModal(false)}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="relative h-64 overflow-hidden">
                            <img 
                                src={featured.image} 
                                alt={featured.title} 
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                            <button 
                                onClick={() => setShowModal(false)}
                                className="absolute top-4 right-4 p-2 bg-white/90 hover:bg-white text-zinc-900 rounded-full transition-all shadow-lg"
                                aria-label={t.close || (t.lang === 'ar' ? 'إغلاق' : 'Close')}
                            >
                                <X className="w-5 h-5" />
                            </button>
                            <div className="absolute bottom-6 left-6 right-6">
                                <div className="bg-red-900/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-white uppercase inline-block mb-3">
                                    {t.breakingNews}
                                </div>
                                <h2 className="text-3xl font-black text-white mb-2">{featured.title}</h2>
                                <div className="flex items-center gap-3 text-white/90">
                                    <div className="h-8 w-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center font-bold text-xs">
                                        {featured.author[0]}
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold">{featured.author}</p>
                                        <p className="text-xs opacity-80">{featured.date}</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-y-auto p-8">
                            <div 
                                className="cms-content prose prose-lg max-w-none text-zinc-700"
                                dangerouslySetInnerHTML={{ __html: renderedContent }}
                            />
                        </div>

                        {/* Modal Footer - Optional: Add "View All Blog Posts" button */}
                        {setView && (
                            <div className="border-t border-zinc-200 p-4 bg-zinc-50">
                                <button
                                    onClick={() => {
                                        setShowModal(false);
                                        setView(ViewState.BLOG);
                                    }}
                                    className="w-full bg-red-900 text-white py-3 rounded-lg font-bold hover:bg-red-950 transition-colors flex items-center justify-center gap-2"
                                >
                                    {t.viewAllBlogPosts || (t.lang === 'ar' ? 'عرض جميع المقالات' : 'View All Blog Posts')} <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scale-in {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }
                .animate-fade-in {
                    animation: fade-in 0.2s ease-out;
                }
                .animate-scale-in {
                    animation: scale-in 0.3s ease-out;
                }
                .cms-content h1,
                .cms-content h2,
                .cms-content h3,
                .cms-content h4 {
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                    font-weight: 700;
                    color: #18181b;
                }
                .cms-content p {
                    margin-bottom: 1rem;
                    line-height: 1.75;
                }
                .cms-content ul,
                .cms-content ol {
                    margin-bottom: 1.25rem;
                    padding-left: 1.5rem;
                }
                .cms-content ul {
                    list-style: disc;
                }
                .cms-content ol {
                    list-style: decimal;
                }
                .cms-content li {
                    display: list-item;
                    margin: 0.5rem 0;
                }
                .cms-content blockquote {
                    border-left: 4px solid #dc2626;
                    padding-left: 1rem;
                    color: #52525b;
                    font-style: italic;
                    margin: 1.5rem 0;
                }
                .cms-content a {
                    color: #dc2626;
                    text-decoration: underline;
                }
                .cms-content img {
                    max-width: 100%;
                    border-radius: 0.75rem;
                    margin: 1.5rem 0;
                }
                .cms-content table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 1.5rem 0;
                }
                .cms-content th,
                .cms-content td {
                    border: 1px solid #e4e4e7;
                    padding: 0.75rem;
                }
            `}</style>
        </>
    );
};

export const FeaturedCourses: React.FC<PublicProps> = ({ t, setView, user, setSelectedCourse, setSelectedInstructor, onShowRestrictionModal, courses = [], users = [], pageContent, isMainSite = false }) => {
    const [latestAds, setLatestAds] = useState<Ad[]>([]);
    const [adsSettings, setAdsSettings] = useState<any>(null);
    const isArabic = t?.lang === 'ar';
    const homePagePayload = useMemo(() => parseHomePageContent(pageContent?.content), [pageContent?.content]);
    const whyChooseLabel = (homePagePayload.whyChooseLabel || '').trim() || 'Why Choose Us';
    const whyChooseHeading = (homePagePayload.whyChooseHeading || '').trim() || (isArabic ? 'لماذا تختار منصتنا؟' : 'Why choose us?');
    const whyChooseSubtitle = (homePagePayload.whyChooseSubtitle || '').trim() || (isArabic
        ? 'تجربة تعليمية مصممة بعناية لتمنحك أداء احترافي، مظهر فاخر، ونمو سريع.'
        : 'A carefully crafted learning experience that delivers premium polish, performance, and fast growth.');
    const baseWhyChooseCards = [
        {
            title: isArabic ? 'منصة تعليم متكاملة' : 'All-in-one learning platform',
            description: isArabic
                ? 'كل ما تحتاجه لإدارة التعلم في مكان واحد، من الكورسات إلى التقييمات والمتابعة.'
                : 'Everything you need to run learning in one place, from courses to assessments and tracking.',
            icon: <BookOpen className="h-5 w-5" />
        },
        {
            title: isArabic ? 'إنشاء أكاديميتك الخاصة' : 'Launch your own academy',
            description: isArabic
                ? 'امتلك Subdomain خاص بك وابدأ في بناء أكاديميتك بدون أي تعقيد تقني.'
                : 'Get your own subdomain and build your academy with zero technical hassle.',
            icon: <Building className="h-5 w-5" />
        },
        {
            title: isArabic ? 'إدارة سهلة للمدربين والطلاب' : 'Effortless user management',
            description: isArabic
                ? 'تحكم كامل في المستخدمين، الصلاحيات، والاشتراكات بكل سهولة.'
                : 'Full control over users, permissions, and subscriptions with ease.',
            icon: <Users className="h-5 w-5" />
        },
        {
            title: isArabic ? 'نظام تقييم وواجبات ذكي' : 'Smart quizzes and assignments',
            description: isArabic
                ? 'أنشئ اختبارات وواجبات مع تصحيح تلقائي أو يدوي حسب احتياجك.'
                : 'Create exams and assignments with automatic or manual grading.',
            icon: <CheckCircle className="h-5 w-5" />
        },
        {
            title: isArabic ? 'دعم الذكاء الاصطناعي' : 'AI-powered support',
            description: isArabic
                ? 'تجربة تعليمية متطورة باستخدام أدوات AI لتحسين التعلم والمتابعة.'
                : 'An advanced learning experience using AI tools to improve learning and follow-up.',
            icon: <Brain className="h-5 w-5" />
        },
        {
            title: isArabic ? 'جاهز للنمو والتوسع' : 'Built to scale',
            description: isArabic
                ? 'مناسب للأفراد والمؤسسات مع إمكانية التوسع بسهولة في أي وقت.'
                : 'Made for individuals and institutions, with easy expansion anytime.',
            icon: <Zap className="h-5 w-5" />
        }
    ];
    const whyChooseCards = baseWhyChooseCards.map((fallback, index) => {
        const customCard = homePagePayload.whyChooseCards[index];
        return {
            ...fallback,
            title: (customCard?.title || '').trim() || fallback.title,
            description: (customCard?.description || '').trim() || fallback.description
        };
    });

    const promoHeading = isArabic ? 'ابدأ رحلتك التعليمية اليوم' : 'Start Your Learning Journey Today';
    const promoSubtitle = isArabic
        ? 'انضم إلى منصة احترافية متكاملة لإدارة الأكاديميات، الدورات، وتجربة التعلم الحديثة.'
        : 'Join a premium platform to manage academies, courses, and modern learning experiences.';

    useEffect(() => {
        let mounted = true;
        const fetchLatestAds = async () => {
            try {
                const response = await fetch('/api/ads/latest?limit=3');
                const payload = await response.json().catch(() => []);
                const settingsResponse = await fetch('/api/ads/display-settings');
                const settingsPayload = await settingsResponse.json().catch(() => null);
                if (!response.ok || !Array.isArray(payload)) {
                    return;
                }
                if (mounted) {
                    setLatestAds(payload);
                    setAdsSettings(settingsPayload);
                }
            } catch {
                // Keep homepage resilient if ads API is unavailable.
            }
        };
        fetchLatestAds();
        return () => {
            mounted = false;
        };
    }, []);

    const handlePreview = (course: Course) => {
        if (setSelectedCourse) setSelectedCourse(course);
        if (setView) setView(ViewState.ENROLLMENT);
    };

    const handleEnroll = (course: Course) => {
        // Check if user is a guest
        if (user?.role === 'GUEST') {
            if (onShowRestrictionModal) {
                onShowRestrictionModal();
            }
            return;
        }
        
        if (user) {
            if (setSelectedCourse) setSelectedCourse(course);
            if (setView) setView(ViewState.ENROLLMENT);
        } else {
            if (setView) setView(ViewState.REGISTER);
        }
    };

    const handleInstructorClick = (course: Course) => {
        const instructor = users.find(u => u.name === course.instructor && u.role === 'INSTRUCTOR');
        if (instructor && setSelectedInstructor && setView) {
            setSelectedInstructor(instructor);
            setView(ViewState.PUBLIC_INSTRUCTOR_PROFILE);
        }
    };

    return (
        <div className="py-24 ds-gradient-bg relative overflow-hidden">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-red-200 to-transparent"></div>
            <div className="absolute top-20 left-10 w-64 h-64 bg-red-300/10 rounded-full blur-3xl mix-blend-multiply"></div>
            <div className="absolute bottom-20 right-10 w-80 h-80 bg-zinc-300/20 rounded-full blur-3xl mix-blend-multiply"></div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <ScrollReveal className="mb-16">
                    <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-red-950 via-red-900 to-red-800 px-6 py-10 text-center shadow-2xl sm:px-10">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.09),transparent_40%)]"></div>
                        <div className="relative z-10 max-w-4xl mx-auto">
                            <h2 className="text-red-100 font-bold tracking-[0.2em] uppercase text-xs mb-2">{t.education}</h2>
                            <h3 className="text-3xl sm:text-4xl font-black text-white mb-4">{t.availableCourses}</h3>
                            <p className="text-red-100 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">{t.popularPrograms}</p>
                        </div>
                    </div>
                </ScrollReveal>

                <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
                    {courses.map((course, idx) => (
                        <ScrollReveal key={course.id} delay={`${idx * 150}ms`}>
                            <CourseCard course={course} onPreview={() => handlePreview(course)} onEnroll={() => handleEnroll(course)} onInstructorClick={() => handleInstructorClick(course)} t={t} darkEnrollButton />
                        </ScrollReveal>
                    ))}
                </div>

                {!!latestAds.length && (
                    <div className="mt-20">
                        {adsSettings?.homepagePromoEnabled && adsSettings?.homepagePromoMediaUrl && (
                            <div className="ds-card mb-8 overflow-hidden">
                                <a href={adsSettings.homepagePromoLink || '/ads'} className="block">
                                    {adsSettings.homepagePromoType === 'video' ? (
                                        <video src={adsSettings.homepagePromoMediaUrl} className="w-full h-72 object-cover" autoPlay muted loop playsInline />
                                    ) : (
                                        <img src={adsSettings.homepagePromoMediaUrl} alt={adsSettings.homepagePromoTitle || 'Ads promo'} className="w-full h-72 object-cover" />
                                    )}
                                    <div className="p-6">
                                        <h4 className="text-xl font-bold text-zinc-900 mb-2">{adsSettings.homepagePromoTitle || (t.adsMarketplace || 'Ads')}</h4>
                                        <p className="text-zinc-600">{adsSettings.homepagePromoSubtitle || t.latestAdsSubtitle || ''}</p>
                                    </div>
                                </a>
                            </div>
                        )}
                        <ScrollReveal className="mb-10">
                            <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-red-950 via-red-900 to-red-800 px-6 py-10 text-center shadow-2xl sm:px-10">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.09),transparent_40%)]"></div>
                                <div className="relative z-10 max-w-4xl mx-auto">
                                    <h3 className="text-3xl sm:text-4xl font-black text-white mb-4">{t.latestAds || 'Latest Ads'}</h3>
                                    <p className="text-red-100 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">{t.latestAdsSubtitle || 'Browse the newest educational opportunities and services.'}</p>
                                </div>
                            </div>
                        </ScrollReveal>
                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 mb-8">
                            {latestAds.map((ad) => (
                                <AdCard key={ad.id} ad={ad} t={t} onOpen={() => { window.location.href = `/ads/${ad.id}`; }} />
                            ))}
                        </div>
                        <div className="text-center">
                            <button
                                onClick={() => setView?.(ViewState.ADS)}
                                className="rounded-xl bg-red-900 px-5 py-3 font-bold text-white shadow-md transition-colors hover:bg-red-950"
                            >
                                {t.viewAllAds || 'View All Ads'}
                            </button>
                        </div>
                    </div>
                )}

                <section className="mt-24" dir={isArabic ? 'rtl' : 'ltr'}>
                    <ScrollReveal className="mb-12">
                        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-red-950 via-red-900 to-red-800 px-6 py-12 text-center shadow-2xl sm:px-10">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.09),transparent_40%)]"></div>
                            <div className="relative z-10 max-w-4xl mx-auto">
                                <p className="text-red-100 font-bold tracking-[0.25em] uppercase text-xs mb-3">{whyChooseLabel}</p>
                                <h3 className="text-3xl sm:text-4xl font-black text-white mb-4">{whyChooseHeading}</h3>
                                <p className="text-red-100 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
                                    {whyChooseSubtitle}
                                </p>
                            </div>
                        </div>
                    </ScrollReveal>

                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {whyChooseCards.map((card, idx) => (
                            <ScrollReveal key={card.title} delay={`${idx * 120}ms`}>
                                <div className="group h-full rounded-2xl border border-red-100/70 bg-white/95 p-6 shadow-xl backdrop-blur transition-transform duration-300 hover:-translate-y-1">
                                    <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-700 shadow-inner ring-1 ring-red-100">
                                        {card.icon}
                                    </div>
                                    <h4 className="text-lg font-bold text-zinc-900 mb-2">{card.title}</h4>
                                    <p className="text-sm text-zinc-900 leading-relaxed">{card.description}</p>
                                </div>
                            </ScrollReveal>
                        ))}
                    </div>
                </section>

                <section className="mt-14" dir={isArabic ? 'rtl' : 'ltr'}>
                    <ScrollReveal className="mb-8">
                        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-zinc-900 via-zinc-800 to-red-950 px-6 py-12 text-center shadow-2xl sm:px-10">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(248,113,113,0.24),transparent_42%),radial-gradient(circle_at_85%_0%,rgba(251,191,36,0.14),transparent_45%)]"></div>
                            <div className="relative z-10 max-w-4xl mx-auto">
                                <p className="text-red-200 font-bold tracking-[0.2em] uppercase text-xs mb-2">{isArabic ? 'ابدأ الآن' : 'Get Started'}</p>
                                <h3 className="text-3xl sm:text-4xl font-black text-white mb-4">{promoHeading}</h3>
                                <p className="text-zinc-200 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed mb-8">{promoSubtitle}</p>
                                <div className={`flex flex-col sm:flex-row gap-3 justify-center ${isArabic ? 'sm:flex-row-reverse' : ''}`}>
                                    {isMainSite ? (
                                        <button
                                            type="button"
                                            onClick={() => { window.location.href = '/saas'; }}
                                            className="rounded-xl bg-red-900 px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-red-950"
                                        >
                                            {isArabic ? 'إنشاء أكاديميتك' : 'Create Your Academy'}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setView?.(ViewState.REGISTER)}
                                            className="rounded-xl bg-red-900 px-6 py-3 font-bold text-white shadow-md transition-colors hover:bg-red-950"
                                        >
                                            {isArabic ? 'إنشاء حساب' : 'Create Account'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setView?.(ViewState.LOGIN)}
                                        className="rounded-xl border border-white/40 bg-white/10 px-6 py-3 font-bold text-white shadow-md backdrop-blur transition-colors hover:bg-white/20"
                                    >
                                        {isArabic ? 'تسجيل الدخول' : 'Login'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </ScrollReveal>
                </section>
            </div>
        </div>
    );
};

export const FreelancerMembershipSection: React.FC<PublicProps> = ({ t }) => {
    const isArabic = t?.lang === 'ar';
    const [freelancerSubmitting, setFreelancerSubmitting] = useState(false);
    const [membershipSubmitting, setMembershipSubmitting] = useState(false);
    const [showMembershipPassword, setShowMembershipPassword] = useState(false);
    const [showMembershipConfirmPassword, setShowMembershipConfirmPassword] = useState(false);
    const [freelancerMessage, setFreelancerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [membershipMessage, setMembershipMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [freelancerData, setFreelancerData] = useState({
        fullName: '',
        email: '',
        phone: '',
        country: '',
        fieldOfExpertise: '',
        yearsOfExperience: '',
        shortBio: ''
    });
    const [freelancerPhone, setFreelancerPhone] = useState<PhoneValue>(parsePhoneValue(''));
    const [freelancerResume, setFreelancerResume] = useState<File | null>(null);

    const [membershipData, setMembershipData] = useState({
        name: '',
        email: '',
        phone: '',
        country: '',
        membershipType: 'BRONZE',
        password: '',
        confirmPassword: ''
    });
    const [membershipPhone, setMembershipPhone] = useState<PhoneValue>(parsePhoneValue(''));

    const requiredMessage = t?.validationRequired || (isArabic ? 'هذا الحقل مطلوب.' : 'This field is required.');
    const invalidEmailMessage = t?.errors?.validationInvalidEmail || (isArabic ? 'يرجى إدخال بريد إلكتروني صحيح.' : 'Please enter a valid email address.');

    const isEmailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

    const handleFreelancerSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setFreelancerMessage(null);

        const years = Number.parseInt(freelancerData.yearsOfExperience, 10);
        if (
            !freelancerData.fullName.trim() ||
            !freelancerData.email.trim() ||
            !freelancerPhone.number.trim() ||
            !freelancerData.country.trim() ||
            !freelancerData.fieldOfExpertise.trim() ||
            !freelancerData.shortBio.trim() ||
            !Number.isFinite(years) ||
            years < 0
        ) {
            setFreelancerMessage({ type: 'error', text: requiredMessage });
            return;
        }
        if (!isEmailValid(freelancerData.email.trim())) {
            setFreelancerMessage({ type: 'error', text: invalidEmailMessage });
            return;
        }

        try {
            setFreelancerSubmitting(true);
            const formData = new FormData();
            formData.append('fullName', freelancerData.fullName.trim());
            formData.append('email', freelancerData.email.trim());
            formData.append('phone', freelancerPhone.full || freelancerPhone.number.trim());
            formData.append('country', freelancerData.country.trim());
            formData.append('fieldOfExpertise', freelancerData.fieldOfExpertise.trim());
            formData.append('yearsOfExperience', String(years));
            formData.append('shortBio', freelancerData.shortBio.trim());
            if (freelancerResume) {
                formData.append('resume', freelancerResume);
            }

            const response = await fetch('/api/freelancers/signup', {
                method: 'POST',
                headers: {
                    'Accept-Language': isArabic ? 'ar' : 'en'
                },
                body: formData
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || (isArabic ? 'تعذر إرسال الطلب.' : 'Unable to submit the application.'));
            }

            setFreelancerData({
                fullName: '',
                email: '',
                phone: '',
                country: '',
                fieldOfExpertise: '',
                yearsOfExperience: '',
                shortBio: ''
            });
            setFreelancerPhone(parsePhoneValue(''));
            setFreelancerResume(null);
            setFreelancerMessage({
                type: 'success',
                text: payload?.message || (isArabic ? 'تم إرسال طلب المستقل بنجاح.' : 'Freelancer application submitted successfully.')
            });
        } catch (error) {
            setFreelancerMessage({
                type: 'error',
                text: error instanceof Error ? error.message : (isArabic ? 'تعذر إرسال الطلب.' : 'Unable to submit the application.')
            });
        } finally {
            setFreelancerSubmitting(false);
        }
    };

    const handleMembershipSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setMembershipMessage(null);

        if (
            !membershipData.name.trim() ||
            !membershipData.email.trim() ||
            !membershipPhone.number.trim() ||
            !membershipData.country.trim() ||
            !membershipData.password.trim() ||
            !membershipData.confirmPassword.trim()
        ) {
            setMembershipMessage({ type: 'error', text: requiredMessage });
            return;
        }
        if (!isEmailValid(membershipData.email.trim())) {
            setMembershipMessage({ type: 'error', text: invalidEmailMessage });
            return;
        }
        if (membershipData.password !== membershipData.confirmPassword) {
            setMembershipMessage({
                type: 'error',
                text: t?.membershipPasswordMismatch || (isArabic ? 'كلمات المرور غير متطابقة.' : 'Passwords do not match.')
            });
            return;
        }

        try {
            setMembershipSubmitting(true);
            let successMessage = '';
            const response = await fetch('/api/memberships/signup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept-Language': isArabic ? 'ar' : 'en'
                },
                body: JSON.stringify({
                    name: membershipData.name.trim(),
                    email: membershipData.email.trim(),
                    phone: membershipPhone.full || membershipPhone.number.trim(),
                    country: membershipData.country.trim(),
                    membershipType: membershipData.membershipType,
                    password: membershipData.password
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || (isArabic ? 'تعذر إكمال التسجيل.' : 'Unable to complete signup.'));
            }

            if (payload?.payment?.checkoutRequired && payload?.membership?.id) {
                const checkoutResponse = await fetch(`/api/memberships/${payload.membership.id}/checkout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept-Language': isArabic ? 'ar' : 'en'
                    },
                    body: JSON.stringify({
                        email: membershipData.email.trim()
                    })
                });
                const checkoutPayload = await checkoutResponse.json().catch(() => ({}));
                if (!checkoutResponse.ok) {
                    throw new Error(checkoutPayload?.error || (isArabic ? 'تعذر إكمال دفع العضوية.' : 'Unable to complete membership payment.'));
                }
                successMessage = checkoutPayload?.message || '';
            }

            setMembershipData({
                name: '',
                email: '',
                phone: '',
                country: '',
                membershipType: 'BRONZE',
                password: '',
                confirmPassword: ''
            });
            setMembershipPhone(parsePhoneValue(''));
            setMembershipMessage({
                type: 'success',
                text: successMessage || payload?.message || (isArabic
                    ? 'تم إنشاء حساب العضوية. يمكنك تسجيل الدخول الآن.'
                    : 'Membership account created. You can log in now.')
            });
        } catch (error) {
            setMembershipMessage({
                type: 'error',
                text: error instanceof Error ? error.message : (isArabic ? 'تعذر إكمال التسجيل.' : 'Unable to complete signup.')
            });
        } finally {
            setMembershipSubmitting(false);
        }
    };

    const boxClasses = 'rounded-3xl border border-zinc-200 bg-white/95 shadow-lg p-6 sm:p-8';
    const inputClasses = 'w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500';

    return (
        <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-zinc-50 via-white to-zinc-100">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="text-center">
                    <h2 className="text-3xl sm:text-4xl font-black text-zinc-900">{t?.communityJoinTitle || (isArabic ? 'انضم إلى مجتمعنا الاحترافي' : 'Join Our Professional Community')}</h2>
                    <p className="mt-2 text-zinc-600">{t?.communityJoinSubtitle || (isArabic ? 'اختر مسارك: سجل معنا فريلانسر أو قدم طلب عضوية.' : 'Choose your path: apply as a freelancer or join yearly membership.')}</p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <form className={boxClasses + ' space-y-4'} onSubmit={handleFreelancerSubmit}>
                        <h3 className="text-2xl font-bold text-zinc-900">{t?.freelancerFormTitle || (isArabic ? 'سجل معنا فريلانسر' : 'Sign up as Freelancer')}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input className={inputClasses} placeholder={t?.fullName || (isArabic ? 'الاسم الكامل' : 'Full Name')} value={freelancerData.fullName} onChange={(e) => setFreelancerData(prev => ({ ...prev, fullName: e.target.value }))} />
                            <input className={inputClasses} placeholder={t?.emailLabel || (isArabic ? 'البريد الإلكتروني' : 'Email')} value={freelancerData.email} onChange={(e) => setFreelancerData(prev => ({ ...prev, email: e.target.value }))} />
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-zinc-600 mb-1">{t?.phoneLabel || (isArabic ? 'رقم الهاتف' : 'Phone Number')} <span className="text-red-500">*</span></label>
                                <PhoneInput
                                    value={freelancerPhone}
                                    onChange={setFreelancerPhone}
                                    required
                                    placeholder={isArabic ? 'أدخل رقم الهاتف' : 'Enter phone number'}
                                    inputClassName="text-sm"
                                />
                            </div>
                            <input className={inputClasses} placeholder={t?.countryLabel || (isArabic ? 'الدولة' : 'Country')} value={freelancerData.country} onChange={(e) => setFreelancerData(prev => ({ ...prev, country: e.target.value }))} />
                            <input className={inputClasses} placeholder={t?.expertiseLabel || (isArabic ? 'مجال الخبرة' : 'Field of Expertise')} value={freelancerData.fieldOfExpertise} onChange={(e) => setFreelancerData(prev => ({ ...prev, fieldOfExpertise: e.target.value }))} />
                            <input className={inputClasses} type="number" min={0} placeholder={t?.yearsOfExperienceLabel || (isArabic ? 'سنوات الخبرة' : 'Years of Experience')} value={freelancerData.yearsOfExperience} onChange={(e) => setFreelancerData(prev => ({ ...prev, yearsOfExperience: e.target.value }))} />
                        </div>
                        <textarea className={inputClasses + ' min-h-[110px]'} placeholder={t?.bioLabel || (isArabic ? 'نبذة مختصرة' : 'Short Bio / Description')} value={freelancerData.shortBio} onChange={(e) => setFreelancerData(prev => ({ ...prev, shortBio: e.target.value }))} />
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 mb-1">{t?.cvUploadLabel || (isArabic ? 'رفع السيرة الذاتية (اختياري)' : 'Upload CV (optional)')}</label>
                            <input
                                type="file"
                                accept=".pdf,.doc,.docx"
                                onChange={(e) => setFreelancerResume(e.target.files?.[0] || null)}
                                className="block w-full text-sm text-zinc-600 file:mr-4 file:rounded-lg file:border-0 file:bg-red-100 file:px-4 file:py-2 file:text-red-900 file:font-semibold hover:file:bg-red-200"
                            />
                        </div>
                        {freelancerMessage && (
                            <p className={`text-sm font-semibold ${freelancerMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                                {freelancerMessage.text}
                            </p>
                        )}
                        <button type="submit" disabled={freelancerSubmitting} className="w-full rounded-xl bg-red-900 text-white font-bold py-2.5 hover:bg-red-950 disabled:opacity-60">
                            {freelancerSubmitting ? (t?.processing || (isArabic ? 'جارِ المعالجة...' : 'Processing...')) : (t?.freelancerSubmitLabel || (isArabic ? 'إرسال طلب المستقل' : 'Submit Freelancer Application'))}
                        </button>
                    </form>

                    <form className={boxClasses + ' space-y-4'} onSubmit={handleMembershipSubmit}>
                        <h3 className="text-2xl font-bold text-zinc-900">{t?.membershipFormTitle || (isArabic ? 'طلب عضوية' : 'Yearly Membership')}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <input className={inputClasses} placeholder={t?.fullName || (isArabic ? 'الاسم الكامل' : 'Name')} value={membershipData.name} onChange={(e) => setMembershipData(prev => ({ ...prev, name: e.target.value }))} />
                            <input className={inputClasses} placeholder={t?.emailLabel || (isArabic ? 'البريد الإلكتروني' : 'Email')} value={membershipData.email} onChange={(e) => setMembershipData(prev => ({ ...prev, email: e.target.value }))} />
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-zinc-600 mb-1">{t?.phoneLabel || (isArabic ? 'رقم الهاتف' : 'Phone Number')} <span className="text-red-500">*</span></label>
                                <PhoneInput
                                    value={membershipPhone}
                                    onChange={setMembershipPhone}
                                    required
                                    placeholder={isArabic ? 'أدخل رقم الهاتف' : 'Enter phone number'}
                                    inputClassName="text-sm"
                                />
                            </div>
                            <input className={inputClasses} placeholder={t?.countryLabel || (isArabic ? 'الدولة' : 'Country')} value={membershipData.country} onChange={(e) => setMembershipData(prev => ({ ...prev, country: e.target.value }))} />
                            <select className={inputClasses} value={membershipData.membershipType} onChange={(e) => setMembershipData(prev => ({ ...prev, membershipType: e.target.value }))}>
                                <option value="BRONZE">{t?.membershipBronzeLabel || (isArabic ? 'Bronze (مجانية)' : 'Bronze (Free)')}</option>
                                <option value="SILVER">{t?.membershipSilverLabel || (isArabic ? 'Silver (مدفوعة)' : 'Silver (Paid)')}</option>
                            </select>
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowMembershipPassword(!showMembershipPassword)}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                    aria-label={showMembershipPassword ? (isArabic ? 'إخفاء كلمة المرور' : 'Hide password') : (isArabic ? 'إظهار كلمة المرور' : 'Show password')}
                                >
                                    {showMembershipPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                                <input
                                    className={inputClasses + ' pl-10'}
                                    type={showMembershipPassword ? 'text' : 'password'}
                                    placeholder={t?.passwordLabel || (isArabic ? 'كلمة المرور' : 'Password')}
                                    value={membershipData.password}
                                    onChange={(e) => setMembershipData(prev => ({ ...prev, password: e.target.value }))}
                                />
                            </div>
                            <div className="relative md:col-span-2">
                                <button
                                    type="button"
                                    onClick={() => setShowMembershipConfirmPassword(!showMembershipConfirmPassword)}
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                                    aria-label={showMembershipConfirmPassword ? (isArabic ? 'إخفاء تأكيد كلمة المرور' : 'Hide confirm password') : (isArabic ? 'إظهار تأكيد كلمة المرور' : 'Show confirm password')}
                                >
                                    {showMembershipConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                                <input
                                    className={inputClasses + ' pl-10'}
                                    type={showMembershipConfirmPassword ? 'text' : 'password'}
                                    placeholder={t?.confirmPasswordLabel || (isArabic ? 'تأكيد كلمة المرور' : 'Confirm Password')}
                                    value={membershipData.confirmPassword}
                                    onChange={(e) => setMembershipData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                />
                            </div>
                        </div>
                        {membershipMessage && (
                            <p className={`text-sm font-semibold ${membershipMessage.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                                {membershipMessage.text}
                            </p>
                        )}
                        <button type="submit" disabled={membershipSubmitting} className="w-full rounded-xl bg-zinc-900 text-white font-bold py-2.5 hover:bg-black disabled:opacity-60">
                            {membershipSubmitting ? (t?.processing || (isArabic ? 'جارِ المعالجة...' : 'Processing...')) : (t?.membershipSubmitLabel || (isArabic ? 'إنشاء حساب العضوية' : 'Create Membership Account'))}
                        </button>
                    </form>
                </div>
            </div>
        </section>
    );
};

const AdCard: React.FC<{ ad: Ad; t?: any; onOpen?: () => void }> = ({ ad, t, onOpen }) => {
    const isArabic = t?.lang === 'ar';
    const priceLabel = pickLocalizedCopy([t?.priceLabel], isArabic, 'Price', 'السعر');
    const locationLabel = pickLocalizedCopy([t?.locationLabel], isArabic, 'Location', 'الموقع');
    const publishedOnLabel = pickLocalizedCopy([t?.publishedOn], isArabic, 'Published', 'تاريخ النشر');
    const gallery = normalizeMediaGallery(ad.gallery);
    const fallbackGallery: MediaGalleryItem[] = [];
    if ((ad.imageUrl || '').trim()) {
        fallbackGallery.push({ id: `ad_card_fallback_image_${ad.id}`, url: ad.imageUrl as string, mediaType: 'image', order: fallbackGallery.length });
    }
    if (ad.mediaType === 'video' && (ad.mediaUrl || '').trim()) {
        fallbackGallery.push({ id: `ad_card_fallback_video_${ad.id}`, url: ad.mediaUrl as string, mediaType: 'video', order: fallbackGallery.length });
    }
    const safeGallery = gallery.length
        ? gallery
        : fallbackGallery.length
            ? fallbackGallery
            : [{ id: `ad_card_placeholder_${ad.id}`, url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200&q=80', mediaType: 'image' as const, order: 0 }];
    const [activeCardMediaIndex, setActiveCardMediaIndex] = useState(0);
    const activeCardMedia = safeGallery[activeCardMediaIndex] || safeGallery[0];
    const activeCardEmbedUrl = activeCardMedia.mediaType === 'video' ? toStandardEmbedVideoUrl(activeCardMedia.url) : null;
    const hasMultipleMedia = safeGallery.length > 1;

    useEffect(() => {
        setActiveCardMediaIndex(0);
    }, [ad.id]);

    const goToCardMedia = (index: number) => {
        const bounded = (index + safeGallery.length) % safeGallery.length;
        setActiveCardMediaIndex(bounded);
    };

    return (
        <div className="ds-card overflow-hidden h-full flex flex-col group">
            <div className="h-44 overflow-hidden relative">
                {activeCardMedia.mediaType === 'video' ? (
                    activeCardEmbedUrl ? (
                        <iframe
                            key={`ad-card-embed-${ad.id}-${activeCardMedia.id}`}
                            src={activeCardEmbedUrl}
                            title={ad.title}
                            className="h-full w-full pointer-events-none"
                            allow="autoplay; fullscreen; picture-in-picture"
                            allowFullScreen
                        />
                    ) : (
                        <video
                            key={`ad-card-video-${ad.id}-${activeCardMedia.id}`}
                            className="h-full w-full object-cover"
                            muted
                            loop
                            autoPlay
                            playsInline
                            preload="metadata"
                        >
                            <source src={activeCardMedia.url} />
                        </video>
                    )
                ) : (
                    <img
                        key={`ad-card-image-${ad.id}-${activeCardMedia.id}`}
                        src={activeCardMedia.url}
                        alt={ad.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                )}
                {hasMultipleMedia && (
                    <>
                        <button
                            type="button"
                            onClick={() => goToCardMedia(activeCardMediaIndex - 1)}
                            className="absolute left-2 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/40 bg-black/45 p-1.5 text-white hover:bg-black/65"
                            aria-label={t?.previous || 'Previous'}
                        >
                            <ArrowLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => goToCardMedia(activeCardMediaIndex + 1)}
                            className="absolute right-2 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/40 bg-black/45 p-1.5 text-white hover:bg-black/65"
                            aria-label={t?.next || 'Next'}
                        >
                            <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                        <div className="absolute bottom-2 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
                            {safeGallery.map((item, index) => (
                                <button
                                    key={`ad-card-dot-${ad.id}-${item.id}`}
                                    type="button"
                                    onClick={() => goToCardMedia(index)}
                                    className={`h-1.5 rounded-full transition-all ${index === activeCardMediaIndex ? 'w-5 bg-white' : 'w-1.5 bg-white/65 hover:bg-white/85'}`}
                                    aria-label={`${t?.slide || 'Slide'} ${index + 1}`}
                                />
                            ))}
                        </div>
                    </>
                )}
                {ad.categoryName && (
                    <span className="absolute top-3 right-3 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-semibold text-zinc-700">
                        {ad.categoryName}
                    </span>
                )}
            </div>
            <div className="p-5 flex flex-col flex-1">
                <h4 className="font-bold text-zinc-900 text-lg mb-2 line-clamp-2">{ad.title}</h4>
                <p className="text-sm text-zinc-600 mb-4 line-clamp-3">{ad.description}</p>
                <div className="mt-auto space-y-2 text-sm text-zinc-500">
                    {typeof ad.price === 'number' && <p>{priceLabel}: ${ad.price}</p>}
                    {ad.location && <p>{locationLabel}: {ad.location}</p>}
                    {ad.publishDate && <p>{publishedOnLabel}: {new Date(ad.publishDate).toLocaleDateString()}</p>}
                </div>
                <button
                    onClick={onOpen}
                    className="mt-4 w-full rounded-xl bg-red-900 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-red-950"
                >
                    {t.viewAdDetails || 'View details'}
                </button>
            </div>
        </div>
    );
};

export const AdsPage: React.FC<PublicProps> = ({ t }) => {
    const [ads, setAds] = useState<Ad[]>([]);
    const [stats, setStats] = useState({ adsCount: 0, usersCount: 0, satisfactionRate: 0, supportAvailability: '24/7' });
    const [settings, setSettings] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const isArabic = t?.lang === 'ar';

    const heroTitle = pickLocalizedCopy(
        [settings?.heroTitle, t?.adsHeroTitle],
        isArabic,
        'Discover the best educational ads',
        'اكتشف أفضل الإعلانات التعليمية'
    );
    const heroSubtitle = pickLocalizedCopy(
        [settings?.heroSubtitle, t?.adsHeroSubtitle],
        isArabic,
        'A platform to showcase educational services, private lessons, study tools, and learning opportunities.',
        'منصة لعرض الخدمات التعليمية، الدروس الخاصة، الأدوات الدراسية، والفرص التعليمية.'
    );
    const searchPlaceholder = pickLocalizedCopy(
        [settings?.searchPlaceholder, t?.adsSearchPlaceholder],
        isArabic,
        'Search for tutors, courses, educational tools...',
        'ابحث عن مدرس، كورس، أدوات تعليمية...'
    );
    const statAdsLabel = pickLocalizedCopy(
        [settings?.statAdsLabel, t?.adsStatAds],
        isArabic,
        'Total Ads',
        'عدد الإعلانات'
    );
    const statUsersLabel = pickLocalizedCopy(
        [settings?.statUsersLabel, t?.adsStatUsers],
        isArabic,
        'Total Users',
        'عدد المستخدمين'
    );
    const statSatisfactionLabel = pickLocalizedCopy(
        [settings?.statSatisfactionLabel, t?.adsStatSatisfaction],
        isArabic,
        'Satisfaction Rate',
        'نسبة الرضا'
    );
    const statSupportLabel = pickLocalizedCopy(
        [settings?.statSupportLabel, t?.adsStatSupport],
        isArabic,
        'Technical Support',
        'دعم فني'
    );

    useEffect(() => {
        let mounted = true;
        const loadData = async () => {
            setIsLoading(true);
            try {
                const [adsResponse, statsResponse, settingsResponse] = await Promise.all([
                    fetch(`/api/ads?search=${encodeURIComponent(searchQuery)}`),
                    fetch('/api/ads/stats'),
                    fetch('/api/ads/display-settings')
                ]);
                const adsPayload = await adsResponse.json().catch(() => []);
                const statsPayload = await statsResponse.json().catch(() => null);
                const settingsPayload = await settingsResponse.json().catch(() => null);
                if (mounted) {
                    setAds(Array.isArray(adsPayload) ? adsPayload : []);
                    if (statsPayload) {
                        setStats(statsPayload);
                    }
                    setSettings(settingsPayload);
                }
            } catch {
                if (mounted) {
                    setAds([]);
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };
        loadData();
        return () => {
            mounted = false;
        };
    }, [searchQuery]);

    return (
        <div className="ds-gradient-bg min-h-screen pb-16">
            <section className="pt-24 pb-12 px-4 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-red-950 via-red-900 to-red-800 px-6 py-12 text-center shadow-2xl sm:px-10 lg:py-14">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.09),transparent_40%)]"></div>
                        <div className="relative z-10 max-w-5xl mx-auto">
                            <h1 className="mb-4 text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">
                                {heroTitle}
                            </h1>
                            <p className="mx-auto mb-8 max-w-3xl text-sm leading-relaxed text-red-100 sm:text-base lg:text-lg">
                                {heroSubtitle}
                            </p>
                        </div>
                    </div>
                    <div className="relative z-20 mx-auto -mt-7 max-w-4xl px-1 sm:-mt-8">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={searchPlaceholder}
                            className="w-full rounded-full border border-red-100 bg-white px-7 py-5 text-lg shadow-xl focus:outline-none focus:ring-2 focus:ring-red-700"
                        />
                    </div>
                </div>
            </section>

            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-12">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-2xl bg-white p-5 text-center shadow-lg ring-1 ring-red-100/70"><p className="text-4xl font-black text-red-900">{stats.adsCount}</p><p className="mt-1 text-sm text-red-700">{statAdsLabel}</p></div>
                    <div className="rounded-2xl bg-white p-5 text-center shadow-lg ring-1 ring-red-100/70"><p className="text-4xl font-black text-red-900">{stats.usersCount}</p><p className="mt-1 text-sm text-red-700">{statUsersLabel}</p></div>
                    <div className="rounded-2xl bg-white p-5 text-center shadow-lg ring-1 ring-red-100/70"><p className="text-4xl font-black text-red-900">{stats.satisfactionRate}%</p><p className="mt-1 text-sm text-red-700">{statSatisfactionLabel}</p></div>
                    <div className="rounded-2xl bg-white p-5 text-center shadow-lg ring-1 ring-red-100/70"><p className="text-4xl font-black text-red-900">{stats.supportAvailability}</p><p className="mt-1 text-sm text-red-700">{statSupportLabel}</p></div>
                </div>
            </section>

            <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {isLoading ? (
                    <div className="text-center py-16 text-zinc-500">{t.loading || 'Loading...'}</div>
                ) : ads.length === 0 ? (
                    <div className="ds-card text-center py-16 text-zinc-500">{t.noAdsFound || 'No ads found.'}</div>
                ) : (
                    <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                        {ads.map((ad) => (
                            <AdCard key={ad.id} ad={ad} t={t} onOpen={() => { window.location.href = `/ads/${ad.id}`; }} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
};

export const AdDetailsPage: React.FC<PublicProps> = ({ t, setView }) => {
    const [ad, setAd] = useState<Ad | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [activeMediaIndex, setActiveMediaIndex] = useState(0);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const adMediaVideoRef = useRef<HTMLVideoElement>(null);
    const isArabic = t?.lang === 'ar';
    const categoryLabel = pickLocalizedCopy([t?.categoryLabel], isArabic, 'Category', 'الفئة');
    const locationLabel = pickLocalizedCopy([t?.locationLabel], isArabic, 'Location', 'الموقع');
    const priceLabel = pickLocalizedCopy([t?.priceLabel], isArabic, 'Price', 'السعر');
    const publishedOnLabel = pickLocalizedCopy([t?.publishedOn], isArabic, 'Published', 'تاريخ النشر');
    const priceOnRequestLabel = pickLocalizedCopy([t?.priceOnRequest], isArabic, 'On request', 'عند الطلب');
    const contactInformationLabel = pickLocalizedCopy([t?.contactInformation], isArabic, 'Contact information', 'معلومات التواصل');
    const adId = useMemo(() => {
        const match = window.location.pathname.match(/\/ads\/([^/]+)$/);
        return match?.[1] || null;
    }, []);

    useEffect(() => {
        if (!adId) {
            setIsLoading(false);
            return;
        }
        let mounted = true;
        const loadAd = async () => {
            try {
                const response = await fetch(`/api/ads/${adId}`);
                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    throw new Error('not_found');
                }
                if (mounted) {
                    setAd(payload);
                }
            } catch {
                if (mounted) {
                    setAd(null);
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        };
        loadAd();
        return () => {
            mounted = false;
        };
    }, [adId]);

    useEffect(() => {
        setActiveMediaIndex(0);
    }, [ad?.id]);

    const fallbackGallery: MediaGalleryItem[] = [];
    if ((ad?.imageUrl || '').trim()) {
        fallbackGallery.push({ id: 'ad_fallback_image', url: ad?.imageUrl as string, mediaType: 'image', order: fallbackGallery.length });
    }
    if (ad?.mediaType === 'video' && (ad?.mediaUrl || '').trim()) {
        fallbackGallery.push({ id: 'ad_fallback_video', url: ad?.mediaUrl as string, mediaType: 'video', order: fallbackGallery.length });
    }
    const gallery = normalizeMediaGallery(ad?.gallery).length
        ? normalizeMediaGallery(ad?.gallery)
        : fallbackGallery;
    const safeGallery = gallery.length
        ? gallery
        : [{ id: 'ad_placeholder', url: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1200&q=80', mediaType: 'image' as const, order: 0 }];
    const activeMedia = safeGallery[activeMediaIndex] || safeGallery[0];
    const activeAdMediaKey = activeMedia?.id || `ad_media_${activeMediaIndex}`;
    const activeAdEmbedUrl = activeMedia.mediaType === 'video' ? toStandardEmbedVideoUrl(activeMedia.url) : null;
    const adTitle = ad?.title || (t?.adMediaTitle || 'Ad media');
    const hasMultipleMedia = safeGallery.length > 1;

    const goToAdMedia = (index: number) => {
        const bounded = (index + safeGallery.length) % safeGallery.length;
        setActiveMediaIndex(bounded);
    };

    const handleAdTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        setTouchStartX(event.changedTouches[0]?.clientX ?? null);
    };

    const handleAdTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
        const touchEndX = event.changedTouches[0]?.clientX;
        if (touchStartX === null || typeof touchEndX !== 'number') {
            setTouchStartX(null);
            return;
        }
        const deltaX = touchEndX - touchStartX;
        if (Math.abs(deltaX) > 45) {
            if (deltaX < 0) {
                goToAdMedia(activeMediaIndex + 1);
            } else {
                goToAdMedia(activeMediaIndex - 1);
            }
        }
        setTouchStartX(null);
    };

    useEffect(() => {
        if (activeMediaIndex <= safeGallery.length - 1) {
            return;
        }
        setActiveMediaIndex(0);
    }, [activeMediaIndex, safeGallery.length]);

    useEffect(() => {
        if (activeMedia.mediaType !== 'video' || activeAdEmbedUrl) {
            return;
        }
        const video = adMediaVideoRef.current;
        if (!video) {
            return;
        }
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                // Ignore autoplay restrictions; user can press play manually.
            });
        }
    }, [activeAdMediaKey, activeAdEmbedUrl, activeMedia.mediaType]);

    if (isLoading) {
        return <div className="min-h-screen ds-gradient-bg flex items-center justify-center text-zinc-500">{t.loading || 'Loading...'}</div>;
    }

    if (!ad) {
        return (
            <div className="min-h-screen ds-gradient-bg flex flex-col items-center justify-center gap-4">
                <p className="text-zinc-600">{t.adNotFound || 'Ad not found.'}</p>
                <button onClick={() => setView?.(ViewState.ADS)} className="ds-btn ds-btn-secondary">{t.backToAds || 'Back to Ads'}</button>
            </div>
        );
    }

    return (
        <div className="ds-gradient-bg min-h-screen py-16">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                <button onClick={() => setView?.(ViewState.ADS)} className="mb-6 text-red-600 font-semibold">{t.backToAds || 'Back to Ads'}</button>
                <div className="grid lg:grid-cols-2 gap-8">
                    <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-white" onTouchStart={handleAdTouchStart} onTouchEnd={handleAdTouchEnd}>
                        {activeMedia.mediaType === 'video' ? (
                            activeAdEmbedUrl ? (
                                <div className="aspect-video w-full">
                                    <iframe
                                        key={`ad-embed-${activeAdMediaKey}`}
                                        src={activeAdEmbedUrl || activeMedia.url}
                                        title={adTitle}
                                        className="h-full w-full pointer-events-none md:pointer-events-auto"
                                        allow="autoplay; fullscreen; picture-in-picture"
                                        allowFullScreen
                                    />
                                </div>
                            ) : (
                                <video
                                    key={`ad-native-${activeAdMediaKey}`}
                                    ref={adMediaVideoRef}
                                    controls
                                    className="w-full max-h-[70vh] bg-black"
                                >
                                    <source key={`ad-native-src-${activeAdMediaKey}`} src={activeMedia.url} />
                                </video>
                            )
                        ) : (
                            <img src={activeMedia.url} alt={adTitle} className="w-full max-h-[70vh] object-cover" />
                        )}

                        {hasMultipleMedia && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => goToAdMedia(activeMediaIndex - 1)}
                                    className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/40 bg-black/45 p-2 text-white hover:bg-black/65"
                                    aria-label={t?.previous || 'Previous'}
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => goToAdMedia(activeMediaIndex + 1)}
                                    className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/40 bg-black/45 p-2 text-white hover:bg-black/65"
                                    aria-label={t?.next || 'Next'}
                                >
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                                <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2">
                                    {safeGallery.map((item, index) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => goToAdMedia(index)}
                                            className={`h-2.5 rounded-full transition-all ${index === activeMediaIndex ? 'w-7 bg-white' : 'w-2.5 bg-white/60 hover:bg-white/85'}`}
                                            aria-label={`${t?.slide || 'Slide'} ${index + 1}`}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="ds-card">
                        <h1 className="text-3xl font-black text-zinc-900 mb-3">{ad.title}</h1>
                        <p className="text-zinc-600 mb-6 whitespace-pre-wrap">{ad.description}</p>
                        <div className="space-y-2 text-sm text-zinc-700">
                            <p><span className="font-semibold">{categoryLabel}:</span> {ad.categoryName || '-'}</p>
                            <p><span className="font-semibold">{locationLabel}:</span> {ad.location || '-'}</p>
                            <p><span className="font-semibold">{priceLabel}:</span> {typeof ad.price === 'number' ? `$${ad.price}` : priceOnRequestLabel}</p>
                            <p><span className="font-semibold">{publishedOnLabel}:</span> {ad.publishDate ? new Date(ad.publishDate).toLocaleDateString() : '-'}</p>
                        </div>
                        <div className="mt-6 border-t border-zinc-100 pt-4 space-y-2 text-sm text-zinc-700">
                            <p className="font-semibold text-zinc-900">{contactInformationLabel}</p>
                            <p>{ad.contactName || '-'}</p>
                            {ad.contactPhone && <p>{ad.contactPhone}</p>}
                            {ad.contactEmail && <p>{ad.contactEmail}</p>}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const CourseCard: React.FC<{ course: Course, onPreview?: () => void, onEnroll?: () => void, onInstructorClick?: () => void, t?: any, darkEnrollButton?: boolean }> = ({ course, onPreview, onEnroll, onInstructorClick, t, darkEnrollButton = false }) => {
    const [showShare, setShowShare] = useState(false);

    const handleShare = (e: React.MouseEvent, platform: string) => {
        e.stopPropagation();
        const url = `${window.location.origin}/courses/${course.id}`;
        const text = `Check out "${course.title}" on Betacademy!`;
        
        let shareUrl = '';
        switch(platform) {
            case 'twitter':
                shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
                break;
            case 'facebook':
                shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
                break;
            case 'linkedin':
                shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
                break;
            case 'copy':
                navigator.clipboard.writeText(url);
                alert(t.linkCopied || 'Link copied to clipboard!');
                setShowShare(false);
                return;
        }
        
        if (shareUrl) {
            window.open(shareUrl, '_blank', 'width=600,height=400');
        }
        setShowShare(false);
    };

    return (
        <TiltCard className="h-full">
            <div 
                className="h-full flex flex-col ds-card overflow-hidden group hover:shadow-2xl transition-shadow duration-300 relative cursor-pointer"
                onClick={() => {
                    setShowShare(false);
                    onPreview && onPreview();
                }}
            >
                <div className="relative h-48 overflow-hidden">
                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors z-10 pointer-events-none"></div>
                    <img 
                        className="h-full w-full object-cover transform group-hover:scale-110 transition-transform duration-700 ease-in-out grayscale group-hover:grayscale-0 transition-all" 
                        src={course.thumbnail} 
                        alt={course.title} 
                    />
                    
                    {/* Share Button */}
                    <div className="absolute top-4 left-4 z-30">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowShare(!showShare); }}
                            className="bg-white/90 backdrop-blur text-zinc-700 p-2 rounded-full shadow-sm hover:bg-white hover:text-red-600 transition-colors"
                            title="Share Course"
                        >
                            <Share2 className="w-4 h-4" />
                        </button>
                        
                        {/* Share Menu */}
                        {showShare && (
                            <div className="absolute top-10 left-0 bg-white rounded-xl shadow-xl border border-zinc-100 p-2 flex flex-col gap-1 min-w-[140px] animate-fade-in-down z-40">
                                <button onClick={(e) => handleShare(e, 'twitter')} className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-[#1da1f2] rounded-lg transition-colors text-left w-full">
                                    <Twitter className="w-4 h-4" /> Twitter
                                </button>
                                <button onClick={(e) => handleShare(e, 'facebook')} className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-[#1877f2] rounded-lg transition-colors text-left w-full">
                                    <Facebook className="w-4 h-4" /> Facebook
                                </button>
                                <button onClick={(e) => handleShare(e, 'linkedin')} className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-[#0077b5] rounded-lg transition-colors text-left w-full">
                                    <Linkedin className="w-4 h-4" /> LinkedIn
                                </button>
                                <div className="h-px bg-zinc-100 my-1"></div>
                                <button onClick={(e) => handleShare(e, 'copy')} className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-green-600 rounded-lg transition-colors text-left w-full">
                                    <LinkIcon className="w-4 h-4" /> Copy Link
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="absolute top-4 right-4 z-20 bg-white/90 backdrop-blur text-red-700 px-3 py-1 rounded-full text-xs font-bold shadow-sm uppercase tracking-wider flex items-center gap-1">
                        <Award className="w-3 h-3" /> {course.level}
                    </div>
                </div>
                
                <div className="flex-1 p-5 flex flex-col relative">
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-zinc-900 mb-2 group-hover:text-red-600 transition-colors line-clamp-2">{course.title}</h3>
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                <div className="flex text-yellow-400">
                                     {[...Array(5)].map((_, i) => <Star key={i} className="w-3 h-3 fill-current" />)}
                                </div>
                                <span className="text-xs text-zinc-400 font-medium">(120 Reviews)</span>
                            </div>
                            {course.duration && (
                                <div className="flex items-center gap-1 text-xs text-zinc-500">
                                    <Clock className="w-3 h-3" />
                                    <span className="font-medium">{course.duration}h</span>
                                </div>
                            )}
                        </div>
                        {/* Instructor Name with Link */}
                        {course.instructor && onInstructorClick && (
                            <div className="mb-2 pb-2 border-b border-zinc-100">
                                <div className="flex items-center gap-2 text-xs">
                                    <UserIcon className="w-3 h-3 text-zinc-400" />
                                    <span className="text-zinc-500">{t?.instructor || 'Instructor'}:</span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); onInstructorClick(); }}
                                        className="font-semibold text-red-600 hover:text-red-700 hover:underline transition-colors"
                                    >
                                        {course.instructor}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="pt-4 border-t border-zinc-100 flex items-center justify-between mt-auto">
                         <span className="text-xl font-black text-zinc-800">${course.price}</span>
                         <button
                            onClick={(e) => { e.stopPropagation(); onEnroll && onEnroll(); }}
                            className={darkEnrollButton
                                ? 'px-4 py-2.5 rounded-xl bg-red-900 text-white font-bold shadow-md transition-colors hover:bg-red-950 flex items-center gap-1'
                                : 'ds-btn ds-btn-secondary flex items-center gap-1'}
                         >
                             {t.enroll || 'Enroll'} <ArrowRight className="w-4 h-4" />
                         </button>
                    </div>
                </div>
            </div>
        </TiltCard>
    );
};

export const CoursesPage: React.FC<PublicProps> = ({ t, setView, user, setSelectedCourse, setSelectedInstructor, onShowRestrictionModal, courses = [], users = [] }) => {
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState<string>('');
    
    const filteredCourses = useMemo(() => {
        let result = courses;
        
        // Filter by category
        if (selectedCategory !== 'All') {
            result = result.filter(course => course.category === selectedCategory);
        }
        
        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(course => 
                course.title.toLowerCase().includes(query) ||
                course.instructor.toLowerCase().includes(query) ||
                (course.category || '').toLowerCase().includes(query)
            );
        }
        
        return result;
    }, [courses, selectedCategory, searchQuery]);
    
    const bestSelling = filteredCourses; 
    const topRated = [...filteredCourses].reverse();
    const newest = filteredCourses.slice(0, 2);

    const handlePreview = (course: Course) => {
        if (setSelectedCourse) setSelectedCourse(course);
        if (setView) setView(ViewState.ENROLLMENT);
    };

    const handleEnroll = (course: Course) => {
        // Check if user is a guest
        if (user?.role === 'GUEST') {
            if (onShowRestrictionModal) {
                onShowRestrictionModal();
            }
            return;
        }
        
        if (user) {
            if (setSelectedCourse) setSelectedCourse(course);
            if (setView) setView(ViewState.ENROLLMENT);
        } else {
            if (setView) setView(ViewState.REGISTER);
        }
    };

    const handleInstructorClick = (course: Course) => {
        const instructor = users.find(u => u.name === course.instructor && u.role === 'INSTRUCTOR');
        if (instructor && setSelectedInstructor && setView) {
            setSelectedInstructor(instructor);
            setView(ViewState.PUBLIC_INSTRUCTOR_PROFILE);
        }
    };

    return (
        <div className="ds-gradient-bg pt-24 pb-16 min-h-screen">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="mb-10">
                    <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-red-950 via-red-900 to-red-800 px-6 py-12 text-center shadow-2xl sm:px-10 lg:py-14">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.09),transparent_40%)]"></div>
                        <div className="relative z-10 max-w-5xl mx-auto">
                            <h1 className="mb-4 text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">{t.exploreCourses}</h1>
                            <p className="mx-auto max-w-3xl text-sm leading-relaxed text-red-100 sm:text-base lg:text-lg">{t.exploreCoursesDesc}</p>
                        </div>
                    </div>
                </div>

                {/* Filters Section */}
                <div className="mb-12 flex flex-col md:flex-row gap-4">
                    <div className="flex-1">
                        <input
                            type="text"
                            placeholder={t.searchCourses || 'Search by course name, instructor, or category...'}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-full border border-red-100 bg-white px-7 py-5 text-lg shadow-xl focus:outline-none focus:ring-2 focus:ring-red-700"
                        />
                    </div>
                    <div className="md:w-64">
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-full rounded-full border border-red-100 bg-white px-7 py-5 text-base shadow-xl focus:outline-none focus:ring-2 focus:ring-red-700"
                        >
                            <option value="All">{t.allCategories || 'All Categories'}</option>
                            <option value="Technology">{t.lang === 'ar' ? 'التكنولوجيا' : 'Technology'}</option>
                            <option value="Business">{t.lang === 'ar' ? 'الأعمال' : 'Business'}</option>
                            <option value="Finance">{t.lang === 'ar' ? 'المالية' : 'Finance'}</option>
                            <option value="Marketing">{t.lang === 'ar' ? 'التسويق' : 'Marketing'}</option>
                            <option value="Design">{t.lang === 'ar' ? 'التصميم' : 'Design'}</option>
                            <option value="Languages">{t.lang === 'ar' ? 'اللغات' : 'Languages'}</option>
                            <option value="Personal Development">{t.lang === 'ar' ? 'التطوير الشخصي' : 'Personal Development'}</option>
                            <option value="Health & Fitness">{t.lang === 'ar' ? 'الصحة واللياقة' : 'Health & Fitness'}</option>
                            <option value="Academics">{t.lang === 'ar' ? 'الأكاديميات' : 'Academics'}</option>
                            <option value="Professional Skills">{t.lang === 'ar' ? 'المهارات المهنية' : 'Professional Skills'}</option>
                        </select>
                    </div>
                </div>

                <div className="space-y-16">
                    {/* Best Selling Section */}
                    <section>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="ds-icon-container ds-icon-red"><Zap className="w-6 h-6" /></div>
                            <h2 className="ds-section-title">{t.bestSelling}</h2>
                        </div>
                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                            {bestSelling.map((course, idx) => (
                                <ScrollReveal key={`bs-${course.id}`} delay={`${idx * 100}ms`}>
                                    <CourseCard course={course} onPreview={() => handlePreview(course)} onEnroll={() => handleEnroll(course)} onInstructorClick={() => handleInstructorClick(course)} t={t} darkEnrollButton />
                                </ScrollReveal>
                            ))}
                        </div>
                    </section>

                    {/* Top Rated Section */}
                    <section>
                         <div className="flex items-center gap-3 mb-8">
                            <div className="ds-icon-container ds-icon-yellow"><Star className="w-6 h-6" /></div>
                            <h2 className="ds-section-title">{t.topRated}</h2>
                        </div>
                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                            {topRated.map((course, idx) => (
                                <ScrollReveal key={`tr-${course.id}`} delay={`${idx * 100}ms`}>
                                    <CourseCard course={course} onPreview={() => handlePreview(course)} onEnroll={() => handleEnroll(course)} onInstructorClick={() => handleInstructorClick(course)} t={t} darkEnrollButton />
                                </ScrollReveal>
                            ))}
                        </div>
                    </section>

                    {/* Newest Section */}
                    <section>
                         <div className="flex items-center gap-3 mb-8">
                            <div className="ds-icon-container ds-icon-blue"><Sparkles className="w-6 h-6" /></div>
                            <h2 className="ds-section-title">{t.newest}</h2>
                        </div>
                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                            {newest.map((course, idx) => (
                                <ScrollReveal key={`nw-${course.id}`} delay={`${idx * 100}ms`}>
                                    <CourseCard course={course} onPreview={() => handlePreview(course)} onEnroll={() => handleEnroll(course)} onInstructorClick={() => handleInstructorClick(course)} t={t} darkEnrollButton />
                                </ScrollReveal>
                            ))}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
};

export const EnrollmentPage: React.FC<PublicProps> = ({ t, course, onConfirmEnroll, paymentGatewayConfig, setView, setSelectedInstructor, users = [], user, tenantId, tenantSlug }) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [cardHolder, setCardHolder] = useState('');
    const [cardNumber, setCardNumber] = useState('');
    const [expiry, setExpiry] = useState('');
    const [cvc, setCvc] = useState('');
    const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
    
    const enabledGateways = useMemo(() => {
        const entries: Array<{ key: 'visa' | 'paypal' | 'stripe'; label: string }> = [];
        if (paymentGatewayConfig?.visaEnabled) entries.push({ key: 'visa', label: t.visaGatewayLabel || 'Visa Card' });
        if (paymentGatewayConfig?.paypalEnabled) entries.push({ key: 'paypal', label: t.paypalGatewayLabel || 'PayPal' });
        if (paymentGatewayConfig?.stripeEnabled) entries.push({ key: 'stripe', label: t.stripeGatewayLabel || 'Stripe' });
        return entries;
    }, [paymentGatewayConfig, t]);
    const [selectedGateway, setSelectedGateway] = useState<'visa' | 'paypal' | 'stripe' | ''>(() => enabledGateways[0]?.key || '');
    const [error, setError] = useState<string | null>(null);

    const isStripeGateway = selectedGateway === 'stripe';
    const isFreeCourse = (course?.price ?? 0) <= 0;

    useEffect(() => {
        if (!enabledGateways.find((entry) => entry.key === selectedGateway)) {
            setSelectedGateway(enabledGateways[0]?.key || '');
        }
    }, [enabledGateways, selectedGateway]);

    useEffect(() => {
        if (isStripeGateway) {
            setValidationErrors({});
        }
    }, [isStripeGateway]);

    const handleExpiryChange = (value: string) => {
        // Remove non-numeric characters except slash
        let cleaned = value.replace(/[^\d]/g, '');
        
        // Auto-format as MM/YY
        if (cleaned.length >= 2) {
            cleaned = cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4);
        }
        
        setExpiry(cleaned);
        
        // Clear expiry validation error when user types
        if (validationErrors.expiry) {
            setValidationErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors.expiry;
                return newErrors;
            });
        }
    };

    const validateExpiryDate = (expiryValue: string): string | null => {
        const expiryPattern = /^(0[1-9]|1[0-2])\/\d{2}$/;
        
        if (!expiryValue) {
            return t.expiryRequired || 'Expiry date is required';
        }
        
        if (!expiryPattern.test(expiryValue)) {
            return t.invalidExpiryFormat || 'Please enter a valid expiry date (MM/YY)';
        }
        
        const [month] = expiryValue.split('/');
        const monthNum = parseInt(month, 10);
        
        if (monthNum < 1 || monthNum > 12) {
            return t.invalidMonth || 'Month must be between 01-12';
        }
        
        return null;
    };

    const validateForm = (): boolean => {
        const errors: Record<string, string> = {};
        
        if (!cardHolder.trim()) {
            errors.cardHolder = t.cardHolderRequired || 'Cardholder name is required';
        }
        
        if (!cardNumber.trim()) {
            errors.cardNumber = t.cardNumberRequired || 'Card number is required';
        }
        
        const expiryError = validateExpiryDate(expiry);
        if (expiryError) {
            errors.expiry = expiryError;
        }
        
        if (!cvc.trim()) {
            errors.cvc = t.cvcRequired || 'CVC is required';
        }
        
        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handlePayment = async () => {
        if (!course) return;
        if (isFreeCourse) {
            setError(null);
            setIsProcessing(true);
            try {
                if (!user?.id) {
                    throw new Error(t.signInTitle || 'Please sign in to continue');
                }
                const result = await onConfirmEnroll?.();
                if (result === false) {
                    setIsProcessing(false);
                    return;
                }
                setIsSuccess(true);
                setTimeout(() => {
                    setView?.(ViewState.DASHBOARD);
                }, 1500);
            } catch (err) {
                setError(err instanceof Error ? err.message : t.courseEnrollmentFailed || 'Failed to enroll in course');
            } finally {
                setIsProcessing(false);
            }
            return;
        }
        if (!selectedGateway) {
            setError(t.selectPaymentGateway || 'Select a payment gateway');
            return;
        }
        
        setError(null);
        setIsProcessing(true);
        try {
            if (isStripeGateway) {
                if (!paymentGatewayConfig?.stripeEnabled) {
                    throw new Error(t.paymentFailed || 'Stripe payment gateway is not enabled');
                }
                if (!tenantId || !tenantSlug) {
                    throw new Error(t.paymentFailed || 'Tenant information is missing');
                }
                if (!user?.id || !user?.email) {
                    throw new Error(t.signInTitle || 'Please sign in to continue');
                }

                const response = await fetch('/api/course-payment/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tenantId,
                        tenantSlug,
                        courseId: course.id,
                        studentId: user.id,
                        studentEmail: user.email,
                        courseName: course.title,
                        coursePrice: course.price
                    })
                });
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload?.message || payload?.error || t.paymentFailed || 'Unable to process payment');
                }
                if (!payload?.checkoutUrl) {
                    throw new Error(t.paymentFailed || 'Unable to start Stripe checkout');
                }
                window.location.href = payload.checkoutUrl;
                return;
            }

            // Validate form for non-Stripe gateways (mock flow)
            if (!validateForm()) {
                setError(t.pleaseFillRequired || 'Please fill in all required fields correctly');
                return;
            }

            const response = await fetch('/api/payments/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gateway: selectedGateway,
                    amount: course.price,
                    courseId: course.id
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || t.paymentFailed || 'Unable to process payment');
            }
            console.log('Payment authorized', payload);
            const result = await onConfirmEnroll?.();
            if (result === false) {
                throw new Error(t.courseEnrollmentFailed || 'Failed to enroll in course');
            }
            setIsSuccess(true);
            setTimeout(() => {
                setView?.(ViewState.DASHBOARD);
            }, 1500);
        } catch (err) {
            setError(err instanceof Error ? err.message : t.paymentFailed || 'Unable to process payment');
        } finally {
            setIsProcessing(false);
        }
    };

    if (!course) return null;

    if (isSuccess) {
        return (
             <div className="min-h-screen ds-gradient-bg flex items-center justify-center p-4">
                 <div className="ds-card max-w-md w-full text-center animate-fade-in-down">
                     <div className="ds-icon-container ds-icon-green mx-auto mb-6">
                         <CheckCircle className="h-10 w-10" />
                     </div>
                     <h2 className="ds-section-title mb-2">{t.enrollmentSuccess}</h2>
                     <p className="ds-description mb-6">{t.welcomeToCourse}</p>
                     <div className="w-full bg-zinc-100 rounded-full h-2 mb-6 overflow-hidden">
                         <div className="h-full bg-green-500 animate-pulse w-full"></div>
                     </div>
                     <p className="text-xs text-zinc-400">{t.redirectingToDashboard || 'Redirecting to dashboard...'}</p>
                 </div>
             </div>
        );
    }

    return (
        <div className="min-h-screen ds-gradient-bg py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
                <div className="mb-8">
                    <h1 className="ds-page-title">{t.enrollmentPage}</h1>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Course Summary - Right/Top on mobile */}
                    <div className="lg:col-span-1 order-1 lg:order-2">
                        <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-zinc-200 sticky top-24">
                            <img src={course.thumbnail} className="w-full h-48 object-cover" alt={course.title} />
                            <div className="p-6">
                                <span className="text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded uppercase tracking-wide">{t.orderSummary}</span>
                                <h3 className="mt-4 text-xl font-bold text-zinc-900 leading-tight mb-2">{course.title}</h3>
                                <p className="text-sm text-zinc-500 mb-4 line-clamp-2">{course.description}</p>
                                
                                {/* Instructor Name */}
                                {course.instructor && (
                                    <div className="mb-4 pb-4 border-b border-zinc-100">
                                        <div className="flex items-center gap-2 text-sm text-zinc-600">
                                            <UserIcon className="w-4 h-4" />
                                            <span className="text-zinc-500">{t.instructor || 'Instructor'}:</span>
                                            <button
                                                onClick={() => {
                                                    const instructor = users.find(u => u.name === course.instructor && u.role === 'INSTRUCTOR');
                                                    if (instructor && setSelectedInstructor && setView) {
                                                        setSelectedInstructor(instructor);
                                                        setView(ViewState.PUBLIC_INSTRUCTOR_PROFILE);
                                                    }
                                                }}
                                                className="font-semibold text-red-600 hover:text-red-700 hover:underline transition-colors"
                                            >
                                                {course.instructor}
                                            </button>
                                        </div>
                                    </div>
                                )}
                                
                                {course.duration && (
                                    <div className="flex items-center gap-2 text-sm text-zinc-600 mb-6 pb-4 border-b border-zinc-100">
                                        <Clock className="w-4 h-4" />
                                        <span><span className="font-semibold">{course.duration}</span> {t.hoursOfContent || 'hours of content'}</span>
                                    </div>
                                )}
                                
                                {/* Show discount breakdown if applicable */}
                                {course.originalPrice && course.originalPrice > course.price ? (
                                    <>
                                        <div className="border-t border-zinc-100 pt-4 flex justify-between items-center mb-2">
                                            <span className="text-zinc-600">{t.originalPrice || 'Original Price'}</span>
                                            <span className="font-medium text-zinc-400 line-through">${course.originalPrice}</span>
                                        </div>
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-zinc-600">
                                                {t.discount || 'Discount'}
                                                {course.discountCode && (
                                                    <span className="ml-1 text-xs text-green-600 font-semibold">({course.discountCode})</span>
                                                )}
                                                {course.discountPercentage && (
                                                    <span className="ml-1 text-xs text-green-600 font-semibold">({course.discountPercentage}%)</span>
                                                )}
                                            </span>
                                            <span className="font-medium text-green-600">-${(course.originalPrice - course.price).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-zinc-100">
                                            <span className="text-zinc-600">{t.subtotal || 'Subtotal'}</span>
                                            <span className="font-medium">${course.price}</span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="border-t border-zinc-100 pt-4 flex justify-between items-center mb-2">
                                        <span className="text-zinc-600">{t.subtotal || 'Subtotal'}</span>
                                        <span className="font-medium">${course.price}</span>
                                    </div>
                                )}
                                
                                <div className="flex justify-between items-center mb-6">
                                    <span className="text-zinc-600">{t.tax || 'Tax'} (0%)</span>
                                    <span className="font-medium">$0.00</span>
                                </div>
                                <div className="border-t border-zinc-100 pt-4 flex justify-between items-center">
                                    <span className="text-lg font-bold text-zinc-900">{t.totalDue}</span>
                                    <span className="text-2xl font-black text-red-600">${course.price}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Payment Form - Left/Bottom on mobile */}
                    <div className="lg:col-span-2 order-2 lg:order-1">
                        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-8">
                            {isFreeCourse ? (
                                <>
                                    {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
                                    <div className="space-y-6">
                                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                                            {t.freeEnrollmentNotice || 'This course is free. Click below to enroll instantly.'}
                                        </div>
                                        <button 
                                            onClick={handlePayment}
                                            disabled={isProcessing}
                                            className="ds-btn ds-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isProcessing ? (
                                                <>
                                                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    {t.processing}
                                                </>
                                            ) : (
                                                <>
                                                    {t.enrollForFree || t.enroll} <ArrowRight className="h-5 w-5 rtl:rotate-180" />
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex flex-col gap-3 mb-6 pb-6 border-b border-zinc-100">
                                        <div className="flex items-center gap-3">
                                            <Lock className="h-5 w-5 text-green-600" />
                                            <span className="text-sm font-medium text-green-700">{t.paymentSecure}</span>
                                        </div>
                                        {enabledGateways.length ? (
                                            <div className="flex flex-wrap gap-2">
                                                {enabledGateways.map((gateway) => (
                                                    <button
                                                        key={gateway.key}
                                                        onClick={() => setSelectedGateway(gateway.key)}
                                                        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${selectedGateway === gateway.key ? 'bg-red-900 text-white border-red-600' : 'border-zinc-200 text-zinc-600 hover:border-red-200'}`}
                                                    >
                                                        {gateway.label}
                                                    </button>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-zinc-500">{t.noPaymentGateways || 'Payments unavailable right now. Please contact support.'}</p>
                                        )}
                                    </div>
                                    {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

                                    <div className="space-y-6">
                                        {isStripeGateway ? (
                                            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                                                {t.paymentSecure || 'Payments are secure and encrypted'} — {t.completePurchase || 'Complete Purchase'} will redirect you to Stripe.
                                            </div>
                                        ) : (
                                            <>
                                                <div>
                                                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                                                        {t.cardHolder} <span className="text-red-600">*</span>
                                                    </label>
                                                    <input 
                                                        type="text" 
                                                        value={cardHolder}
                                                        onChange={(e) => {
                                                            setCardHolder(e.target.value);
                                                            if (validationErrors.cardHolder) {
                                                                setValidationErrors(prev => {
                                                                    const newErrors = { ...prev };
                                                                    delete newErrors.cardHolder;
                                                                    return newErrors;
                                                                });
                                                            }
                                                        }}
                                                        className={`w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-500 focus:outline-none ${validationErrors.cardHolder ? 'border-red-500' : 'border-zinc-300'}`}
                                                        placeholder="John Doe" 
                                                    />
                                                    {validationErrors.cardHolder && (
                                                        <p className="text-sm text-red-600 mt-1">{validationErrors.cardHolder}</p>
                                                    )}
                                                </div>
                                                
                                                <div>
                                                    <label className="block text-sm font-medium text-zinc-700 mb-1">
                                                        {t.cardNumber} <span className="text-red-600">*</span>
                                                    </label>
                                                    <div className="relative">
                                                        <input 
                                                            type="text" 
                                                            value={cardNumber}
                                                            onChange={(e) => {
                                                                setCardNumber(e.target.value);
                                                                if (validationErrors.cardNumber) {
                                                                    setValidationErrors(prev => {
                                                                        const newErrors = { ...prev };
                                                                        delete newErrors.cardNumber;
                                                                        return newErrors;
                                                                    });
                                                                }
                                                            }}
                                                            className={`w-full border rounded-lg p-3 pl-10 focus:ring-2 focus:ring-red-500 focus:outline-none ${validationErrors.cardNumber ? 'border-red-500' : 'border-zinc-300'}`}
                                                            placeholder="0000 0000 0000 0000" 
                                                        />
                                                        <CreditCard className="absolute left-3 top-3.5 h-5 w-5 text-zinc-400" />
                                                    </div>
                                                    {validationErrors.cardNumber && (
                                                        <p className="text-sm text-red-600 mt-1">{validationErrors.cardNumber}</p>
                                                    )}
                                                </div>

                                                <div className="grid grid-cols-2 gap-6">
                                                    <div>
                                                        <label className="block text-sm font-medium text-zinc-700 mb-1">
                                                            {t.expiry} <span className="text-red-600">*</span>
                                                        </label>
                                                        <input 
                                                            type="text" 
                                                            value={expiry}
                                                            onChange={(e) => handleExpiryChange(e.target.value)}
                                                            maxLength={5}
                                                            className={`w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-500 focus:outline-none ${validationErrors.expiry ? 'border-red-500' : 'border-zinc-300'}`}
                                                            placeholder="MM/YY" 
                                                        />
                                                        {validationErrors.expiry && (
                                                            <p className="text-sm text-red-600 mt-1">{validationErrors.expiry}</p>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label className="block text-sm font-medium text-zinc-700 mb-1">
                                                            {t.cvc} <span className="text-red-600">*</span>
                                                        </label>
                                                        <input 
                                                            type="text" 
                                                            value={cvc}
                                                            onChange={(e) => {
                                                                const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                                                                setCvc(value);
                                                                if (validationErrors.cvc) {
                                                                    setValidationErrors(prev => {
                                                                        const newErrors = { ...prev };
                                                                        delete newErrors.cvc;
                                                                        return newErrors;
                                                                    });
                                                                }
                                                            }}
                                                            maxLength={4}
                                                            className={`w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-500 focus:outline-none ${validationErrors.cvc ? 'border-red-500' : 'border-zinc-300'}`}
                                                            placeholder="123" 
                                                        />
                                                        {validationErrors.cvc && (
                                                            <p className="text-sm text-red-600 mt-1">{validationErrors.cvc}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        <button 
                                            onClick={handlePayment}
                                            disabled={isProcessing || (!isFreeCourse && !enabledGateways.length)}
                                            className="ds-btn ds-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {isProcessing ? (
                                                <>
                                                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                    {t.processing}
                                                </>
                                            ) : (
                                                <>
                                                    {t.completePurchase} <ArrowRight className="h-5 w-5 rtl:rotate-180" />
                                                </>
                                            )}
                                        </button>
                                        
                                        <div className="text-center text-xs text-zinc-400 mt-4">
                                            {t.termsAgree || 'By clicking complete purchase, you agree to our Terms of Service.'}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const ServicesPage: React.FC<PublicProps> = ({ t, pageContent, branding }) => {
    const structuredContent = useMemo(
        () => parseServicesPageContent(pageContent?.content),
        [pageContent?.content]
    );
    const sectionLabel = structuredContent.sectionLabel?.trim() || t.ourServices || 'Our Services';
    const sectionHeading = structuredContent.sectionHeading?.trim() || t.servicesSubtitle || 'Where innovation meets learning';
    const palette = useMemo(() => resolvePalette(branding), [branding]);
    const resolvedCards = useMemo(() => {
        return SERVICES.map((service, index) => {
            const entry = structuredContent.cards[index];
            const title = (entry?.title || '').trim() || service.title;
            const description = (entry?.description || '').trim() || service.desc;
            return { title, description };
        });
    }, [structuredContent]);

    return (
        <div className="py-24 ds-gradient-bg relative">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <ScrollReveal className="text-center mb-20">
                    <h2 className="font-bold tracking-wide uppercase text-sm mb-2" style={{ color: palette.primary }}>{sectionLabel}</h2>
                    <h3 className="ds-section-title mb-4">{sectionHeading}</h3>
                </ScrollReveal>
                
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
                    {resolvedCards.map((card, i) => (
                        <ScrollReveal key={i} delay={`${i * 100}ms`}>
                            <div className="ds-card h-full group hover:-translate-y-2 transition-all duration-300">
                                <div className="absolute inset-0 bg-gradient-to-br from-red-50 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                                <div className="relative z-10 text-start">
                                    <div className="inline-flex items-center justify-center p-4 text-white rounded-2xl shadow-lg mb-6 group-hover:scale-110 transition-transform duration-300" style={{ backgroundColor: palette.primary, boxShadow: `0 20px 35px ${hexToRgba(palette.primary, 0.25)}` }}>
                                        <Star className="h-6 w-6" />
                                    </div>
                                    <h3 className="ds-section-subtitle mb-3">{card.title}</h3>
                                    <p className="ds-description">{card.description}</p>
                                </div>
                            </div>
                        </ScrollReveal>
                    ))}
                </div>
            </div>
        </div>
    );
};

const normalizePricingPlans = (pricing?: TenantPricingConfig | null): TenantPricingPlan[] => {
    if (!pricing?.plans?.length) {
        return [];
    }
    return pricing.plans.map((plan, index) => {
        const features = (plan.features || []).map((feature) => feature?.trim()).filter(Boolean) as string[];
        return {
            ...plan,
            id: plan.id || `plan-${index + 1}`,
            title: pickCopy(plan.title, `Plan ${index + 1}`),
            price: pickCopy(plan.price, 'Contact us'),
            description: pickCopy(plan.description),
            highlight: Boolean(plan.highlight),
            features
        };
    }).filter((plan) => plan.title.trim().length > 0);
};

export const PricingPage: React.FC<PublicProps> = ({ t, pageContent, pricing, branding, setView }) => {
    const palette = useMemo(() => resolvePalette(branding), [branding]);
    const plans = useMemo(() => normalizePricingPlans(pricing), [pricing]);
    const headline = pickCopy(pricing?.headline, t.pricingTitle || t.pricing || 'Plans for every stage');
    const subheading = pickCopy(pricing?.subheading, t.pricingSubtitle || t.popularPrograms || 'Flexible options for every cohort size.');
    const planCtaLabel = pickCopy(pricing?.ctaLabel, pickCopy(branding?.pricingCtaLabel, t.pricingCta || t.getStarted || 'Get started'));

    if (!plans.length) {
        return (
            <StaticPageContentView
                t={t}
                pageContent={pageContent}
                fallbackTitle={t?.pricing || 'Pricing'}
                accentLabel={t?.pricing || 'Pricing'}
            />
        );
    }

    return (
        <div className="py-24 ds-gradient-bg">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                <ScrollReveal className="text-center mb-16">
                    <p className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: palette.primary }}>
                        {t.pricingLabel || t.pricing || 'Pricing'}
                    </p>
                    <h2 className="ds-page-title mb-4">{headline}</h2>
                    {subheading && <p className="ds-description max-w-2xl mx-auto">{subheading}</p>}
                </ScrollReveal>

                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                    {plans.map((plan, index) => {
                        const shadowColor = hexToRgba(palette.primary, plan.highlight ? 0.3 : 0.15);
                        return (
                            <ScrollReveal key={plan.id} delay={`${index * 120}ms`}>
                                <div
                                    className={`h-full rounded-3xl border bg-white p-8 flex flex-col shadow-xl ${plan.highlight ? 'scale-[1.01]' : ''}`}
                                    style={{
                                        borderColor: plan.highlight ? palette.primary : '#e4e4e7',
                                        boxShadow: `0 25px 55px ${shadowColor}`
                                    }}
                                >
                                    {plan.highlight && (
                                        <span className="text-xs font-semibold uppercase tracking-widest mb-4 inline-flex self-start px-3 py-1 rounded-full text-white"
                                            style={{ backgroundColor: palette.primary }}>
                                            {t.mostPopular || 'Most popular'}
                                        </span>
                                    )}
                                    <div className="mb-6">
                                        <h3 className="text-2xl font-black text-zinc-900 mb-2">{plan.title}</h3>
                                        <p className="text-4xl font-black text-zinc-900">{plan.price}</p>
                                        {plan.description && <p className="text-sm text-zinc-500 mt-2">{plan.description}</p>}
                                    </div>
                                    <ul className="space-y-3 text-sm text-zinc-600 flex-1">
                                        {plan.features.map((feature, featureIdx) => (
                                            <li key={featureIdx} className="flex items-center gap-3">
                                                <CheckCircle className="h-4 w-4" style={{ color: palette.primary }} />
                                                <span>{feature}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        onClick={() => setView?.(ViewState.REGISTER)}
                                        className="mt-8 w-full rounded-full py-3 font-semibold text-sm transition-transform hover:translate-y-[-2px]"
                                        style={{
                                            backgroundColor: plan.highlight ? palette.primary : 'transparent',
                                            color: plan.highlight ? '#fff' : palette.primary,
                                            border: plan.highlight ? 'none' : `1px solid ${palette.primary}`
                                        }}
                                    >
                                        {planCtaLabel}
                                    </button>
                                </div>
                            </ScrollReveal>
                        );
                    })}
                </div>

                <div className="mt-16 text-center">
                    <button
                        onClick={() => setView?.(ViewState.REGISTER)}
                        className="inline-flex items-center gap-2 rounded-full px-8 py-3 font-semibold text-white"
                        style={{ backgroundColor: palette.primary, boxShadow: `0 25px 55px ${hexToRgba(palette.primary, 0.35)}` }}
                    >
                        {planCtaLabel} <ArrowRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export const BlogPage: React.FC<PublicProps> = ({ t, blogPosts, setView, setSelectedBlogPost }) => {
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState<string>('');
    const blogSubtitle = t?.latestBlogDescription || (t?.lang === 'ar'
        ? 'اكتشف أحدث المقالات، النصائح، والرؤى التعليمية من خبرائنا.'
        : 'Discover the latest articles, educational tips, and insights from our experts.');
    
    const posts = useMemo(() => {
        let result = (blogPosts || []).filter(p => p.status === 'PUBLISHED' || !p.status);
        
        // Filter by category
        if (selectedCategory !== 'All') {
            result = result.filter(post => post.category === selectedCategory);
        }
        
        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(post => 
                post.title.toLowerCase().includes(query) ||
                post.author.toLowerCase().includes(query) ||
                (post.category || '').toLowerCase().includes(query)
            );
        }
        
        return result;
    }, [blogPosts, selectedCategory, searchQuery]);

    const handlePostClick = (postId: string) => {
        const post = (blogPosts || []).find(p => p.id === postId);
        if (post && setSelectedBlogPost && setView) {
            setSelectedBlogPost(post);
            setView(ViewState.BLOG_POST);
        }
    };

    return (
        <>
            <div className="ds-gradient-bg pt-24 pb-16">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="mb-10">
                        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-r from-red-950 via-red-900 to-red-800 px-6 py-12 text-center shadow-2xl sm:px-10 lg:py-14">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14),transparent_45%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.09),transparent_40%)]"></div>
                            <div className="relative z-10 max-w-5xl mx-auto">
                                <h1 className="mb-4 text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">{t.latestBlog}</h1>
                                <p className="mx-auto max-w-3xl text-sm leading-relaxed text-red-100 sm:text-base lg:text-lg">{blogSubtitle}</p>
                            </div>
                        </div>
                    </div>

                    {/* Filters Section */}
                    <div className="mb-12 flex flex-col md:flex-row gap-4">
                        <div className="flex-1">
                            <input
                                type="text"
                                placeholder={t.searchBlogs || 'Search by post name, author, or category...'}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-full border border-red-100 bg-white px-7 py-5 text-lg shadow-xl focus:outline-none focus:ring-2 focus:ring-red-700"
                            />
                        </div>
                        <div className="md:w-64">
                            <select
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                className="w-full rounded-full border border-red-100 bg-white px-7 py-5 text-base shadow-xl focus:outline-none focus:ring-2 focus:ring-red-700"
                            >
                                <option value="All">{t.allCategories || 'All Categories'}</option>
                                <option value="Technology">{t.lang === 'ar' ? 'التكنولوجيا' : 'Technology'}</option>
                                <option value="Business">{t.lang === 'ar' ? 'الأعمال' : 'Business'}</option>
                                <option value="Finance">{t.lang === 'ar' ? 'المالية' : 'Finance'}</option>
                                <option value="Marketing">{t.lang === 'ar' ? 'التسويق' : 'Marketing'}</option>
                                <option value="Design">{t.lang === 'ar' ? 'التصميم' : 'Design'}</option>
                                <option value="Languages">{t.lang === 'ar' ? 'اللغات' : 'Languages'}</option>
                                <option value="Personal Development">{t.lang === 'ar' ? 'التطوير الشخصي' : 'Personal Development'}</option>
                                <option value="Health & Fitness">{t.lang === 'ar' ? 'الصحة واللياقة' : 'Health & Fitness'}</option>
                                <option value="Academics">{t.lang === 'ar' ? 'الأكاديميات' : 'Academics'}</option>
                                <option value="Professional Skills">{t.lang === 'ar' ? 'المهارات المهنية' : 'Professional Skills'}</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid gap-10 lg:grid-cols-3">
                        {posts.map((post, i) => (
                            <ScrollReveal key={post.id} delay={`${i * 150}ms`}>
                                <div className="ds-card h-full flex flex-col overflow-hidden group hover:shadow-2xl transition-all duration-300">
                                    <div className="h-48 overflow-hidden relative">
                                        <img src={post.image} alt={post.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 grayscale group-hover:grayscale-0" />
                                        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-red-600 uppercase">
                                            Article
                                        </div>
                                    </div>
                                    <div className="p-6 flex-1 flex flex-col">
                                        <h3 className="text-xl font-bold text-zinc-900 mb-3 group-hover:text-red-600 transition-colors">{post.title}</h3>
                                        <p className="text-zinc-500 mb-6 flex-1">{post.excerpt}</p>
                                        <div className="flex items-center justify-between mt-auto pt-6 border-t border-zinc-100">
                                            <div className="flex items-center">
                                                <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center font-bold text-red-600 text-xs">
                                                    {post.author[0]}
                                                </div>
                                                <div className="ml-3">
                                                    <p className="text-xs font-bold text-zinc-900">{post.author}</p>
                                                    <p className="text-xs text-zinc-500">{post.date}</p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => handlePostClick(post.id)}
                                                className="text-red-600 hover:text-red-800 transition-colors hover:scale-110 transform"
                                                aria-label={`Read ${post.title}`}
                                            >
                                                <ArrowRight className="w-5 h-5" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </ScrollReveal>
                        ))}
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>
        </>
    );
};

export const BlogPostPage: React.FC<PublicProps> = ({ t, selectedBlogPost, setView, setSelectedBlogPost }) => {
    const post = selectedBlogPost;

    const handleBack = () => {
        if (setSelectedBlogPost) {
            setSelectedBlogPost(null);
        }
        if (setView) {
            setView(ViewState.BLOG);
        }
    };

    const renderedContent = useMemo(() => 
        post ? DOMPurify.sanitize(post.content, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'div'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'style']
        }) : '', 
        [post]
    );

    if (!post) {
        return (
            <div className="min-h-screen ds-gradient-bg flex items-center justify-center">
                <div className="text-center">
                    <h1 className="ds-page-title mb-4">{t?.postNotFound || 'Post Not Found'}</h1>
                    <button
                        onClick={handleBack}
                        className="text-red-600 hover:text-red-800 font-semibold"
                    >
                        ← {t?.backToBlog || 'Back to Blog'}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="ds-gradient-bg min-h-screen">
            {/* Header Image */}
            <div className="relative h-96 overflow-hidden">
                <img 
                    src={post.uploadedImagePath || post.image} 
                    alt={post.title} 
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                <div className="absolute bottom-0 left-0 right-0 p-8 max-w-4xl mx-auto">
                    <button
                        onClick={handleBack}
                        className="mb-4 text-white/90 hover:text-white font-semibold flex items-center gap-2 transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" /> {t?.backToBlog || 'Back to Blog'}
                    </button>
                    <div className="bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-red-600 uppercase inline-block mb-3">
                        {post.category || 'Article'}
                    </div>
                    <h1 className="ds-page-title mb-4">{post.title}</h1>
                    <div className="flex items-center gap-3 text-white/90">
                        <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center font-bold">
                            {post.author[0]}
                        </div>
                        <div>
                            <p className="text-sm font-bold">{post.author}</p>
                            <p className="text-xs opacity-80">{post.date}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-4xl mx-auto px-4 py-12">
                {/* Uploaded Video */}
                {post.uploadedVideoPath && (
                    <div className="mb-8">
                        <video controls className="w-full rounded-xl shadow-lg">
                            <source src={post.uploadedVideoPath} type="video/mp4" />
                            Your browser does not support the video tag.
                        </video>
                    </div>
                )}

                {/* Embedded Video (YouTube, etc.) */}
                {post.videoUrl && !post.uploadedVideoPath && (
                    <div className="mb-8 aspect-video">
                        <iframe
                            src={post.videoUrl}
                            className="w-full h-full rounded-xl shadow-lg"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        ></iframe>
                    </div>
                )}

                {/* Excerpt */}
                {post.excerpt && (
                    <div className="mb-8 p-6 bg-zinc-50 rounded-xl border-l-4 border-red-600">
                        <p className="text-lg text-zinc-700 italic">{post.excerpt}</p>
                    </div>
                )}

                {/* Article Content */}
                <div 
                    className="cms-content prose prose-lg max-w-none text-zinc-700"
                    dangerouslySetInnerHTML={{ __html: renderedContent }}
                />

                {/* Back Button */}
                <div className="mt-12 pt-8 border-t border-zinc-200">
                    <button
                        onClick={handleBack}
                        className="inline-flex items-center gap-2 text-red-600 hover:text-red-800 font-semibold transition-colors"
                    >
                        <ArrowLeft className="w-4 h-4" /> {t?.backToBlog || 'Back to Blog'}
                    </button>
                </div>
            </div>

            <style>{`
                .cms-content h1,
                .cms-content h2,
                .cms-content h3,
                .cms-content h4 {
                    margin-top: 1.5rem;
                    margin-bottom: 0.75rem;
                    font-weight: 700;
                    color: #18181b;
                }
                .cms-content p {
                    margin-bottom: 1rem;
                    line-height: 1.75;
                }
                .cms-content ul,
                .cms-content ol {
                    margin: 1rem 0;
                    padding-left: 1.5rem;
                }
                .cms-content li {
                    margin: 0.5rem 0;
                }
                .cms-content a {
                    color: #dc2626;
                    text-decoration: underline;
                }
                .cms-content strong {
                    font-weight: 700;
                }
            `}</style>
        </div>
    );
};

export const TermsOfService: React.FC<PublicProps> = ({ t, pageContent }) => (
    <StaticPageContentView
        t={t}
        pageContent={pageContent}
        fallbackTitle={t?.tos || 'Terms of Service'}
        accentLabel={t?.legal || 'Legal'}
    />
);

export const PrivacyPolicyPage: React.FC<PublicProps> = ({ t, pageContent }) => (
    <StaticPageContentView
        t={t}
        pageContent={pageContent}
        fallbackTitle={t?.privacyPolicy || 'Privacy Policy'}
        accentLabel={t?.legal || 'Legal'}
    />
);

export const AboutUsPage: React.FC<PublicProps> = ({ t, pageContent }) => (
    <StaticPageContentView
        t={t}
        pageContent={pageContent}
        fallbackTitle={t?.whoWeAre || 'About Us'}
        accentLabel={t?.academy || 'Academy'}
    />
);

export const CareerPage: React.FC<PublicProps> = ({ t, pageContent }) => {
    const [activeJob, setActiveJob] = useState<CareerJob | null>(null);
    const [showApplicationModal, setShowApplicationModal] = useState(false);
    const jobs = useMemo(() => parseCareerJobs(pageContent?.content), [pageContent?.content]);
    const publishedJobs = useMemo(() => jobs.filter((job) => job.isPublished !== false), [jobs]);
    const updatedAtLabel = useMemo(() => {
        if (!pageContent?.updatedAt) return null;
        return new Date(pageContent.updatedAt).toLocaleString();
    }, [pageContent?.updatedAt]);
    const remoteFriendlyCount = useMemo(
        () => publishedJobs.filter((job) => (job.location || '').toLowerCase().includes('remote')).length,
        [publishedJobs]
    );
    const departments = useMemo(
        () => Array.from(new Set(publishedJobs.map((job) => job.department).filter(Boolean))),
        [publishedJobs]
    );

    const handleApply = (job: CareerJob) => {
        setActiveJob(job);
        setShowApplicationModal(true);
    };

    const closeModal = () => {
        setShowApplicationModal(false);
        setActiveJob(null);
    };

    const heroTitle = pageContent?.title || t?.careersHeroTitle || 'Join our global team';
    const heroSubtitle = t?.careersHeroSubtitle || 'Help us redefine learning with a team of builders, educators, and dreamers.';
    const totalDepartments = departments.length || 3;

    return (
        <div className="ds-gradient-bg min-h-screen text-zinc-900">
            <section className="pt-24 pb-16">
                <div className="max-w-6xl mx-auto px-4 space-y-6">
                    <div className="inline-flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-red-500">
                        {t?.careers || 'Careers'}
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                    </div>
                    <h1 className="ds-page-title leading-tight">
                        {heroTitle}
                    </h1>
                    <p className="ds-description max-w-3xl">
                        {heroSubtitle}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                        <div className="ds-card-compact">
                            <p className="text-sm text-zinc-500">{t?.careersOpenRoles || 'Open roles'}</p>
                            <p className="text-3xl font-black mt-1 text-zinc-900">{publishedJobs.length}</p>
                        </div>
                        <div className="ds-card-compact">
                            <p className="text-sm text-zinc-500">{t?.careersRemoteReady || 'Remote friendly'}</p>
                            <p className="text-3xl font-black mt-1 text-zinc-900">{remoteFriendlyCount}</p>
                        </div>
                        <div className="ds-card-compact">
                            <p className="text-sm text-zinc-500">{t?.careersDepartments || 'Core teams'}</p>
                            <p className="text-3xl font-black mt-1 text-zinc-900">{totalDepartments}</p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="max-w-6xl mx-auto px-4 py-16 space-y-10">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                    <div className="space-y-3">
                        <p className="text-sm uppercase tracking-[0.34em] text-red-500 font-semibold">{t?.careers || 'Careers'}</p>
                        <h2 className="ds-section-title">
                            {t?.careersOpenRolesHeading || 'Browse our open roles'}
                        </h2>
                        <p className="ds-description max-w-2xl">
                            {t?.careersOpenRolesDescription || 'Explore the squads shipping our next chapter.'}
                        </p>
                    </div>
                    {updatedAtLabel && (
                        <p className="text-sm text-zinc-500 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-red-500" />
                            {t?.pageLastUpdated || 'Last updated'}: {updatedAtLabel}
                        </p>
                    )}
                </div>

                {publishedJobs.length ? (
                    <div className="grid gap-8 md:grid-cols-2">
                        {publishedJobs.map((job) => (
                            <CareerJobCard key={job.id} job={job} t={t} onApply={handleApply} />
                        ))}
                    </div>
                ) : (
                    <CareerPageEmptyState t={t} />
                )}
            </section>

            {showApplicationModal && activeJob && (
                <CareerApplicationModal job={activeJob} t={t} onClose={closeModal} />
            )}
        </div>
    );
};

const CareerJobCard: React.FC<{ job: CareerJob; onApply: (job: CareerJob) => void; t?: any }> = ({ job, onApply, t }) => {
    const descriptionLines = (job.description || '').split('\n').filter(Boolean).slice(0, 3);
    const normalizedApplyText = job.applyButtonText?.trim() || '';
    const shouldUseTranslatedApply = !normalizedApplyText || normalizedApplyText.toLowerCase() === DEFAULT_CAREER_APPLY_TEXT.toLowerCase();
    const applyLabel = shouldUseTranslatedApply ? (t?.jobApplyNow || DEFAULT_CAREER_APPLY_TEXT) : job.applyButtonText;
    const isPublished = job.isPublished !== false;
    const normalizedDepartment = job.department?.trim() || '';
    const departmentLabel = normalizedDepartment
        ? normalizedDepartment.toLowerCase() === 'general'
            ? (t?.careerDefaultDepartmentSimple || t?.careerDefaultDepartment || normalizedDepartment)
            : normalizedDepartment
        : (t?.careerJobDepartmentLabel || 'Department');
    const normalizedLocation = job.location?.trim() || '';
    const locationLabel = normalizedLocation
        ? normalizedLocation.toLowerCase() === 'remote'
            ? (t?.careerLocationRemote || normalizedLocation)
            : normalizedLocation
        : (t?.careerJobLocationLabel || 'Location');
    const getEmploymentLabel = () => {
        const employmentType = job.employmentType?.trim();
        if (!employmentType) return t?.careerJobTypeLabel || 'Employment Type';
        
        const lowerType = employmentType.toLowerCase();
        if (lowerType === 'full-time') return t?.careerEmploymentFullTime || employmentType;
        if (lowerType === 'part-time') return t?.careerEmploymentPartTime || employmentType;
        if (lowerType === 'contract') return t?.careerEmploymentContract || employmentType;
        if (lowerType === 'internship') return t?.careerEmploymentInternship || employmentType;
        if (lowerType === 'temporary') return t?.careerEmploymentTemporary || employmentType;
        
        return employmentType;
    };
    const employmentLabel = getEmploymentLabel();
    const highlight = job.highlight || descriptionLines[0] || t?.careerJobDescriptionLabel || '';

    return (
        <article
            className={`ds-card h-full ${
                isPublished ? 'hover:-translate-y-1 hover:shadow-2xl transition-transform duration-300' : 'opacity-70'
            }`}
        >
            <div className="flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full bg-red-50 text-red-600 border border-red-100">
                    <Building className="w-3.5 h-3.5" /> {departmentLabel}
                </span>
                <span className={`text-xs font-bold uppercase tracking-wide ${isPublished ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {isPublished ? (t?.careerPublishedTag || 'Published') : (t?.careerUnpublishedTag || 'Draft')}
                </span>
            </div>
            <h3 className="ds-section-subtitle mb-2">{job.title}</h3>
            <p className="text-sm text-zinc-600 mb-3 line-clamp-3">
                {highlight}
            </p>
            {descriptionLines.length > 1 && (
                <ul className="text-sm text-zinc-600 space-y-1 mb-4">
                    {descriptionLines.slice(1).map((line, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                            <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-red-500/60"></span>
                            <span>{line}</span>
                        </li>
                    ))}
                </ul>
            )}
            <div className="flex flex-wrap gap-4 text-sm text-zinc-500 mb-6">
                <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-red-500" /> {locationLabel}</span>
                <span className="inline-flex items-center gap-2"><Briefcase className="w-4 h-4 text-red-500" /> {employmentLabel}</span>
            </div>
            <button
                onClick={() => isPublished && onApply(job)}
                disabled={!isPublished}
                className="ds-btn ds-btn-primary w-full inline-flex items-center justify-between disabled:opacity-60"
            >
                <span>{applyLabel}</span>
                <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </button>
        </article>
    );
};

const CareerPageEmptyState: React.FC<{ t?: any }> = ({ t }) => (
    <div className="ds-card text-center text-zinc-600">
        <Sparkles className="w-12 h-12 mx-auto mb-4 text-red-400" />
        <h3 className="ds-section-subtitle mb-2">{t?.careersNoJobsTitle || 'No roles available right now'}</h3>
        <p className="ds-description max-w-2xl mx-auto">{t?.careersNoJobsSubtitle || 'We publish new roles as soon as they are ready. Check back soon or reach out to our team.'}</p>
        <button type="button" className="ds-btn ds-btn-secondary mt-6">
            {t?.careersApplyCta || 'Share Your Profile'} <ArrowRight className="w-4 h-4" />
        </button>
    </div>
);

const CareerApplicationModal: React.FC<{ job: CareerJob; onClose: () => void; t?: any }> = ({ job, onClose, t }) => {
    const [formValues, setFormValues] = useState({ name: '', email: '', phone: '', resumeUrl: '', coverLetter: '' });
    const [resumeFile, setResumeFile] = useState<File | null>(null);
    const [uploadingResume, setUploadingResume] = useState(false);
    const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const handleChange = (field: keyof typeof formValues, value: string) => {
        setFormValues((prev) => ({ ...prev, [field]: value }));
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            // Validate file type (PDF, DOC, DOCX)
            const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
            if (!validTypes.includes(file.type)) {
                setErrorMessage(t?.jobApplicationInvalidFile || 'Please upload a PDF, DOC, or DOCX file.');
                setStatus('error');
                return;
            }
            // Validate file size (max 10MB)
            if (file.size > 10 * 1024 * 1024) {
                setErrorMessage(t?.jobApplicationFileTooLarge || 'File size must be less than 10MB.');
                setStatus('error');
                return;
            }
            setResumeFile(file);
            setErrorMessage(null);
            setStatus('idle');
            // Clear URL if file is selected
            setFormValues((prev) => ({ ...prev, resumeUrl: '' }));
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!formValues.name.trim() || !formValues.email.trim()) {
            setErrorMessage(t?.jobApplicationError || 'Name and email are required.');
            setStatus('error');
            return;
        }
        setStatus('submitting');
        setErrorMessage(null);
        
        try {
            let resumeFilePath = '';
            
            // Upload resume file if provided
            if (resumeFile) {
                setUploadingResume(true);
                const formData = new FormData();
                formData.append('resume', resumeFile);
                
                const uploadResponse = await fetch('/api/careers/upload-resume', {
                    method: 'POST',
                    body: formData
                });
                
                if (!uploadResponse.ok) {
                    throw new Error(t?.jobApplicationUploadError || 'Failed to upload resume');
                }
                
                const uploadData = await uploadResponse.json();
                resumeFilePath = uploadData.url;
                setUploadingResume(false);
            }
            
            const response = await fetch('/api/careers/applications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId: job.id,
                    jobTitle: job.title,
                    name: formValues.name.trim(),
                    email: formValues.email.trim(),
                    phone: formValues.phone.trim() || undefined,
                    resumeUrl: formValues.resumeUrl.trim() || undefined,
                    resumeFilePath: resumeFilePath || undefined,
                    coverLetter: formValues.coverLetter.trim() || undefined,
                    jobSnapshot: job
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload?.error || 'Unable to submit');
            }
            setStatus('success');
        } catch (error) {
            setUploadingResume(false);
            setStatus('error');
            setErrorMessage(error instanceof Error ? error.message : t?.jobApplicationError || 'Unable to submit application.');
        }
    };

    const applicationTitleTemplate = t?.jobApplicationTitle || 'Apply for {role}';
    const modalTitle = applicationTitleTemplate.replace('{role}', job.title);
    const subtitle = t?.jobApplicationSubtitle || 'Share a few details and we will be in touch shortly.';

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white text-zinc-900 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                    <div>
                        <p className="text-xs font-semibold text-red-500 uppercase tracking-[0.3em]">{t?.jobApplicationFormLabel || 'Application'}</p>
                        <h3 className="ds-section-subtitle">{modalTitle}</h3>
                        <p className="ds-description">{subtitle}</p>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-zinc-100">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-6 py-6">
                    {status === 'success' ? (
                        <div className="text-center py-10">
                            <div className="ds-icon-container ds-icon-green mx-auto mb-4">
                                <CheckCircle className="w-8 h-8" />
                            </div>
                            <h4 className="ds-section-subtitle mb-2">{t?.jobApplicationSuccessTitle || 'Application submitted'}</h4>
                            <p className="ds-description mb-6">{t?.jobApplicationSuccessBody || 'Thanks for your interest. Our team will review your profile soon.'}</p>
                            <button onClick={onClose} className="ds-btn ds-btn-primary">
                                {t?.jobApplicationClose || 'Close'}
                            </button>
                        </div>
                    ) : (
                        <form className="space-y-4" onSubmit={handleSubmit}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label className="text-sm font-medium text-zinc-700 flex flex-col gap-1">
                                    {t?.jobApplicationName || 'Full Name'}
                                    <div className="flex items-center gap-2 border border-zinc-200 rounded-2xl px-3 py-2 bg-white">
                                        <UserIcon className="w-4 h-4 text-zinc-400" />
                                        <input
                                            type="text"
                                            className="flex-1 outline-none"
                                            value={formValues.name}
                                            onChange={(e) => handleChange('name', e.target.value)}
                                            required
                                        />
                                    </div>
                                </label>
                                <label className="text-sm font-medium text-zinc-700 flex flex-col gap-1">
                                    {t?.jobApplicationEmail || 'Email'}
                                    <div className="flex items-center gap-2 border border-zinc-200 rounded-2xl px-3 py-2 bg-white">
                                        <Mail className="w-4 h-4 text-zinc-400" />
                                        <input
                                            type="email"
                                            className="flex-1 outline-none"
                                            value={formValues.email}
                                            onChange={(e) => handleChange('email', e.target.value)}
                                            required
                                        />
                                    </div>
                                </label>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label className="text-sm font-medium text-zinc-700 flex flex-col gap-1">
                                    {t?.jobApplicationPhone || 'Phone (optional)'}
                                    <div className="flex items-center gap-2 border border-zinc-200 rounded-2xl px-3 py-2 bg-white">
                                        <Phone className="w-4 h-4 text-zinc-400" />
                                        <input
                                            type="tel"
                                            className="flex-1 outline-none"
                                            value={formValues.phone}
                                            onChange={(e) => handleChange('phone', e.target.value)}
                                        />
                                    </div>
                                </label>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-zinc-700 flex items-center gap-1">
                                    {t?.jobApplicationResume || 'Portfolio / Resume'}
                                </label>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs text-zinc-500">{t?.jobApplicationResumeUrl || 'URL'}</span>
                                        <div className="flex items-center gap-2 border border-zinc-200 rounded-2xl px-3 py-2 bg-white">
                                            <Paperclip className="w-4 h-4 text-zinc-400" />
                                            <input
                                                type="url"
                                                className="flex-1 outline-none"
                                                value={formValues.resumeUrl}
                                                onChange={(e) => handleChange('resumeUrl', e.target.value)}
                                                placeholder="https://"
                                                disabled={!!resumeFile}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-xs text-zinc-500">{t?.jobApplicationResumeFile || 'Or upload file (PDF, DOC, DOCX)'}</span>
                                        <label className="flex items-center gap-2 border border-zinc-200 rounded-2xl px-3 py-2 bg-white cursor-pointer hover:bg-zinc-50">
                                            <Upload className="w-4 h-4 text-zinc-400" />
                                            <span className="flex-1 text-sm truncate">
                                                {resumeFile ? resumeFile.name : (t?.jobApplicationChooseFile || 'Choose file...')}
                                            </span>
                                            <input
                                                type="file"
                                                className="hidden"
                                                accept=".pdf,.doc,.docx"
                                                onChange={handleFileChange}
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <label className="text-sm font-medium text-zinc-700 flex flex-col gap-1">
                                {t?.jobApplicationCoverLetter || 'Cover letter'}
                                <textarea
                                    className="border border-zinc-200 rounded-2xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-200 min-h-[120px]"
                                    value={formValues.coverLetter}
                                    onChange={(e) => handleChange('coverLetter', e.target.value)}
                                />
                            </label>
                            {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
                            <button
                                type="submit"
                                disabled={status === 'submitting' || uploadingResume}
                                className="ds-btn ds-btn-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                                {uploadingResume ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" /> {t?.jobApplicationUploading || 'Uploading resume...'}
                                    </>
                                ) : status === 'submitting' ? (
                                    <>
                                        <RefreshCw className="w-4 h-4 animate-spin" /> {t?.jobApplicationSubmitting || 'Submitting...'}
                                    </>
                                ) : (
                                    <>
                                        {t?.jobApplicationSubmit || 'Submit application'} <Send className="w-4 h-4" />
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ContactUsPage: React.FC<PublicProps> = ({ t, pageContent }) => {
    const renderedHtml = useMemo(() => renderMarkdown(pageContent?.content), [pageContent?.content]);
    
    return (
        <div className="max-w-4xl mx-auto py-24 px-4">
            <div className="mb-10 text-center">
                <span className="text-xs font-semibold tracking-[0.3em] text-red-600 uppercase block mb-4">
                    {t?.contactUs || 'Contact Us'}
                </span>
                <h1 className="ds-page-title mb-4">
                    {t?.contactUsTitle || 'Get in Touch'}
                </h1>
                <p className="ds-description leading-relaxed max-w-2xl mx-auto">
                    {t?.contactUsSubtitle || 'We\'d love to hear from you. Our team is here to help.'}
                </p>
            </div>

            {renderedHtml ? (
                <div className="ds-card">
                    <div
                        className="cms-content text-base md:text-lg leading-relaxed text-zinc-700 space-y-4"
                        dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                </div>
            ) : (
                <div className="ds-card">
                    <div className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="ds-icon-container ds-icon-red shrink-0">
                                <Mail className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-zinc-900 mb-2">{t?.contactEmail || 'Email'}</h3>
                                <p className="text-zinc-500 italic">{t?.contactPlaceholder || 'This information will be added by the admin.'}</p>
                            </div>
                        </div>
                        
                        <div className="flex items-start gap-4">
                            <div className="ds-icon-container ds-icon-red shrink-0">
                                <Phone className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-zinc-900 mb-2">{t?.contactPhone || 'Phone'}</h3>
                                <p className="text-zinc-500 italic">{t?.contactPlaceholder || 'This information will be added by the admin.'}</p>
                            </div>
                        </div>
                        
                        <div className="flex items-start gap-4">
                            <div className="ds-icon-container ds-icon-red shrink-0">
                                <MapPin className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-zinc-900 mb-2">{t?.contactAddress || 'Address'}</h3>
                                <p className="text-zinc-500 italic">{t?.contactPlaceholder || 'This information will be added by the admin.'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {pageContent?.updatedAt && (
                <p className="text-xs text-zinc-500 text-center mt-6">
                    {(t?.pageLastUpdated || 'Last updated') + ': ' + new Date(pageContent.updatedAt).toLocaleString()}
                </p>
            )}
        </div>
    );
};
