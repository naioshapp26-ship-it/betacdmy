/**
 * Language Toggle Component
 * 
 * Provides a UI control for switching between English and Arabic.
 */

import React from 'react';
import { useLanguage } from './LanguageContext';

interface LanguageToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const LanguageToggle: React.FC<LanguageToggleProps> = ({ 
  className = '', 
  showLabel = true 
}) => {
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  return (
    <button
      onClick={toggleLanguage}
      className={`language-toggle ${className}`}
      title={language === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
      aria-label={language === 'en' ? 'Switch to Arabic' : 'التبديل إلى الإنجليزية'}
      style={{
        padding: '8px 16px',
        borderRadius: '6px',
        border: '1px solid #ddd',
        background: 'white',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s',
        fontSize: '14px',
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#f5f5f5';
        e.currentTarget.style.borderColor = '#999';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'white';
        e.currentTarget.style.borderColor = '#ddd';
      }}
    >
      <span style={{ fontSize: '18px' }}>
        {language === 'en' ? '🇸🇦' : '🇺🇸'}
      </span>
      {showLabel && (
        <span>
          {language === 'en' ? 'العربية' : 'English'}
        </span>
      )}
    </button>
  );
};

// Compact version for navbar/header
export const LanguageToggleCompact: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { language, setLanguage } = useLanguage();

  return (
    <button
      onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
      className={`language-toggle-compact ${className}`}
      title={language === 'en' ? 'العربية' : 'English'}
      aria-label={language === 'en' ? 'Switch to Arabic' : 'Switch to English'}
      style={{
        padding: '6px 12px',
        borderRadius: '4px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: '20px',
        transition: 'background 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {language === 'en' ? '🇸🇦' : '🇺🇸'}
    </button>
  );
};
