import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotification } from './NotificationContext';
import type { PlanPricingMap } from '../hooks/usePublicPaymentConfig';
import PhoneInput, { parsePhoneValue, type PhoneValue } from './PhoneInput';

type SaasCopy = NonNullable<(typeof import('../translations'))['translations']['en']['saas']>;

type Props = {
  mainDomain: string;
  copy: SaasCopy;
  planPricing?: PlanPricingMap | null;
};

type Step = 1 | 2 | 3 | 4;

type ProvisioningLog = {
  id: string;
  step: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string | null;
  started_at?: string;
  completed_at?: string | null;
};

const PROVISIONING_STEP_KEYS: Array<{ key: string; fallback: string }> = [
  { key: 'CREATE_TENANT_RECORD', fallback: 'Create tenant record' },
  { key: 'CREATE_TENANT_DATABASE', fallback: 'Create tenant DB' },
  { key: 'STORE_DATABASE_SECRET', fallback: 'Secure database secret' },
  { key: 'RUN_MIGRATIONS', fallback: 'Run migrations' },
  { key: 'SEED_DEFAULTS', fallback: 'Seed defaults' },
  { key: 'CREATE_ADMIN', fallback: 'Create administrator' },
  { key: 'SEND_WELCOME_EMAIL', fallback: 'Send welcome email' }
];

const formatTokens = (template: string, tokens: Record<string, string>) =>
  (template || '').replace(/\{(\w+)\}/g, (_, key: string) => tokens[key] ?? '');

const CORE_PLAN_KEYS = ['basic', 'pro', 'enterprise'] as const;
type CorePlanKey = (typeof CORE_PLAN_KEYS)[number];
const isCorePlanKey = (value: string): value is CorePlanKey =>
  CORE_PLAN_KEYS.some((plan) => plan === value);

const initialForm = {
  companyName: '',
  adminEmail: '',
  adminPassword: '',
  firstName: '',
  lastName: '',
  subdomain: '',
  plan: 'basic',
  phone: '',
  country: '',
  language: 'en'
};

const TOTAL_STEPS: Step = 4;

const SignupFlow: React.FC<Props> = ({ mainDomain, copy, planPricing }) => {
  const signupCopy = copy?.signup;
  const { notify } = useNotification();
  if (!signupCopy) {
    return null;
  }
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState(initialForm);
  const [phoneValue, setPhoneValue] = useState<PhoneValue>(parsePhoneValue(''));
  const [availability, setAvailability] = useState<'idle' | 'checking' | 'available' | 'taken' | 'error'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [provisioningState, setProvisioningState] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [provisioningLogs, setProvisioningLogs] = useState<ProvisioningLog[]>([]);
  const [provisioningError, setProvisioningError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const planOptions = signupCopy.planOptions || {};
  const fieldCopy = signupCopy.fields;
  const summaryCopy = signupCopy.summary;
  const subdomainCopy = signupCopy.subdomain;
  const buttonCopy = signupCopy.buttons;
  const provisioningCopy = signupCopy.provisioning;
  const successCopy = signupCopy.success;
  const currentPlanLabel = planOptions[form.plan]?.label || form.plan;
  const resolvePlanPrice = (planKey: string) => (isCorePlanKey(planKey) ? planPricing?.[planKey] : undefined);
  const currentPlanPrice = resolvePlanPrice(form.plan);

  const update = (key: keyof typeof initialForm, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const subdomainHint = useMemo(() => (form.subdomain ? `${form.subdomain}.${mainDomain}` : `your-academy.${mainDomain}`), [form.subdomain, mainDomain]);
  const currentStepTitle = signupCopy.stepTitles[String(step) as keyof typeof signupCopy.stepTitles] || '';
  const stepIndicator = formatTokens(signupCopy.stepLabel, { current: String(step), total: TOTAL_STEPS.toString() });

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    setAvailability('idle');
  }, [form.subdomain]);


  const deriveErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : signupCopy.genericError;

  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validateAndNotifyEmailError = (email: string): boolean => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) {
      const errorMsg = signupCopy.validation?.invalidEmail || 'Please include @ in the email address, is missing an @';
      notify('error', errorMsg);
      setEmailError(errorMsg);
      return false;
    }
    if (!isValidEmail(trimmedEmail)) {
      const errorMsg = signupCopy.validation?.invalidEmail || 'Please provide a valid email address.';
      notify('error', errorMsg);
      setEmailError(errorMsg);
      return false;
    }
    setEmailError(null);
    return true;
  };

  const checkAvailability = useCallback(async () => {
    const candidate = form.subdomain.trim().toLowerCase();
    if (!candidate) {
      setAvailability('taken');
      return 'taken' as const;
    }
    setAvailability('checking');
    try {
      const response = await fetch(`/saas/api/subdomains/check?subdomain=${encodeURIComponent(candidate)}`);
      if (!response.ok) {
        throw new Error(subdomainCopy.statuses.error);
      }
      const data = await response.json();
      const state = data.available ? 'available' : 'taken';
      setAvailability(state);
      return state;
    } catch (error) {
      console.error('Availability check failed', error);
      setAvailability('error');
      return 'error' as const;
    }
  }, [form.subdomain]);

  const pollProvisioning = useCallback(
    (id: string) => {
      stopPolling();
      let pollAttempts = 0;
      const maxPollAttempts = 150; // 10 minutes with 4-second intervals
      
      const fetchStatus = async () => {
        try {
          pollAttempts++;
          const response = await fetch(`/saas/api/provisioning/status/${id}`);
          if (!response.ok) {
            throw new Error(signupCopy.genericError);
          }
          const data = await response.json();
          setProvisioningLogs(Array.isArray(data.logs) ? data.logs : []);
          
          console.log(`[SignupFlow] Tenant status: ${data.tenant?.status}, attempt ${pollAttempts}/${maxPollAttempts}`);
          
          if (data.tenant?.status === 'active') {
            setProvisioningState('success');
            stopPolling();
          } else if (pollAttempts >= maxPollAttempts) {
            console.error('[SignupFlow] Polling timeout - tenant not activated');
            setProvisioningError(signupCopy.errors?.provisioningTimeout || 'Provisioning is taking longer than expected. Please contact support.');
            setProvisioningState('failed');
            stopPolling();
          }
        } catch (error) {
          console.error('Provisioning status poll failed', error);
          setProvisioningError(deriveErrorMessage(error));
          setProvisioningState('failed');
          stopPolling();
        }
      };

      fetchStatus();
      pollRef.current = setInterval(fetchStatus, 4000);
    },
    [stopPolling, signupCopy.genericError, signupCopy.errors]
  );

  const startProvisioning = useCallback(async () => {
    if (provisioningState === 'running' || provisioningState === 'success') {
      return;
    }
    setProvisioningError(null);
    setProvisioningLogs([]);
    setProvisioningState('running');
    try {
      const response = await fetch('/saas/api/provisioning/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subdomain: form.subdomain.trim().toLowerCase(),
          companyName: form.companyName.trim(),
          subscriptionPlan: form.plan,
          admin: {
            email: form.adminEmail.trim(),
            password: form.adminPassword.trim(),
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            phone: phoneValue.full || undefined,
            phoneCountryCode: phoneValue.countryCode || undefined
          }
        })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || signupCopy.genericError);
      }
      const data = await response.json();
      setTenantId(data.tenantId);
      pollProvisioning(data.tenantId);
    } catch (error) {
      console.error('Provisioning start failed', error);
      setProvisioningError(deriveErrorMessage(error));
      setProvisioningState('failed');
    }
  }, [form, pollProvisioning, provisioningState, signupCopy.genericError]);

  const next = async () => {
    if (step === 1) {
      if (!form.companyName.trim()) {
        notify('error', signupCopy.validation.academyName || 'Please provide your academy name.');
        return;
      }
      if (!form.adminEmail.trim()) {
        notify('error', signupCopy.validation.adminEmail || 'Please provide the admin email.');
        return;
      }
      if (!validateAndNotifyEmailError(form.adminEmail)) {
        return;
      }
      if (!form.adminPassword.trim()) {
        notify('error', signupCopy.validation.adminPassword || 'Please provide the admin password.');
        return;
      }
      if (!form.firstName.trim()) {
        notify('error', signupCopy.validation.firstName || 'Please provide the admin first name.');
        return;
      }
      if (!form.lastName.trim()) {
        notify('error', signupCopy.validation.lastName || 'Please provide the admin last name.');
        return;
      }
      if (!phoneValue.number.trim()) {
        notify('error', signupCopy.validation?.phone || 'Please provide a phone number.');
        return;
      }
    }
    if (step === 2) {
      if (!form.subdomain.trim()) {
        notify('error', signupCopy.validation.subdomain || 'Please choose a subdomain.');
        return;
      }
      const state = await checkAvailability();
      if (state !== 'available') {
        return;
      }
    }
    if (step === 3 && provisioningState !== 'success') {
      return;
    }
    if (step === 4) {
      // Final step - redirect to tenant subdomain
      if (form.subdomain) {
        const tenantUrl = `https://${form.subdomain}.${mainDomain}`;
        window.location.href = tenantUrl;
      }
      return;
    }
    setStep((s) => Math.min(4, (s + 1) as Step));
  };

  const prev = () => setStep((s) => (Math.max(1, (s - 1) as Step)));

  useEffect(() => {
    if (step === 3 && provisioningState === 'idle') {
      startProvisioning();
    }
  }, [step, provisioningState, startProvisioning]);

  const progressMap = useMemo(() => {
    const latest = new Map<string, ProvisioningLog>();
    provisioningLogs.forEach((log) => {
      latest.set(log.step, log);
    });
    return latest;
  }, [provisioningLogs]);

  const renderStatus = () => {
    if (step === 3) {
      return (
        <div className="p-4 rounded-lg border border-zinc-200 bg-zinc-50 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{provisioningCopy.title}</p>
            <span
              className={`text-xs font-semibold ${
                provisioningState === 'success'
                  ? 'text-green-600'
                  : provisioningState === 'failed'
                    ? 'text-red-600'
                    : 'text-zinc-500'
              }`}
            >
              {provisioningCopy.states[provisioningState]}
            </span>
          </div>
          <ol className="space-y-2 text-sm">
            {PROVISIONING_STEP_KEYS.map(({ key, fallback }, index) => {
              const log = progressMap.get(key);
              const status = log?.status || 'pending';
              const badgeClasses =
                status === 'success'
                  ? 'bg-green-100 text-green-700 border-green-200'
                  : status === 'failed'
                    ? 'bg-red-100 text-red-700 border-red-200'
                    : status === 'running'
                      ? 'bg-amber-100 text-amber-700 border-amber-200'
                      : 'bg-zinc-100 text-zinc-600 border-zinc-200';
              return (
                <li key={key} className="flex items-start gap-3">
                  <span className={`h-6 w-6 rounded-full border flex items-center justify-center text-xs font-semibold ${badgeClasses}`}>
                    {status === 'success' ? '✓' : index + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-zinc-800">{provisioningCopy.stepLabels[key as keyof typeof provisioningCopy.stepLabels] || fallback}</p>
                    {log?.message && <p className="text-xs text-zinc-500">{log.message}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {provisioningError && (
            <p className="text-sm text-red-600">{provisioningError}</p>
          )}
        </div>
      );
    }
    if (step === 4) {
      const successMessage = formatTokens(successCopy.message, {
        subdomain: form.subdomain || 'your-academy',
        domain: mainDomain
      });
      return (
        <div className="p-4 rounded-lg border border-green-200 bg-green-50">
          <p className="font-semibold text-green-800 mb-1">{successCopy.title}</p>
          <p className="text-sm text-green-700">{successMessage}</p>
          {tenantId && <p className="text-xs text-green-600 mt-1">{successCopy.tenantLabel}: {tenantId}</p>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-xs uppercase tracking-wide text-red-600 font-semibold">{signupCopy.badge}</p>
            <h1 className="text-3xl font-bold">{currentStepTitle}</h1>
          </div>
          <p className="text-sm text-zinc-500">{stepIndicator}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            {step === 1 && (
              <div className="space-y-4">
                <label className="block text-sm font-semibold">
                  {fieldCopy.academyName} <span className="text-red-600">*</span>
                  <input className="mt-1 w-full border border-zinc-200 rounded-lg px-3 py-2" value={form.companyName} onChange={(e) => update('companyName', e.target.value)} required />
                </label>
                <label className="block text-sm font-semibold">
                  {fieldCopy.adminEmail} <span className="text-red-600">*</span>
                  <input type="text" inputMode="email" className={`mt-1 w-full border rounded-lg px-3 py-2 ${emailError ? 'border-red-500' : 'border-zinc-200'}`} value={form.adminEmail} onChange={(e) => {
                    update('adminEmail', e.target.value);
                    setEmailError(null);
                  }} onBlur={(e) => validateAndNotifyEmailError(e.target.value)} required />
                  {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
                </label>
                <label className="block text-sm font-semibold">
                  {fieldCopy.adminPassword || 'Admin Password'} <span className="text-red-600">*</span>
                  <div className="relative mt-1">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-5 h-5"
                      >
                        {showPassword ? (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
                          />
                        ) : (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                          />
                        )}
                        {showPassword ? null : (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        )}
                      </svg>
                    </button>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="w-full border border-zinc-200 rounded-lg pl-11 pr-3 py-2"
                      value={form.adminPassword}
                      onChange={(e) => update('adminPassword', e.target.value)}
                      placeholder="Choose a secure password"
                      required
                    />
                  </div>
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="block text-sm font-semibold">
                    {fieldCopy.firstName} <span className="text-red-600">*</span>
                    <input className="mt-1 w-full border border-zinc-200 rounded-lg px-3 py-2" value={form.firstName} onChange={(e) => update('firstName', e.target.value)} required />
                  </label>
                  <label className="block text-sm font-semibold">
                    {fieldCopy.lastName} <span className="text-red-600">*</span>
                    <input className="mt-1 w-full border border-zinc-200 rounded-lg px-3 py-2" value={form.lastName} onChange={(e) => update('lastName', e.target.value)} required />
                  </label>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">
                    {fieldCopy.phone || 'Phone Number'} <span className="text-red-600">*</span>
                  </label>
                  <PhoneInput
                    id="phone"
                    name="phone"
                    required
                    value={phoneValue}
                    onChange={setPhoneValue}
                    placeholder="Enter phone number"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <label className="block text-sm font-semibold">
                  {subdomainCopy.label} <span className="text-red-600">*</span>
                  <div className="mt-1 flex items-center gap-2">
                    <input className="w-full border border-zinc-200 rounded-lg px-3 py-2" value={form.subdomain} onChange={(e) => update('subdomain', e.target.value.toLowerCase())} required />
                    <span className="text-sm text-zinc-500 whitespace-nowrap">.{mainDomain}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{subdomainCopy.examplePrefix} {subdomainHint}</p>
                </label>
                <button
                  onClick={checkAvailability}
                  className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold hover:border-red-200"
                  disabled={availability === 'checking'}
                >
                  {availability === 'checking' ? subdomainCopy.checking : subdomainCopy.availabilityButton}
                </button>
                {availability === 'available' && <p className="text-sm text-green-700">{subdomainCopy.statuses.available}</p>}
                {availability === 'taken' && <p className="text-sm text-red-600">{subdomainCopy.statuses.taken}</p>}
                {availability === 'error' && <p className="text-sm text-red-600">{subdomainCopy.statuses.error}</p>}
              </div>
            )}

            {step >= 3 && renderStatus()}
          </div>

          <aside className="p-4 rounded-xl border border-zinc-100 bg-zinc-50 space-y-3">
            <p className="text-sm font-semibold">{summaryCopy.title}</p>
            <div className="text-sm text-zinc-600 space-y-1">
              <div>
                {summaryCopy.academy}: {form.companyName || '—'}
              </div>
              <div>
                {summaryCopy.admin}: {form.adminEmail || '—'}
              </div>
              <div>
                {summaryCopy.subdomain}: {form.subdomain ? `${form.subdomain}.${mainDomain}` : '—'}
              </div>
              <div>
                {summaryCopy.plan}: {currentPlanLabel}
                {currentPlanPrice?.formatted && <span className="ml-1 text-xs text-zinc-500">({currentPlanPrice.formatted})</span>}
              </div>
            </div>
          </aside>
        </div>

        <div className="flex justify-between items-center mt-8">
          <button onClick={prev} disabled={step === 1} className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold disabled:opacity-50">
            {buttonCopy.back}
          </button>
          <button
            onClick={next}
            className="px-5 py-2 rounded-lg bg-red-900 text-white font-semibold shadow hover:bg-red-950 transition disabled:opacity-50"
            disabled={(step === 2 && availability === 'checking') || (step === 3 && provisioningState !== 'success')}
          >
            {step === TOTAL_STEPS
              ? buttonCopy.done
              : step === 3 && provisioningState !== 'success'
                ? buttonCopy.provisioning
                : buttonCopy.next}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SignupFlow;

