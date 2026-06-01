import React, { useState, useEffect } from 'react';
import { Info, X } from 'lucide-react';

interface GuestBannerProps {
  onCreateAccount: () => void;
  translations: {
    bannerText: string;
    createAccountCTA: string;
  };
  language: 'ar' | 'en';
}

const DISMISSED_KEY = 'betacademy_guest_banner_dismissed';

export const GuestBanner: React.FC<GuestBannerProps> = ({
  onCreateAccount,
  translations,
  language
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if banner was dismissed in this session
    const dismissed = sessionStorage.getItem(DISMISSED_KEY);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, 'true');
  };

  if (isDismissed) return null;

  return (
    <div className="sticky top-0 z-[70] border-b border-red-300 bg-gradient-to-r from-red-100 to-red-200 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between gap-4 py-3">
          {/* Icon + Text */}
          <div className="flex flex-1 items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-200">
              <Info className="text-red-800" size={18} />
            </div>
            <p
              className={`text-sm font-medium text-red-900 sm:text-base ${
                language === 'ar' ? 'text-right' : 'text-left'
              }`}
            >
              {translations.bannerText}
            </p>
          </div>

          {/* CTA Button */}
          <button
            onClick={onCreateAccount}
            className="flex-shrink-0 rounded-lg bg-gradient-to-r from-red-800 to-red-900 px-4 py-2 text-sm font-semibold text-white transition hover:from-red-900 hover:to-red-950 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 sm:px-6"
          >
            {translations.createAccountCTA}
          </button>

          {/* Dismiss Button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 rounded-lg p-2 text-red-800 transition hover:bg-red-200"
            aria-label="Dismiss banner"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};
