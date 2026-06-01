import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUp, Heart, MessageCircle, Plus } from 'lucide-react';

type Props = {
  language: 'en' | 'ar';
  onBack?: () => void;
};

const BUTTON_BASE_CLASSES =
  'inline-flex items-center justify-center rounded-full bg-red-900 text-white shadow-lg transition-colors hover:bg-red-950 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-white';

const ICON_SIZE_CLASSES = 'h-[18px] w-[18px] sm:h-6 sm:w-6';

const FloatingActionButtons: React.FC<Props> = ({ onBack, language }) => {
  const navigate = useNavigate();
  const isArabic = language === 'ar';

  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const containerClasses = useMemo(() => {
    const sideClass = isArabic ? 'left-3 sm:left-4' : 'right-3 sm:right-4';
    const hiddenTranslate = isArabic ? '-translate-x-16' : 'translate-x-16';
    return [
      'fixed',
      'top-[calc(50%+3.5rem)]',
      'sm:top-[calc(50%+2.25rem)]',
      sideClass,
      '-translate-y-1/2',
      'z-40',
      'flex',
      'flex-col',
      'items-center',
      'gap-3',
      'max-h-[calc(100vh-9rem)]',
      'transform-gpu',
      'transition-all',
      'duration-500',
      'ease-out',
      isVisible ? 'opacity-100 translate-x-0' : `opacity-0 ${hiddenTranslate}`
    ].join(' ');
  }, [isArabic, isVisible]);

  const handleScrollToFooter = () => {
    const footer = document.getElementById('footer') || document.querySelector('footer');
    if (footer) {
      footer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Fallback: scroll near bottom.
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  };

  const handleScrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }

    // Fallback: try browser history, else go home.
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/');
  };

  return (
    <div className={containerClasses} aria-label={isArabic ? 'أزرار سريعة' : 'Quick actions'}>
      <button
        type="button"
        onClick={() => navigate('/register')}
        className={`${BUTTON_BASE_CLASSES} h-10 w-10 sm:h-14 sm:w-14`}
        aria-label={isArabic ? 'إنشاء حساب' : 'Create account'}
      >
        <Plus className={ICON_SIZE_CLASSES} strokeWidth={2.25} />
      </button>

      <button
        type="button"
        onClick={() => navigate('/blog')}
        className={`${BUTTON_BASE_CLASSES} h-10 w-10 sm:h-14 sm:w-14`}
        aria-label={isArabic ? 'المدونة' : 'Blog'}
      >
        <Heart className={ICON_SIZE_CLASSES} strokeWidth={2.25} />
      </button>

      <button
        type="button"
        onClick={handleScrollToFooter}
        className={`${BUTTON_BASE_CLASSES} h-10 w-10 sm:h-14 sm:w-14`}
        aria-label={isArabic ? 'اذهب إلى الفوتر' : 'Scroll to footer'}
      >
        <MessageCircle className={ICON_SIZE_CLASSES} strokeWidth={2.25} />
      </button>

      <button
        type="button"
        onClick={handleScrollToTop}
        className={`${BUTTON_BASE_CLASSES} h-10 w-10 sm:h-14 sm:w-14`}
        aria-label={isArabic ? 'العودة للأعلى' : 'Scroll to top'}
      >
        <ArrowUp className={ICON_SIZE_CLASSES} strokeWidth={2.25} />
      </button>

      <button
        type="button"
        onClick={handleBack}
        className={`${BUTTON_BASE_CLASSES} h-10 w-10 sm:h-14 sm:w-14`}
        aria-label={isArabic ? 'رجوع' : 'Back'}
      >
        {isArabic ? <ArrowRight className={ICON_SIZE_CLASSES} strokeWidth={2.25} /> : <ArrowLeft className={ICON_SIZE_CLASSES} strokeWidth={2.25} />}
      </button>
    </div>
  );
};

export default FloatingActionButtons;
