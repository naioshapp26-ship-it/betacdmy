import React, { useMemo, useState } from 'react';

type LocaleCopy = (typeof import('../translations'))['translations']['en'];

type Props = {
  t: LocaleCopy;
  lang: keyof (typeof import('../translations'))['translations'];
  adminView: React.ReactNode;
  tenantView: React.ReactNode;
};

const SuperAdminConsole: React.FC<Props> = ({ t, lang, adminView, tenantView }) => {
  const [activeView, setActiveView] = useState<'platform' | 'tenants'>('platform');
  const consoleCopy = useMemo(() => {
    return {
      title: t?.superAdminConsoleTitle ?? 'Owner Control Center',
      subtitle: t?.superAdminConsoleSubtitle ?? 'Full platform control plus tenant management.',
      description: t?.superAdminConsoleDescription ?? 'Switch between academy admin and tenant oversight.',
      badge: t?.superAdminConsoleBadge ?? 'Platform owners',
      platformTab: t?.superAdminPlatformTab ?? 'Platform Admin',
      tenantsTab: t?.superAdminTenantsTab ?? 'Tenant Management'
    };
  }, [t]);

  const isArabic = lang === 'ar';
  const direction = isArabic ? 'rtl' : 'ltr';
  const platformView = activeView === 'platform';

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-white" dir={direction}>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div
            className={isArabic ? 'text-right' : 'text-left'}
            style={{ direction, textAlign: isArabic ? 'right' : 'left' }}
          >
            <span className="inline-block text-xs uppercase tracking-[0.2em] text-rose-500 font-semibold">
              {consoleCopy.badge}
            </span>
          </div>
          <div
            className={isArabic ? 'text-right space-y-2' : 'text-left space-y-2'}
            style={{ direction, textAlign: isArabic ? 'right' : 'left' }}
          >
            <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">{consoleCopy.title}</h1>
            <p className="text-sm sm:text-base text-zinc-600">{consoleCopy.subtitle}</p>
            <p className="text-sm text-zinc-500">{consoleCopy.description}</p>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm">
          <div className={`flex ${direction === 'rtl' ? 'flex-row-reverse' : 'flex-row'}`}>
            <button
              className={`flex-1 px-4 py-3 text-sm font-semibold transition border-b-2 ${
                platformView ? 'text-zinc-900 border-zinc-900' : 'text-zinc-500 border-transparent'
              }`}
              onClick={() => setActiveView('platform')}
            >
              {consoleCopy.platformTab}
            </button>
            <button
              className={`flex-1 px-4 py-3 text-sm font-semibold transition border-b-2 ${
                !platformView ? 'text-zinc-900 border-zinc-900' : 'text-zinc-500 border-transparent'
              }`}
              onClick={() => setActiveView('tenants')}
            >
              {consoleCopy.tenantsTab}
            </button>
          </div>
          <div className="p-4 sm:p-6">
            {platformView ? adminView : tenantView}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminConsole;
