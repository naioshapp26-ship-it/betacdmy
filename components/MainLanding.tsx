import React from 'react';

type SaasCopy = NonNullable<(typeof import('../translations'))['translations']['en']['saas']>;

type Props = {
  onStart?: () => void;
  onGuestMode?: () => void;
  copy: SaasCopy;
  isRtl?: boolean;
};

const formatTokens = (template: string, tokens: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => tokens[key] ?? '');

const MainLanding: React.FC<Props> = ({ onStart, copy, isRtl = false }) => {
  const landing = copy?.landing;
  if (!landing) {
    return null;
  }
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-zinc-50 text-zinc-900">
      <header className={`hero-header max-w-6xl mx-auto px-4 pt-12 pb-16 flex flex-col ${isRtl ? 'md:flex-row-reverse' : 'md:flex-row'} items-center gap-10`}>
        <div className="flex-1 space-y-6">
          {landing.badge && (
            <p className="px-3 py-1 inline-flex rounded-full bg-red-50 text-red-700 text-xs font-semibold tracking-wide">
              {landing.badge}
            </p>
          )}
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            {landing.heroTitlePre}{' '}
            <span className="text-red-600">{landing.heroTitleHighlight}</span>{' '}
            {landing.heroTitlePost}
          </h1>
          <p className="text-lg text-zinc-600 max-w-2xl">
            {landing.heroSubtitle}
          </p>
          <div className="flex gap-4">
            <button
              onClick={onStart}
              className="px-6 py-3 rounded-lg bg-red-900 text-white font-semibold shadow hover:bg-red-950 transition"
            >
              {landing.startCta}
            </button>
            <a href="#pricing" className="px-6 py-3 rounded-lg border border-zinc-200 font-semibold hover:border-red-200">
              {landing.pricingCta}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            {landing.trustBadges.map((badge, index) => (
              <React.Fragment key={badge}>
                <span>{badge}</span>
                {index < landing.trustBadges.length - 1 && <span>•</span>}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="flex-1 w-full max-w-xl">
          <div className="rounded-2xl border border-zinc-100 bg-white shadow-sm p-6 space-y-4">
            <h3 className="font-semibold text-lg">{landing.provisioningTitle}</h3>
            <ol className="space-y-3 text-sm text-zinc-600">
              {landing.provisioningSteps.map((step, idx) => (
                <li key={step} className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-semibold">
                    {idx + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </header>

      <section id="features" className="bg-white border-t border-b border-zinc-100 py-14">
        <div className="max-w-6xl mx-auto px-4">
          <p className="text-xs uppercase tracking-wide text-red-600 font-semibold mb-6">{landing.featureHeading}</p>
          <div className="grid md:grid-cols-3 gap-8">
            {landing.featureCards.map((item) => (
              <div key={item.title} className="p-6 rounded-xl border border-zinc-100 bg-white shadow-sm">
                <h4 className="font-semibold mb-2">{item.title}</h4>
                <p className="text-sm text-zinc-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-4 py-16">
        <div className="flex justify-between items-center mb-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-red-600 font-semibold">{landing.pricingLabel}</p>
            <h3 className="text-3xl font-bold">{landing.pricingTitle}</h3>
          </div>
          <button onClick={onStart} className="px-5 py-2 rounded-lg bg-red-900 text-white font-semibold shadow hover:bg-red-950 transition">
            {landing.pricingStartCta}
          </button>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {landing.plans.map((plan) => (
            <div key={plan.name} className="p-6 rounded-2xl border border-zinc-100 bg-white shadow-sm">
              <h4 className="font-semibold text-lg mb-2">{plan.name}</h4>
              <p className="text-3xl font-bold mb-4">{plan.price}</p>
              <ul className="space-y-2 text-sm text-zinc-600">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    {f}
                  </li>
                ))}
              </ul>
              <button onClick={onStart} className="mt-6 w-full py-2.5 rounded-lg border border-red-200 text-red-700 font-semibold hover:bg-red-50">
                {formatTokens(landing.choosePlanCta, { plan: plan.name })}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default MainLanding;

