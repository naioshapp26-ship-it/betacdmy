import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNotification } from './NotificationContext';
import { fetchResolvedAIConfig, resetAIConfigCache } from '../services/geminiService';
import { Eye, EyeOff } from 'lucide-react';

type SaasCopy = NonNullable<(typeof import('../translations'))['translations']['en']['saas']>;

type Props = {
  copy: SaasCopy;
  variant?: 'standalone' | 'embedded';
};

type TabKey = 'tenants' | 'platformUsers' | 'logs' | 'settings';

type TenantSummary = {
  id: string;
  subdomain: string;
  companyName: string;
  status: string;
  subscriptionPlan: string;
  createdAt?: string;
  updatedAt?: string;
  suspendedAt?: string | null;
  deletedAt?: string | null;
  primaryAdmin?: {
    email: string;
    name: string | null;
  } | null;
  subscription?: {
    plan: string | null;
    status: string | null;
    priceMonthly: number | null;
    currentPeriodEnd: string | null;
  } | null;
  payments: {
    total: number;
    last: {
      amount: number;
      status: string | null;
      method: string | null;
      createdAt: string | null;
    } | null;
  };
};

type ProvisioningLog = {
  id: string;
  tenant_id: string | null;
  subdomain: string | null;
  status: string;
  step: string;
  message: string | null;
  started_at?: string;
};

type TenantUser = {
  id: string;
  publicUserId?: string | null;
  email: string;
  name: string;
  role: string;
  status: string | null;
  last_active?: string | null;
  join_date?: string | null;
  platformUserId?: string | null;
  assignmentRole?: string | null;
  assignmentStatus?: string | null;
  assignmentId?: string | null;
  assignmentCreatedAt?: string | null;
};

type TenantPayment = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  payment_method: string | null;
  transaction_reference: string | null;
  created_at: string;
  refunded_amount?: string;
  refund_status?: 'none' | 'partial' | 'full' | null;
};

type RefundEligibility = {
  canRefund: boolean;
  reason?: string;
  maxRefundAmount?: number;
  paymentDetails?: {
    amount: number;
    refunded_amount: number;
    status: string;
  };
};

type PlatformUser = {
  id: string;
  publicUserId?: string | null;
  email: string;
  name: string;
  role: string;
  status: string | null;
  last_active?: string | null;
  join_date?: string | null;
};

type AnalyticsSnapshot = {
  total_tenants: number;
  active_tenants: number;
  suspended_tenants: number;
  deleted_tenants: number;
  total_revenue: number;
  payment_events: number;
};

const formatCurrency = (value?: number | null, currency = 'USD') => {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const statusStyles: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  suspended: 'bg-amber-50 text-amber-700',
  deleted: 'bg-rose-50 text-rose-700'
};

const SuperAdminDashboard: React.FC<Props> = ({ copy, variant = 'standalone' }) => {
  const { confirm, prompt } = useNotification();
  const adminCopy = copy?.superAdmin;
  if (!adminCopy) {
    return null;
  }

  const aiCopy = adminCopy.aiSettings ?? {
    sectionTitle: 'AI Integration (Platform Level)',
    sectionDescription: 'Configure AI provider credentials for platform-level features on the main domain.',
    title: 'AI Provider',
    description: 'Enable AI features for platform-level operations.',
    toggleLabel: 'Enable AI',
    providerLabel: 'AI Provider',
    modelLabel: 'Model',
    modelPlaceholder: 'gemini-2.5-flash',
    apiKeyLabel: 'API Key',
    apiKeyPlaceholder: 'Enter your API key',
    apiKeyHint: 'Your API key is encrypted and stored securely.',
    maxTokensLabel: 'Max Tokens',
    temperatureLabel: 'Temperature',
    testCta: 'Test Connection',
    testingLabel: 'Testing...',
    saveCta: 'Save AI Settings',
    savingLabel: 'Saving...',
    messages: {
      keyRequired: 'API Key is required when AI is enabled',
      testKeyRequired: 'API Key is required for testing',
      saveSuccess: 'AI configuration updated successfully.',
      saveError: 'Unable to update AI configuration',
      testSuccess: 'AI connection test successful!',
      testError: 'AI connection test failed'
    }
  };

  const emailCopy = adminCopy.emailSettings ?? {
    title: 'Email SMTP Settings',
    centralTitle: 'Email SMTP Settings (Central Domain)',
    description: 'Configure password reset email delivery for this central domain dashboard.',
    centralDescription: 'Configure SMTP credentials used for password reset emails on the central domain.',
    scopeLabel: 'Scope',
    scopeCentral: 'Central default',
    lastUpdated: 'Last updated',
    loading: 'Loading SMTP settings...',
    smtpHostLabel: 'SMTP Host',
    smtpHostPlaceholder: 'smtp.example.com',
    smtpPortLabel: 'SMTP Port',
    smtpUserLabel: 'SMTP Username',
    smtpFromLabel: 'From Email',
    smtpFromPlaceholder: 'noreply@example.com',
    smtpPassLabel: 'SMTP Password',
    smtpPassPlaceholder: 'Enter SMTP password',
    smtpPassHint: '(leave empty to keep current password)',
    smtpSecureLabel: 'Use secure SMTP (TLS/SSL)',
    saveCta: 'Save Email Settings',
    savingLabel: 'Saving...',
    deleteCta: 'Delete Settings',
    deletingLabel: 'Deleting...',
    deleteConfirm: 'Delete SMTP settings? This will use environment variable fallback for email delivery.',
    messages: {
      saveSuccess: 'Email SMTP settings updated successfully.',
      saveError: 'Unable to save email settings',
      deleteSuccess: 'Email SMTP settings deleted successfully.',
      deleteError: 'Unable to delete email settings'
    }
  };

  const [activeTab, setActiveTab] = useState<TabKey>('tenants');
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [logs, setLogs] = useState<ProvisioningLog[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [selectedTenant, setSelectedTenant] = useState<TenantSummary | null>(null);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [tenantPayments, setTenantPayments] = useState<TenantPayment[]>([]);
  const [tenantUsersLoading, setTenantUsersLoading] = useState(false);
  const [tenantPaymentsLoading, setTenantPaymentsLoading] = useState(false);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [platformUsersLoading, setPlatformUsersLoading] = useState(false);
  const [platformUserFilter, setPlatformUserFilter] = useState('');
  const [platformRoleFilter, setPlatformRoleFilter] = useState<'ALL' | 'STUDENT' | 'INSTRUCTOR' | 'ADMIN' | 'SUPER_ADMIN'>('ALL');
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSearching, setAssignSearching] = useState(false);
  
  // Refund state
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundingPayment, setRefundingPayment] = useState<TenantPayment | null>(null);
  const [refundEligibility, setRefundEligibility] = useState<RefundEligibility | null>(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundCheckLoading, setRefundCheckLoading] = useState(false);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('requested_by_customer');
  const [cancelSubscriptionLoading, setCancelSubscriptionLoading] = useState(false);
  
  const [createForm, setCreateForm] = useState({
    companyName: '',
    subdomain: '',
    plan: 'basic',
    adminEmail: '',
    adminFirstName: '',
    adminLastName: '',
    adminPhone: ''
  });
  const [editForm, setEditForm] = useState({
    companyName: '',
    subdomain: '',
    plan: 'basic',
    primaryAdminEmail: '',
    status: 'active'
  });
  const [assignForm, setAssignForm] = useState({
    search: '',
    selectedUserId: null as string | null,
    role: 'STUDENT' as 'STUDENT' | 'INSTRUCTOR' | 'ADMIN'
  });
  const [assignResults, setAssignResults] = useState<PlatformUser[]>([]);

  // AI Configuration State
  type AIConfigFormState = {
    aiEnabled: boolean;
    aiProvider: string;
    aiModel: string;
    apiKey: string;
    maxTokens: number;
    temperature: number;
  };
  const [aiConfigForm, setAiConfigForm] = useState<AIConfigFormState>({
    aiEnabled: false,
    aiProvider: 'gemini',
    aiModel: 'gemini-2.5-flash',
    apiKey: '',
    maxTokens: 4096,
    temperature: 0.7
  });
  const [isSavingAIConfig, setIsSavingAIConfig] = useState(false);
  const [isTestingAI, setIsTestingAI] = useState(false);
  const [showAIApiKey, setShowAIApiKey] = useState(false);
  const [aiNotice, setAiNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Central Live Platform Config state
  type CentralLivePlatformConfigForm = {
    smrrtxEnabled: boolean;
    smrrtxPermanentRoomLink: string;
    zoomEnabled: boolean;
    zoomConfigLink: string;
    zoomClientId: string;
    zoomClientSecret: string;
    zoomAccountId: string;
    zoomUserId: string;
    meetEnabled: boolean;
    meetConfigLink: string;
    googleSaEmail: string;
    googleSaKey: string;
    googleCalendarId: string;
  };
  const [centralLivePlatformForm, setCentralLivePlatformForm] = useState<CentralLivePlatformConfigForm>({
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
    googleCalendarId: ''
  });
  const [isSavingCentralLive, setIsSavingCentralLive] = useState(false);
  const [centralLiveNotice, setCentralLiveNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [centralEmailForm, setCentralEmailForm] = useState({
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    smtpSecure: false
  });
  const [centralEmailMeta, setCentralEmailMeta] = useState<{ hasPassword: boolean; updatedAt: string | null }>({
    hasPassword: false,
    updatedAt: null
  });
  const [isLoadingCentralEmail, setIsLoadingCentralEmail] = useState(false);
  const [isSavingCentralEmail, setIsSavingCentralEmail] = useState(false);
  const [isDeletingCentralEmail, setIsDeletingCentralEmail] = useState(false);
  const [centralEmailNotice, setCentralEmailNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const aiModelOptions: Record<string, string[]> = {
    gemini: [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemini-2.0-pro',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ],
    openai: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o3-mini',
      'o1-mini'
    ],
    claude: [
      'claude-3.7-sonnet',
      'claude-3.5-sonnet',
      'claude-3.5-haiku',
      'claude-3-opus'
    ]
  };

  const tabs = useMemo(
    () => [
      { key: 'tenants' as const, label: adminCopy.tenantsTabLabel || 'Tenants' },
      { key: 'platformUsers' as const, label: adminCopy.platformUsersTabLabel || 'Platform users' },
      { key: 'logs' as const, label: adminCopy.logsTab || adminCopy.logsTitle },
      { key: 'settings' as const, label: adminCopy.settingsTabLabel || 'Settings' }
    ],
    [adminCopy]
  );

  const planOptions = useMemo(
    () => [
      { value: 'basic', label: adminCopy.planLabels?.basic || 'Basic' },
      { value: 'pro', label: adminCopy.planLabels?.pro || 'Pro' },
      { value: 'enterprise', label: adminCopy.planLabels?.enterprise || 'Enterprise' }
    ],
    [adminCopy]
  );

  const statusOptions = useMemo(
    () => [
      { value: 'active', label: adminCopy.statusLabels?.active || 'Active' },
      { value: 'suspended', label: adminCopy.statusLabels?.suspended || 'Suspended' },
      { value: 'deleted', label: adminCopy.statusLabels?.deleted || 'Deleted' }
    ],
    [adminCopy]
  );

  const filteredTenants = useMemo(() => {
    if (!filter) return tenants;
    const query = filter.toLowerCase();
    return tenants.filter((tenant) =>
      tenant.subdomain.toLowerCase().includes(query) || tenant.companyName.toLowerCase().includes(query)
    );
  }, [tenants, filter]);

  const loadCoreData = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantsRes, logsRes, analyticsRes] = await Promise.all([
        fetch('/api/super-admin/tenants'),
        fetch('/api/super-admin/provisioning-logs'),
        fetch('/api/super-admin/analytics')
      ]);
      if (tenantsRes.ok) {
        setTenants(await tenantsRes.json());
      }
      if (logsRes.ok) {
        setLogs(await logsRes.json());
      }
      if (analyticsRes.ok) {
        setAnalytics(await analyticsRes.json());
      }
    } catch (error) {
      console.warn('Failed to load super admin data', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTenantUsers = useCallback(async (tenantId: string) => {
    setTenantUsersLoading(true);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/users?limit=100`);
      if (res.ok) {
        const payload = await res.json();
        setTenantUsers(
          Array.isArray(payload)
            ? payload.map((entry: any) => ({
                id: entry.id,
              publicUserId: entry.public_user_id || null,
                email: entry.email,
                name: entry.name,
                role: entry.role,
                status: entry.status,
                last_active: entry.last_active,
                join_date: entry.join_date,
                platformUserId: entry.platform_user_id || null,
                assignmentRole: entry.assignment_role || null,
                assignmentStatus: entry.assignment_status || null,
                assignmentId: entry.assignment_id || null,
                assignmentCreatedAt: entry.assignment_created_at || null
              }))
            : []
        );
      }
    } catch (error) {
      console.warn('Failed to load tenant users', error);
    } finally {
      setTenantUsersLoading(false);
    }
  }, []);

  const loadTenantPayments = useCallback(async (tenantId: string) => {
    setTenantPaymentsLoading(true);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}/payments?limit=50`);
      if (res.ok) {
        setTenantPayments(await res.json());
      }
    } catch (error) {
      console.warn('Failed to load tenant payments', error);
    } finally {
      setTenantPaymentsLoading(false);
    }
  }, []);

  const loadPlatformUsers = useCallback(
    async (search: string, role: string | undefined) => {
      setPlatformUsersLoading(true);
      try {
        const params = new URLSearchParams();
        if (search) params.set('q', search);
        if (role) params.set('role', role);
        const res = await fetch(`/api/super-admin/platform-users?${params.toString()}`);
        if (res.ok) {
          const payload = await res.json();
          setPlatformUsers(
            Array.isArray(payload)
              ? payload.map((entry: any) => ({
                  id: entry.id,
                  publicUserId: entry.public_user_id || null,
                  email: entry.email,
                  name: entry.name,
                  role: entry.role,
                  status: entry.status,
                  last_active: entry.last_active,
                  join_date: entry.join_date
                }))
              : []
          );
        }
      } catch (error) {
        console.warn('Failed to load platform users', error);
      } finally {
        setPlatformUsersLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    loadCoreData();
  }, [loadCoreData]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    setIsLoadingCentralEmail(true);
    fetch('/api/central/live-platform-config', { credentials: 'include' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data) return;
        setCentralLivePlatformForm({
          smrrtxEnabled: Boolean(data.smrrtxEnabled ?? true),
          smrrtxPermanentRoomLink: data.smrrtxPermanentRoomLink || '',
          zoomEnabled: Boolean(data.zoomEnabled),
          zoomConfigLink: data.zoomConfigLink || '',
          zoomClientId: data.zoomClientId || '',
          zoomClientSecret: data.zoomClientSecret || '',
          zoomAccountId: data.zoomAccountId || '',
          zoomUserId: data.zoomUserId || '',
          meetEnabled: Boolean(data.meetEnabled),
          meetConfigLink: data.meetConfigLink || '',
          googleSaEmail: data.googleSaEmail || '',
          googleSaKey: data.googleSaKey || '',
          googleCalendarId: data.googleCalendarId || ''
        });
      })
      .catch(() => null);

    fetch('/api/tenant/email-settings', { credentials: 'include' })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || 'Unable to load email settings');
        }
        setCentralEmailForm({
          smtpHost: payload?.smtpHost || '',
          smtpPort: String(payload?.smtpPort || 587),
          smtpUser: payload?.smtpUser || '',
          smtpPass: '',
          smtpFrom: payload?.smtpFrom || '',
          smtpSecure: Boolean(payload?.smtpSecure)
        });
        setCentralEmailMeta({
          hasPassword: Boolean(payload?.hasPassword),
          updatedAt: payload?.updatedAt || null
        });
      })
      .catch((error: any) => {
        setCentralEmailNotice({ type: 'error', text: error?.message || 'Unable to load email settings' });
      })
      .finally(() => {
        setIsLoadingCentralEmail(false);
      });
  }, [activeTab]);

  useEffect(() => {
    if (!selectedTenantId) return;
    const match = tenants.find((tenant) => tenant.id === selectedTenantId);
    if (match) {
      setSelectedTenant((current) => ({ ...match, payments: current?.payments || match.payments }));
    }
  }, [tenants, selectedTenantId]);

  useEffect(() => {
    if (activeTab !== 'platformUsers') return;
    const handle = setTimeout(() => {
      const roleParam = platformRoleFilter === 'ALL' ? undefined : platformRoleFilter;
      loadPlatformUsers(platformUserFilter.trim(), roleParam);
    }, 350);
    return () => clearTimeout(handle);
  }, [activeTab, platformUserFilter, platformRoleFilter, loadPlatformUsers]);

  useEffect(() => {
    if (!showAssignModal) {
      setAssignResults([]);
      setAssignSearching(false);
      return;
    }
    if (!assignForm.search.trim()) {
      setAssignResults([]);
      setAssignSearching(false);
      return;
    }
    const handle = setTimeout(async () => {
      setAssignSearching(true);
      try {
        const params = new URLSearchParams();
        params.set('q', assignForm.search.trim());
        const res = await fetch(`/api/super-admin/platform-users?${params.toString()}`);
        if (res.ok) {
          setAssignResults(await res.json());
        }
      } catch (error) {
        console.warn('Assign search failed', error);
      } finally {
        setAssignSearching(false);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [assignForm.search, showAssignModal]);

  const handleSelectTenant = async (tenantId: string) => {
    setSelectedTenantId(tenantId);
    try {
      const res = await fetch(`/api/super-admin/tenants/${tenantId}`);
      if (res.ok) {
        const detail = await res.json();
        setSelectedTenant(detail);
        setEditForm({
          companyName: detail.companyName || '',
          subdomain: detail.subdomain || '',
          plan: detail.subscription?.plan || detail.subscriptionPlan || 'basic',
          primaryAdminEmail: detail.primaryAdmin?.email || '',
          status: detail.status || 'active'
        });
      }
    } catch (error) {
      console.warn('Failed to fetch tenant details', error);
    }
    loadTenantUsers(tenantId);
    loadTenantPayments(tenantId);
  };

  const handleCreateTenant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateLoading(true);
    setBanner(null);
    try {
      const payload = {
        companyName: createForm.companyName.trim(),
        subdomain: createForm.subdomain.trim().toLowerCase(),
        subscriptionPlan: createForm.plan,
        adminEmail: createForm.adminEmail.trim(),
        adminFirstName: createForm.adminFirstName.trim() || undefined,
        adminLastName: createForm.adminLastName.trim() || undefined,
        adminPhone: createForm.adminPhone.trim() || undefined
      };
      const res = await fetch('/api/super-admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || 'create_failed');
      }
      const tenant: TenantSummary = await res.json();
      setBanner({ type: 'success', message: adminCopy.notices?.created || 'Tenant created successfully.' });
      setShowCreateModal(false);
      setCreateForm({ companyName: '', subdomain: '', plan: 'basic', adminEmail: '', adminFirstName: '', adminLastName: '', adminPhone: '' });
      await loadCoreData();
      if (tenant?.id) {
        handleSelectTenant(tenant.id);
      }
    } catch (error) {
      console.warn('Create tenant failed', error);
      setBanner({ type: 'error', message: adminCopy.errors?.createFailed || 'Unable to create tenant.' });
    } finally {
      setCreateLoading(false);
    }
  };

  const handleEditTenant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTenantId) return;
    setEditLoading(true);
    setBanner(null);
    try {
      const payload = {
        companyName: editForm.companyName.trim(),
        subdomain: editForm.subdomain.trim().toLowerCase(),
        subscriptionPlan: editForm.plan,
        primaryAdminEmail: editForm.primaryAdminEmail.trim(),
        status: editForm.status
      };
      const res = await fetch(`/api/super-admin/tenants/${selectedTenantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || 'update_failed');
      }
      const tenant: TenantSummary = await res.json();
      setBanner({ type: 'success', message: adminCopy.notices?.updated || 'Tenant updated successfully.' });
      setShowEditModal(false);
      await loadCoreData();
      setSelectedTenant(tenant);
    } catch (error) {
      console.warn('Update tenant failed', error);
      setBanner({ type: 'error', message: adminCopy.errors?.updateFailed || 'Unable to update tenant.' });
    } finally {
      setEditLoading(false);
    }
  };

  const mutateStatus = async (status: 'active' | 'suspended' | 'deleted') => {
    if (!selectedTenantId) return;
    if (status === 'deleted') {
      const confirmed = await confirm({
        title: (adminCopy.confirmations?.deleteTenant || 'Deleting this tenant will remove their subdomain in cPanel. Continue?').replace('{subdomain}', selectedTenant?.subdomain || ''),
        confirmText: adminCopy.confirm || 'Confirm',
        cancelText: adminCopy.cancel || 'Cancel'
      });
      if (!confirmed) return;
    }
    try {
      const method = status === 'deleted' ? 'DELETE' : 'PATCH';
      const endpoint = status === 'deleted'
        ? `/api/super-admin/tenants/${selectedTenantId}`
        : `/api/super-admin/tenants/${selectedTenantId}`;
      const options: RequestInit = { method };
      if (status !== 'deleted') {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify({ status });
      }
      const res = await fetch(endpoint, options);
      if (!res.ok && status !== 'deleted') {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || 'status_failed');
      }
      if (status !== 'deleted') {
        setSelectedTenant(await res.json());
      } else {
        setSelectedTenant(null);
        setSelectedTenantId(null);
      }
      await loadCoreData();
      setBanner({ type: 'success', message: adminCopy.notices?.statusUpdated || 'Status updated.' });
    } catch (error) {
      console.warn('Status change failed', error);
      setBanner({ type: 'error', message: adminCopy.errors?.statusFailed || 'Unable to update status.' });
    }
  };

  const handleHardDelete = async () => {
    if (!selectedTenantId || !selectedTenant) return;
    
    const hardDeleteCopy = adminCopy.hardDelete || {
      warningTitle: '⚠️ WARNING: PERMANENT DELETION ⚠️',
      warningMessage: 'This will PERMANENTLY delete tenant "{subdomain}" including:\n- Drop tenant database (cannot be recovered)\n- Delete all uploaded files\n- Archive central records (90 day retention)\n\nType "DELETE {subdomain}" to confirm:',
      confirmationPrefix: 'DELETE ',
      cancelled: 'Hard delete cancelled - confirmation text did not match.',
      success: 'Tenant permanently deleted. Database dropped: {databaseDropped}, Files deleted: {filesDeleted}',
      successWithWarnings: 'Tenant permanently deleted. Database dropped: {databaseDropped}, Files deleted: {filesDeleted}\n\nWarnings:\n{warnings}',
      failed: 'Hard delete failed: {error}'
    };
    
    const confirmMessage = hardDeleteCopy.warningTitle + '\n\n' +
      hardDeleteCopy.warningMessage
        .replace('{subdomain}', selectedTenant.subdomain)
        .replace('{subdomain}', selectedTenant.subdomain);
    
    const expectedConfirmation = hardDeleteCopy.confirmationPrefix + selectedTenant.subdomain;
    const userInput = await prompt({
      title: hardDeleteCopy.title,
      message: confirmMessage,
      placeholder: expectedConfirmation,
      confirmText: hardDeleteCopy.confirmButton || 'Delete',
      cancelText: hardDeleteCopy.cancelButton || 'Cancel'
    });
    
    if (userInput !== expectedConfirmation) {
      setBanner({ type: 'error', message: hardDeleteCopy.cancelled });
      return;
    }
    
    setBanner(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${selectedTenantId}/hard-delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dropDatabase: true,
          deleteFiles: true,
          archiveCentralRecords: true,
          retentionDays: 90
        })
      });
      
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.message || errorBody.error || 'hard_delete_failed');
      }
      
      const result = await res.json();
      
      let message;
      if (result.warnings && result.warnings.length > 0) {
        message = hardDeleteCopy.successWithWarnings
          .replace('{databaseDropped}', result.result.databaseDropped)
          .replace('{filesDeleted}', result.result.filesDeleted)
          .replace('{warnings}', result.warnings.join('\n'));
      } else {
        message = hardDeleteCopy.success
          .replace('{databaseDropped}', result.result.databaseDropped)
          .replace('{filesDeleted}', result.result.filesDeleted);
      }
      
      setBanner({ type: 'success', message });
      setSelectedTenant(null);
      setSelectedTenantId(null);
      await loadCoreData();
    } catch (error) {
      console.error('Hard delete failed', error);
      setBanner({ type: 'error', message: hardDeleteCopy.failed.replace('{error}', (error as Error).message) });
    }
  };

  const openAssignModal = () => {
    setAssignForm({ search: '', selectedUserId: null, role: 'STUDENT' });
    setAssignResults([]);
    setShowAssignModal(true);
  };

  const handleAssignSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedTenantId || !assignForm.selectedUserId) {
      return;
    }
    setAssignLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/super-admin/tenants/${selectedTenantId}/users/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platformUserId: assignForm.selectedUserId,
          role: assignForm.role
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'assign_failed');
      }
      setBanner({ type: 'success', message: adminCopy.notices?.assigned || 'User assigned to tenant.' });
      setShowAssignModal(false);
      await loadTenantUsers(selectedTenantId);
    } catch (error) {
      console.warn('Assign user failed', error);
      setBanner({ type: 'error', message: adminCopy.errors?.assignFailed || 'Unable to assign user.' });
    } finally {
      setAssignLoading(false);
    }
  };

  const handleRevokeUser = async (platformUserId: string) => {
    if (!selectedTenantId) return;
    const confirmed = await confirm({
      title: (adminCopy.confirmations?.revokeUser || 'Revoke this user from the tenant?'),
      confirmText: adminCopy.confirm || 'Confirm',
      cancelText: adminCopy.cancel || 'Cancel'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/super-admin/tenants/${selectedTenantId}/users/${platformUserId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'revoke_failed');
      }
      setBanner({ type: 'success', message: adminCopy.notices?.revoked || 'User access revoked.' });
      await loadTenantUsers(selectedTenantId);
    } catch (error) {
      console.warn('Revoke user failed', error);
      setBanner({ type: 'error', message: adminCopy.errors?.revokeFailed || 'Unable to revoke user.' });
    }
  };

  // Refund Handlers
  const handleOpenRefundModal = async (payment: TenantPayment) => {
    setRefundingPayment(payment);
    setRefundAmount('');
    setRefundReason('requested_by_customer');
    setRefundEligibility(null);
    setShowRefundModal(true);
    setRefundCheckLoading(true);

    try {
      const res = await fetch(`/api/super-admin/payments/${payment.id}/refund-check`);
      if (res.ok) {
        const eligibility = await res.json();
        setRefundEligibility(eligibility);
        if (eligibility.maxRefundAmount) {
          setRefundAmount(eligibility.maxRefundAmount.toFixed(2));
        }
      } else {
        setRefundEligibility({ canRefund: false, reason: 'Failed to check refund eligibility' });
      }
    } catch (error) {
      console.warn('Failed to check refund eligibility', error);
      setRefundEligibility({ canRefund: false, reason: 'Failed to check refund eligibility' });
    } finally {
      setRefundCheckLoading(false);
    }
  };

  const handleCloseRefundModal = () => {
    setShowRefundModal(false);
    setRefundingPayment(null);
    setRefundEligibility(null);
    setRefundAmount('');
    setRefundReason('requested_by_customer');
  };

  const handleProcessRefund = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!refundingPayment || !refundEligibility?.canRefund) return;

    const amountNum = parseFloat(refundAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setBanner({ type: 'error', message: adminCopy.refund?.invalidAmount || 'Please enter a valid refund amount.' });
      return;
    }

    if (amountNum > (refundEligibility.maxRefundAmount || 0)) {
      setBanner({ type: 'error', message: adminCopy.refund?.amountExceedsMax || 'Refund amount exceeds maximum refundable.' });
      return;
    }

    const confirmed = await confirm({
      title: `${adminCopy.refund?.confirmTitle || 'Process Refund'}: ${formatCurrency(amountNum, refundingPayment.currency)}`,
      confirmText: adminCopy.refund?.processButton || 'Process Refund',
      cancelText: adminCopy.cancel || 'Cancel'
    });
    if (!confirmed) return;

    setRefundLoading(true);
    try {
      const res = await fetch(`/api/super-admin/payments/${refundingPayment.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountNum,
          reason: refundReason
        })
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Refund failed');
      }

      setBanner({ type: 'success', message: adminCopy.refund?.successMessage || 'Refund processed successfully.' });
      handleCloseRefundModal();
      
      // Reload payments to show updated status
      if (selectedTenant) {
        await loadTenantPayments(selectedTenant.id);
      }
    } catch (error: any) {
      console.warn('Process refund failed', error);
      setBanner({ type: 'error', message: error.message || adminCopy.refund?.errorMessage || 'Failed to process refund.' });
    } finally {
      setRefundLoading(false);
    }
  };

  const handleCancelSubscription = async (cancelAtPeriodEnd: boolean) => {
    if (!selectedTenant) return;

    const confirmMessage = cancelAtPeriodEnd
      ? (adminCopy.confirmations?.cancelSubscriptionPeriodEnd ||
          'Cancel this subscription at the end of the current billing period?')
      : (adminCopy.confirmations?.cancelSubscriptionNow ||
          'Cancel this subscription immediately? Access will be revoked right away.');

    const confirmed = await confirm({
      title: adminCopy.confirmations?.cancelSubscriptionTitle || 'Cancel Subscription',
      message: confirmMessage,
      confirmText: adminCopy.confirm || 'Confirm',
      cancelText: adminCopy.cancel || 'Cancel',
      type: cancelAtPeriodEnd ? 'warning' : 'danger'
    });

    if (!confirmed) return;

    setCancelSubscriptionLoading(true);
    try {
      const res = await fetch(`/api/super-admin/tenants/${selectedTenant.id}/subscription/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelAtPeriodEnd })
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || 'Cancel subscription failed');
      }

      if (payload?.tenant) {
        setSelectedTenant(payload.tenant);
      }

      setBanner({
        type: 'success',
        message: payload?.message || (cancelAtPeriodEnd
          ? 'Subscription cancellation scheduled.'
          : 'Subscription cancelled immediately.')
      });

      await loadCoreData();
      await loadTenantPayments(selectedTenant.id);
    } catch (error: any) {
      console.warn('Cancel subscription failed', error);
      setBanner({ type: 'error', message: error.message || 'Unable to cancel subscription.' });
    } finally {
      setCancelSubscriptionLoading(false);
    }
  };

  // Central Live Platform Config Handler
  const handleSaveCentralLivePlatformConfig = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!centralLivePlatformForm.smrrtxEnabled && !centralLivePlatformForm.zoomEnabled && !centralLivePlatformForm.meetEnabled) {
      setCentralLiveNotice({ type: 'error', text: 'At least one platform must remain enabled.' });
      return;
    }
    setIsSavingCentralLive(true);
    setCentralLiveNotice(null);
    try {
      const response = await fetch('/api/central/live-platform-config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(centralLivePlatformForm)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to update live platform settings');
      }
      setCentralLivePlatformForm({
        smrrtxEnabled: Boolean(payload.smrrtxEnabled ?? true),
        smrrtxPermanentRoomLink: payload.smrrtxPermanentRoomLink || '',
        zoomEnabled: Boolean(payload.zoomEnabled),
        zoomConfigLink: payload.zoomConfigLink || '',
        zoomClientId: payload.zoomClientId || '',
        zoomClientSecret: payload.zoomClientSecret || '',
        zoomAccountId: payload.zoomAccountId || '',
        zoomUserId: payload.zoomUserId || '',
        meetEnabled: Boolean(payload.meetEnabled),
        meetConfigLink: payload.meetConfigLink || '',
        googleSaEmail: payload.googleSaEmail || '',
        googleSaKey: payload.googleSaKey || '',
        googleCalendarId: payload.googleCalendarId || ''
      });
      setCentralLiveNotice({ type: 'success', text: 'Live platform settings updated.' });
    } catch (error) {
      setCentralLiveNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Unable to update live platform settings'
      });
    } finally {
      setIsSavingCentralLive(false);
    }
  };

  const handleSaveCentralEmailSettings = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setIsSavingCentralEmail(true);
    setCentralEmailNotice(null);
    try {
      const response = await fetch('/api/tenant/email-settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: centralEmailForm.smtpHost,
          smtpPort: Number.parseInt(centralEmailForm.smtpPort, 10) || 587,
          smtpUser: centralEmailForm.smtpUser,
          smtpPass: centralEmailForm.smtpPass,
          smtpFrom: centralEmailForm.smtpFrom,
          smtpSecure: centralEmailForm.smtpSecure
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to update email settings');
      }
      setCentralEmailForm((prev) => ({
        ...prev,
        smtpHost: payload?.smtpHost || prev.smtpHost,
        smtpPort: String(payload?.smtpPort || prev.smtpPort || 587),
        smtpUser: payload?.smtpUser || prev.smtpUser,
        smtpFrom: payload?.smtpFrom || prev.smtpFrom,
        smtpSecure: Boolean(payload?.smtpSecure),
        smtpPass: ''
      }));
      setCentralEmailMeta({
        hasPassword: Boolean(payload?.hasPassword),
        updatedAt: payload?.updatedAt || null
      });
      setCentralEmailNotice({ type: 'success', text: emailCopy.messages?.saveSuccess || 'Email SMTP settings updated.' });
    } catch (error) {
      setCentralEmailNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (emailCopy.messages?.saveError || 'Unable to update email settings')
      });
    } finally {
      setIsSavingCentralEmail(false);
    }
  };

  const handleDeleteCentralEmailSettings = async () => {
    const confirmed = await confirm(emailCopy.deleteConfirm || 'Delete SMTP settings?');
    if (!confirmed) return;

    setIsDeletingCentralEmail(true);
    setCentralEmailNotice(null);
    try {
      const response = await fetch('/api/tenant/email-settings', {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Unable to delete email settings');
      }
      setCentralEmailForm({
        smtpHost: '',
        smtpPort: '587',
        smtpUser: '',
        smtpPass: '',
        smtpFrom: '',
        smtpSecure: false
      });
      setCentralEmailMeta({
        hasPassword: false,
        updatedAt: null
      });
      setCentralEmailNotice({ type: 'success', text: emailCopy.messages?.deleteSuccess || 'Email SMTP settings deleted successfully.' });
    } catch (error) {
      setCentralEmailNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (emailCopy.messages?.deleteError || 'Unable to delete email settings')
      });
    } finally {
      setIsDeletingCentralEmail(false);
    }
  };

  // AI Configuration Handlers
  const handleSaveAIConfig = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmedApiKey = aiConfigForm.apiKey.trim();
    const resolvedAiEnabled = aiConfigForm.aiEnabled || Boolean(trimmedApiKey);
    if (resolvedAiEnabled && !trimmedApiKey) {
      setAiNotice({
        type: 'error',
        text: aiCopy.messages?.keyRequired || 'API Key is required when AI is enabled'
      });
      return;
    }
    setIsSavingAIConfig(true);
    setAiNotice(null);
    try {
      const response = await fetch('/api/super-admin/ai-config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiEnabled: resolvedAiEnabled,
          aiProvider: aiConfigForm.aiProvider,
          aiModel: aiConfigForm.aiModel.trim(),
          apiKey: trimmedApiKey,
          maxTokens: aiConfigForm.maxTokens,
          temperature: aiConfigForm.temperature
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to update AI configuration');
      }
      resetAIConfigCache();
      await fetchResolvedAIConfig(true).catch(() => null);
      setAiConfigForm((prev) => ({
        ...prev,
        aiEnabled: resolvedAiEnabled,
        apiKey: trimmedApiKey
      }));
      setAiNotice({ type: 'success', text: aiCopy.messages?.saveSuccess || 'AI configuration updated successfully.' });
    } catch (error) {
      setAiNotice({
        type: 'error',
        text: error instanceof Error ? error.message : aiCopy.messages?.saveError || 'Unable to update AI configuration'
      });
    } finally {
      setIsSavingAIConfig(false);
    }
  };

  const handleTestAIConfig = async () => {
    if (!aiConfigForm.apiKey.trim()) {
      setAiNotice({
        type: 'error',
        text: aiCopy.messages?.testKeyRequired || 'API Key is required for testing'
      });
      return;
    }
    setIsTestingAI(true);
    setAiNotice(null);
    try {
      const response = await fetch('/api/super-admin/ai-config/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: aiConfigForm.apiKey.trim(),
          provider: aiConfigForm.aiProvider,
          model: aiConfigForm.aiModel.trim()
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || 'AI connection test failed');
      }
      setAiNotice({ 
        type: 'success', 
        text: aiCopy.messages?.testSuccess || 'AI connection test successful!' 
      });
    } catch (error) {
      setAiNotice({
        type: 'error',
        text: error instanceof Error ? error.message : aiCopy.messages?.testError || 'AI connection test failed'
      });
    } finally {
      setIsTestingAI(false);
    }
  };

  // Load AI Config on mount
  useEffect(() => {
    const loadAIConfig = async () => {
      try {
        const response = await fetch('/api/super-admin/ai-config', { credentials: 'include' });
        if (response.ok) {
          const payload = await response.json();
          if (payload.success && payload.data) {
            setAiConfigForm({
              aiEnabled: payload.data.aiEnabled || false,
              aiProvider: payload.data.aiProvider || 'gemini',
              aiModel: payload.data.aiModel || 'gemini-2.5-flash',
              apiKey: '', // Never load the actual key for security
              maxTokens: payload.data.maxTokens || 4096,
              temperature: payload.data.temperature || 0.7
            });
          }
        }
      } catch (error) {
        console.error('Failed to load AI config:', error);
      }
    };
    loadAIConfig();
  }, []);

  const containerClass =
    variant === 'standalone'
      ? 'min-h-screen bg-white text-zinc-900'
      : 'bg-white text-zinc-900 rounded-2xl border border-zinc-200 shadow-sm';
  const innerClass =
    variant === 'standalone'
      ? 'max-w-6xl mx-auto px-4 py-12 space-y-8'
      : 'px-4 py-6 space-y-6';

  const renderStats = () => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4">
        <p className="text-sm text-zinc-500">{adminCopy.totalLabel}</p>
        <p className="text-2xl font-semibold">{analytics?.total_tenants ?? tenants.length}</p>
      </div>
      <div className="rounded-xl border border-zinc-100 bg-white p-4">
        <p className="text-sm text-zinc-500">{adminCopy.statusLabels?.active || 'Active'}</p>
        <p className="text-2xl font-semibold">{analytics?.active_tenants ?? '--'}</p>
      </div>
      <div className="rounded-xl border border-zinc-100 bg-white p-4">
        <p className="text-sm text-zinc-500">{adminCopy.statusLabels?.suspended || 'Suspended'}</p>
        <p className="text-2xl font-semibold">{analytics?.suspended_tenants ?? '--'}</p>
      </div>
      <div className="rounded-xl border border-zinc-100 bg-white p-4">
        <p className="text-sm text-zinc-500">{adminCopy.revenueLabel || 'Total revenue'}</p>
        <p className="text-2xl font-semibold">{formatCurrency(analytics?.total_revenue)}</p>
      </div>
    </div>
  );

  const renderTenantList = () => (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <input
          placeholder={adminCopy.searchPlaceholder}
          className="w-full lg:max-w-md border border-zinc-200 rounded-lg px-3 py-2"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 rounded-lg bg-red-900 text-white text-sm font-semibold"
          >
            {adminCopy.createTenant || 'Add tenant'}
          </button>
          <button
            onClick={loadCoreData}
            className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold"
          >
            {loading ? adminCopy.refreshing : adminCopy.refresh}
          </button>
        </div>
      </div>
      <div className="grid gap-3">
        {filteredTenants.map((tenant) => (
          <button
            key={tenant.id}
            onClick={() => handleSelectTenant(tenant.id)}
            className={`text-left rounded-xl border p-4 transition hover:border-red-200 ${
              tenant.id === selectedTenantId ? 'border-red-500 bg-red-50/60' : 'border-zinc-100 bg-white'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-wide text-red-500 font-semibold">{tenant.subdomain}</p>
                <p className="text-lg font-semibold">{tenant.companyName}</p>
                <p className="text-sm text-zinc-500">{tenant.subscriptionPlan}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusStyles[tenant.status] || 'bg-zinc-100 text-zinc-600'}`}>
                {adminCopy.statusLabels?.[tenant.status as 'active' | 'suspended' | 'deleted'] || tenant.status}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-zinc-500">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">{adminCopy.primaryAdminLabel || 'Primary admin'}</p>
                <p className="text-zinc-700">{tenant.primaryAdmin?.email || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-400">{adminCopy.paymentsLabel || 'Total payments'}</p>
                <p className="text-zinc-700">{formatCurrency(tenant.payments?.total || 0)}</p>
              </div>
            </div>
          </button>
        ))}
        {!filteredTenants.length && (
          <div className="rounded-xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
            {adminCopy.emptyTenants || 'No tenants match your search.'}
          </div>
        )}
      </div>
    </div>
  );

  const renderTenantDetails = () => {
    if (!selectedTenant) {
      return (
        <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
          {adminCopy.selectTenantPlaceholder || 'Select a tenant to view details.'}
        </div>
      );
    }
    const canCancelSubscription = Boolean(
      selectedTenant.subscription?.status && selectedTenant.subscription.status !== 'cancelled'
    );
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-red-500 font-semibold">{selectedTenant.subdomain}</p>
              <p className="text-xl font-semibold">{selectedTenant.companyName}</p>
              <p className="text-sm text-zinc-500">{selectedTenant.subscription?.plan || selectedTenant.subscriptionPlan}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowEditModal(true)}
                className="px-3 py-1.5 rounded-lg border border-zinc-200 text-sm font-semibold"
              >
                {adminCopy.editTenant || 'Edit'}
              </button>
              <button
                onClick={() => mutateStatus('deleted')}
                className="px-3 py-1.5 rounded-lg border border-rose-200 text-sm font-semibold text-rose-600"
              >
                {adminCopy.actions.delete}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => mutateStatus('suspended')}
              className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-sm font-semibold"
            >
              {adminCopy.actions.suspend}
            </button>
            <button
              onClick={() => mutateStatus('active')}
              className="px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 text-sm font-semibold"
            >
              {adminCopy.actions.reactivate}
            </button>
            <button
              onClick={handleHardDelete}
              className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
              title={adminCopy.hardDelete?.buttonTitle || 'Permanently delete tenant, database, and all files'}
            >
              🗑️ {adminCopy.actions?.hardDelete || 'Hard Delete (Permanent)'}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">{adminCopy.primaryAdminLabel || 'Primary admin'}</p>
              <p className="font-semibold">{selectedTenant.primaryAdmin?.name || '—'}</p>
              <p className="text-sm text-zinc-500">{selectedTenant.primaryAdmin?.email || '—'}</p>
            </div>
            <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3">
              <p className="text-xs uppercase tracking-wide text-zinc-400">{adminCopy.paymentsLabel || 'Payments'}</p>
              <p className="font-semibold">{formatCurrency(selectedTenant.payments?.total || 0)}</p>
              <p className="text-sm text-zinc-500">{selectedTenant.payments?.last ? formatDate(selectedTenant.payments.last.createdAt) : adminCopy.noPayments || 'No payments yet.'}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold">{adminCopy.paymentsTitle || 'Payment history'}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => loadTenantPayments(selectedTenant.id)}
                className="text-sm text-red-600 font-semibold"
              >
                {adminCopy.refresh}
              </button>
              {canCancelSubscription && (
                <button
                  onClick={() => handleCancelSubscription(true)}
                  disabled={cancelSubscriptionLoading}
                  className="px-3 py-1 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {adminCopy.confirmations?.cancelSubscriptionPeriodEndCta || 'Cancel at period end'}
                </button>
              )}
              {canCancelSubscription && (
                <button
                  onClick={() => handleCancelSubscription(false)}
                  disabled={cancelSubscriptionLoading}
                  className="px-3 py-1 rounded-lg border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50 transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {adminCopy.confirmations?.cancelSubscriptionNowCta || 'Cancel now'}
                </button>
              )}
            </div>
          </div>
          {tenantPaymentsLoading ? (
            <p className="text-sm text-zinc-500">{adminCopy.loadingLabel || 'Loading payments...'}</p>
          ) : tenantPayments.length ? (
            <div className="space-y-2">
              {tenantPayments.map((payment) => {
                const isStripePayment = payment.transaction_reference?.startsWith('pi_') || 
                                        payment.transaction_reference?.startsWith('cs_') ||
                                        payment.payment_method?.toLowerCase().includes('stripe');
                const canShowRefund = (payment.status === 'succeeded' || payment.status === 'completed') && 
                                      isStripePayment && 
                                      payment.refund_status !== 'full';
                
                return (
                  <div key={payment.id} className="rounded-xl border border-zinc-100 p-3 text-sm">
                    <div className="flex flex-wrap justify-between items-start gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{formatCurrency(Number(payment.amount), payment.currency)}</span>
                          {payment.refund_status === 'partial' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                              {adminCopy.refund?.partiallyRefunded || 'Partially Refunded'}
                            </span>
                          )}
                          {payment.refund_status === 'full' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                              {adminCopy.refund?.fullyRefunded || 'Fully Refunded'}
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-600">
                          {payment.status} • {payment.payment_method || '—'}
                        </div>
                        {payment.transaction_reference && (
                          <div className="text-xs text-zinc-500">{payment.transaction_reference}</div>
                        )}
                        {payment.refunded_amount && Number(payment.refunded_amount) > 0 && (
                          <div className="text-xs text-amber-600 mt-1">
                            {adminCopy.refund?.refundedAmount || 'Refunded'}: {formatCurrency(Number(payment.refunded_amount), payment.currency)}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-zinc-500">{formatDate(payment.created_at)}</span>
                        {canShowRefund && (
                          <button
                            onClick={() => handleOpenRefundModal(payment)}
                            className="px-3 py-1 rounded-lg border border-amber-200 text-amber-700 text-xs font-semibold hover:bg-amber-50 transition"
                          >
                            {adminCopy.refund?.refundButton || 'Refund'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">{adminCopy.noPayments || 'No payments recorded yet.'}</p>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold">{adminCopy.usersTitle || 'Tenant users'}</p>
            <div className="flex gap-2">
              <button
                onClick={openAssignModal}
                className="px-3 py-1.5 rounded-lg bg-red-900 text-white text-sm font-semibold"
              >
                {adminCopy.assignUserCta || 'Assign user'}
              </button>
              <button onClick={() => loadTenantUsers(selectedTenant.id)} className="px-3 py-1.5 rounded-lg border border-zinc-200 text-sm font-semibold">
                {adminCopy.refresh}
              </button>
            </div>
          </div>
          {tenantUsersLoading ? (
            <p className="text-sm text-zinc-500">{adminCopy.loadingLabel || 'Loading users...'}</p>
          ) : tenantUsers.length ? (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {tenantUsers.map((user) => (
                <div key={user.id} className="rounded-xl border border-zinc-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{user.name}</p>
                      <p className="text-sm text-zinc-500">{user.email}</p>
                      <p className="text-xs text-zinc-500">
                        {adminCopy.tableHeaders?.userId || 'User ID'}: {user.publicUserId || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600">{user.role}</span>
                      {user.platformUserId && (
                        <button
                          onClick={() => handleRevokeUser(user.platformUserId as string)}
                          className="px-2 py-0.5 rounded-full text-xs font-semibold border border-rose-200 text-rose-600"
                        >
                          {adminCopy.revokeUser || 'Revoke'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 space-y-1">
                    <div>
                      {adminCopy.lastActiveLabel || 'Last active'}: {formatDate(user.last_active)}
                    </div>
                    {user.assignmentRole && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                          {adminCopy.assignmentBadge
                            ? adminCopy.assignmentBadge.replace('{role}', user.assignmentRole)
                            : `Assigned (${user.assignmentRole})`}
                        </span>
                        {user.assignmentCreatedAt && (
                          <span className="text-zinc-500">
                            {formatDate(user.assignmentCreatedAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">{adminCopy.noUsers || 'No users found for this tenant.'}</p>
          )}
        </div>
      </div>
    );
  };

  const renderPlatformUsers = () => (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          placeholder={adminCopy.platformUserSearchPlaceholder || 'Search by name, email, or user ID'}
          value={platformUserFilter}
          onChange={(e) => setPlatformUserFilter(e.target.value)}
          className="w-full sm:max-w-md border border-zinc-200 rounded-lg px-3 py-2"
        />
        <select
          value={platformRoleFilter}
          onChange={(e) => setPlatformRoleFilter(e.target.value as typeof platformRoleFilter)}
          className="border border-zinc-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="ALL">{adminCopy.roleFilterAll || 'All roles'}</option>
          <option value="STUDENT">{adminCopy.roleFilterStudent || 'Students'}</option>
          <option value="INSTRUCTOR">{adminCopy.roleFilterInstructor || 'Instructors'}</option>
          <option value="ADMIN">{adminCopy.roleFilterAdmin || 'Admins'}</option>
          <option value="SUPER_ADMIN">{adminCopy.roleFilterSuperAdmin || 'Super admins'}</option>
        </select>
      </div>
      {platformUsersLoading ? (
        <p className="text-sm text-zinc-500">{adminCopy.loadingLabel || 'Loading users...'}</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-100">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">{adminCopy.tableHeaders?.userId || 'User ID'}</th>
                <th className="px-4 py-2 text-left font-semibold">{adminCopy.tableHeaders?.name || 'Name'}</th>
                <th className="px-4 py-2 text-left font-semibold">{adminCopy.tableHeaders?.email || 'Email'}</th>
                <th className="px-4 py-2 text-left font-semibold">{adminCopy.tableHeaders?.role || 'Role'}</th>
                <th className="px-4 py-2 text-left font-semibold">{adminCopy.tableHeaders?.status || 'Status'}</th>
                <th className="px-4 py-2 text-left font-semibold">{adminCopy.tableHeaders?.lastActive || 'Last Active'}</th>
              </tr>
            </thead>
            <tbody>
              {platformUsers.map((user) => (
                <tr key={user.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-600">{user.publicUserId || '—'}</td>
                  <td className="px-4 py-2 font-semibold">{user.name}</td>
                  <td className="px-4 py-2 text-zinc-500">{user.email}</td>
                  <td className="px-4 py-2">{user.role}</td>
                  <td className="px-4 py-2">{user.status || '—'}</td>
                  <td className="px-4 py-2">{formatDate(user.last_active)}</td>
                </tr>
              ))}
              {!platformUsers.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    {adminCopy.noPlatformUsers || 'No users found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderSettings = () => (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{aiCopy.sectionTitle || 'AI Integration (Platform Level)'}</h3>
            <p className="text-sm text-zinc-500">{aiCopy.sectionDescription || 'Configure AI provider credentials for platform-level features on the main domain.'}</p>
          </div>
        </div>
        {aiNotice && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${aiNotice.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {aiNotice.text}
          </div>
        )}
        <form onSubmit={handleSaveAIConfig} className="space-y-6">
          <div className="border border-zinc-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h4 className="text-base font-semibold text-zinc-900">{aiCopy.title || 'AI Provider'}</h4>
                <p className="text-xs text-zinc-500">{aiCopy.description || 'Enable AI features for platform-level operations.'}</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600">
                <input
                  type="checkbox"
                  className="h-5 w-5 text-red-600 rounded"
                  checked={aiConfigForm.aiEnabled}
                  onChange={(e) => setAiConfigForm((prev) => ({ ...prev, aiEnabled: e.target.checked }))}
                />
                {aiCopy.toggleLabel || 'Enable AI'}
              </label>
            </div>
            {aiConfigForm.aiEnabled && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">{aiCopy.providerLabel || 'AI Provider'}</label>
                    <select
                      className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
                      value={aiConfigForm.aiProvider}
                      onChange={(e) => {
                        const nextProvider = e.target.value;
                        const nextModels = aiModelOptions[nextProvider] || [];
                        setAiConfigForm((prev) => ({
                          ...prev,
                          aiProvider: nextProvider,
                          aiModel: nextModels.includes(prev.aiModel) ? prev.aiModel : (nextModels[0] || '')
                        }));
                      }}
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="claude">Anthropic Claude</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">{aiCopy.modelLabel || 'Model'}</label>
                    <select
                      className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
                      value={aiConfigForm.aiModel}
                      onChange={(e) => setAiConfigForm((prev) => ({ ...prev, aiModel: e.target.value }))}
                    >
                      {(aiModelOptions[aiConfigForm.aiProvider] || []).map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">{aiCopy.apiKeyLabel || 'API Key'}</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowAIApiKey(!showAIApiKey)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-700 focus:outline-none z-10"
                    >
                      {showAIApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <input
                      type={showAIApiKey ? "text" : "password"}
                      className="appearance-none relative block w-full border border-zinc-300 rounded-lg pl-10 pr-3 p-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 focus:z-10"
                      value={aiConfigForm.apiKey}
                      onChange={(e) => setAiConfigForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                      placeholder={aiCopy.apiKeyPlaceholder || 'Enter your API key'}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">{aiCopy.apiKeyHint || 'Your API key is encrypted and stored securely.'}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">{aiCopy.maxTokensLabel || 'Max Tokens'}</label>
                    <input
                      type="number"
                      className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
                      value={aiConfigForm.maxTokens}
                      onChange={(e) => setAiConfigForm((prev) => ({ ...prev, maxTokens: parseInt(e.target.value) || 4096 }))}
                      min="1"
                      max="100000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">{aiCopy.temperatureLabel || 'Temperature'}</label>
                    <input
                      type="number"
                      className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
                      value={aiConfigForm.temperature}
                      onChange={(e) => setAiConfigForm((prev) => ({ ...prev, temperature: parseFloat(e.target.value) || 0.7 }))}
                      min="0"
                      max="2"
                      step="0.1"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-between items-center">
            <button
              type="button"
              onClick={handleTestAIConfig}
              disabled={isTestingAI || !aiConfigForm.aiEnabled}
              className="px-4 py-2 rounded-lg border border-zinc-300 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isTestingAI ? (aiCopy.testingLabel || 'Testing...') : (aiCopy.testCta || 'Test Connection')}
            </button>
            <button
              type="submit"
              disabled={isSavingAIConfig}
              className="bg-red-900 text-white px-6 py-2 rounded-lg font-bold hover:bg-red-950 disabled:opacity-60"
            >
              {isSavingAIConfig ? (aiCopy.savingLabel || 'Saving...') : (aiCopy.saveCta || 'Save AI Settings')}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-zinc-900">{emailCopy.centralTitle}</h3>
            <p className="text-sm text-zinc-500">{emailCopy.centralDescription}</p>
          </div>
          {centralEmailMeta.updatedAt && (
            <span className="text-xs text-zinc-500">{emailCopy.lastUpdated}: {formatDate(centralEmailMeta.updatedAt)}</span>
          )}
        </div>
        {centralEmailNotice && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${centralEmailNotice.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {centralEmailNotice.text}
          </div>
        )}
        {isLoadingCentralEmail && <p className="text-sm text-zinc-500">{emailCopy.loading}</p>}
        <form onSubmit={handleSaveCentralEmailSettings} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">{emailCopy.smtpHostLabel}</label>
              <input
                type="text"
                value={centralEmailForm.smtpHost}
                onChange={(e) => setCentralEmailForm((prev) => ({ ...prev, smtpHost: e.target.value }))}
                placeholder={emailCopy.smtpHostPlaceholder}
                className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">{emailCopy.smtpPortLabel}</label>
              <input
                type="number"
                min={1}
                max={65535}
                value={centralEmailForm.smtpPort}
                onChange={(e) => setCentralEmailForm((prev) => ({ ...prev, smtpPort: e.target.value }))}
                className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">{emailCopy.smtpUserLabel}</label>
              <input
                type="text"
                value={centralEmailForm.smtpUser}
                onChange={(e) => setCentralEmailForm((prev) => ({ ...prev, smtpUser: e.target.value }))}
                className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">{emailCopy.smtpFromLabel}</label>
              <input
                type="email"
                value={centralEmailForm.smtpFrom}
                onChange={(e) => setCentralEmailForm((prev) => ({ ...prev, smtpFrom: e.target.value }))}
                placeholder={emailCopy.smtpFromPlaceholder}
                className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-zinc-700 mb-1">
                {emailCopy.smtpPassLabel} {centralEmailMeta.hasPassword ? emailCopy.smtpPassHint : ''}
              </label>
              <input
                type="password"
                value={centralEmailForm.smtpPass}
                onChange={(e) => setCentralEmailForm((prev) => ({ ...prev, smtpPass: e.target.value }))}
                placeholder={centralEmailMeta.hasPassword ? '********' : emailCopy.smtpPassPlaceholder}
                className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300 text-red-600"
                  checked={centralEmailForm.smtpSecure}
                  onChange={(e) => setCentralEmailForm((prev) => ({ ...prev, smtpSecure: e.target.checked }))}
                />
                {emailCopy.smtpSecureLabel}
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            {centralEmailMeta.hasPassword && (
              <button
                type="button"
                onClick={handleDeleteCentralEmailSettings}
                disabled={isDeletingCentralEmail || isLoadingCentralEmail}
                className="bg-red-900 text-white px-6 py-2 rounded-lg font-bold hover:bg-red-950 disabled:opacity-60"
              >
                {isDeletingCentralEmail ? emailCopy.deletingLabel : emailCopy.deleteCta}
              </button>
            )}
            <button
              type="submit"
              disabled={isSavingCentralEmail || isLoadingCentralEmail}
              className="bg-zinc-900 text-white px-6 py-2 rounded-lg font-bold hover:bg-black disabled:opacity-60"
            >
              {isSavingCentralEmail ? emailCopy.savingLabel : emailCopy.saveCta}
            </button>
          </div>
        </form>
     </div>

      {/* Central Live Meeting Platforms */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6 space-y-5">
        <div>
          <h3 className="text-lg font-bold text-zinc-900">Live Meeting Platforms (Central Domain)</h3>
          <p className="text-sm text-zinc-500">Configure Zoom and Google Meet API credentials for the main platform domain. Tenant-specific credentials override these when set.</p>
        </div>
        {centralLiveNotice && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${centralLiveNotice.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {centralLiveNotice.text}
          </div>
        )}
        <form onSubmit={handleSaveCentralLivePlatformConfig} className="space-y-4">
          {/* Smrrtx */}
          <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 text-red-600 rounded"
                checked={centralLivePlatformForm.smrrtxEnabled}
                onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, smrrtxEnabled: e.target.checked }))}
              />
              <span className="text-sm font-semibold text-zinc-900">Smrrtx</span>
            </label>
            {centralLivePlatformForm.smrrtxEnabled && (
              <div className="ml-8">
                <label className="block text-sm font-medium text-zinc-700 mb-1">Permanent Room Link <span className="text-zinc-400 font-normal">(optional)</span></label>
                <input
                  type="url"
                  value={centralLivePlatformForm.smrrtxPermanentRoomLink}
                  onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, smrrtxPermanentRoomLink: e.target.value }))}
                  placeholder="https://live.smrrtx.com/room"
                  className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Zoom */}
          <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 text-red-600 rounded"
                checked={centralLivePlatformForm.zoomEnabled}
                onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, zoomEnabled: e.target.checked }))}
              />
              <span className="text-sm font-semibold text-zinc-900">Zoom</span>
            </label>
            {centralLivePlatformForm.zoomEnabled && (
              <div className="ml-8 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Setup Guide Link <span className="text-zinc-400 font-normal">(optional)</span></label>
                  <input type="url" value={centralLivePlatformForm.zoomConfigLink} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, zoomConfigLink: e.target.value }))} placeholder="https://zoom.us/..." className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                </div>
                <div className="border-t border-zinc-100 pt-3 space-y-3">
                  <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">API Credentials</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">Zoom Client ID</label>
                      <input type="text" value={centralLivePlatformForm.zoomClientId} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, zoomClientId: e.target.value }))} placeholder="Enter Client ID" className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">Zoom Client Secret</label>
                      <input type="text" value={centralLivePlatformForm.zoomClientSecret} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, zoomClientSecret: e.target.value }))} placeholder="Enter Client Secret" className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">Zoom Account ID</label>
                      <input type="text" value={centralLivePlatformForm.zoomAccountId} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, zoomAccountId: e.target.value }))} placeholder="Enter Account ID" className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">Zoom Host User ID / Email <span className="text-zinc-400 font-normal">(optional)</span></label>
                      <input type="text" value={centralLivePlatformForm.zoomUserId} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, zoomUserId: e.target.value }))} placeholder="me" className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Google Meet */}
          <div className="border border-zinc-200 rounded-xl p-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 text-red-600 rounded"
                checked={centralLivePlatformForm.meetEnabled}
                onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, meetEnabled: e.target.checked }))}
              />
              <span className="text-sm font-semibold text-zinc-900">Google Meet</span>
            </label>
            {centralLivePlatformForm.meetEnabled && (
              <div className="ml-8 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Setup Guide Link <span className="text-zinc-400 font-normal">(optional)</span></label>
                  <input type="url" value={centralLivePlatformForm.meetConfigLink} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, meetConfigLink: e.target.value }))} placeholder="https://support.google.com/..." className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                </div>
                <div className="border-t border-zinc-100 pt-3 space-y-3">
                  <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">API Credentials</p>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Google Service Account Email</label>
                    <input type="text" value={centralLivePlatformForm.googleSaEmail} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, googleSaEmail: e.target.value }))} placeholder="name@project.iam.gserviceaccount.com" className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Google Service Account Private Key</label>
                    <textarea rows={4} value={centralLivePlatformForm.googleSaKey} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, googleSaKey: e.target.value }))} placeholder={"-----BEGIN RSA PRIVATE KEY-----\n..."} className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none font-mono text-xs" />
                    <p className="text-xs text-zinc-400 mt-1">PEM private key from your service account JSON file.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Google Calendar ID</label>
                    <input type="text" value={centralLivePlatformForm.googleCalendarId} onChange={(e) => setCentralLivePlatformForm((prev) => ({ ...prev, googleCalendarId: e.target.value }))} placeholder="your-account@gmail.com" className="w-full border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-red-500 focus:outline-none" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-zinc-500">Changes take effect immediately for new meetings. Leave API credential fields empty to use server environment variables.</p>
          <div className="flex justify-end">
            <button type="submit" disabled={isSavingCentralLive} className="bg-zinc-900 text-white px-6 py-2 rounded-lg font-bold hover:bg-black disabled:opacity-60 flex items-center gap-2">
              {isSavingCentralLive && <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>}
              Save Platform Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{adminCopy.logsTitle}</h2>
        <button onClick={loadCoreData} className="text-sm text-red-600 font-semibold">
          {loading ? adminCopy.refreshing : adminCopy.refresh}
        </button>
      </div>
      <div className="space-y-2">
        {logs.slice(0, 40).map((log) => (
          <div key={log.id} className="p-3 rounded-xl border border-zinc-100 bg-white shadow-sm text-sm">
            <div className="flex justify-between">
              <span className="font-semibold">{log.subdomain || 'n/a'}</span>
              <span className="text-zinc-500">{log.status}</span>
            </div>
            <div className="text-zinc-600">{log.step}</div>
            {log.message && <div className="text-zinc-500 text-xs">{log.message}</div>}
          </div>
        ))}
      </div>
    </div>
  );

  const renderActiveTab = () => {
    if (activeTab === 'platformUsers') return renderPlatformUsers();
    if (activeTab === 'logs') return renderLogs();
    if (activeTab === 'settings') return renderSettings();
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {renderStats()}
          {renderTenantList()}
        </div>
        <div className="space-y-4">
          {renderTenantDetails()}
        </div>
      </div>
    );
  };

  const renderModal = (type: 'create' | 'edit') => {
    const isCreate = type === 'create';
    const isOpen = isCreate ? showCreateModal : showEditModal;
    if (!isOpen) return null;
    const formState = isCreate ? createForm : editForm;
    const setFormState = isCreate ? setCreateForm : setEditForm;
    const onSubmit = isCreate ? handleCreateTenant : handleEditTenant;
    const busy = isCreate ? createLoading : editLoading;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">{isCreate ? adminCopy.createTenant : adminCopy.editTenant}</h3>
            <button onClick={() => (isCreate ? setShowCreateModal(false) : setShowEditModal(false))} className="text-sm text-zinc-500">
              {adminCopy.cancelLabel || 'Cancel'}
            </button>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.companyName || 'Company name'}</label>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={formState.companyName}
                onChange={(e) => setFormState((prev) => ({ ...prev, companyName: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.subdomain || 'Subdomain'}</label>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={formState.subdomain}
                onChange={(e) => setFormState((prev) => ({ ...prev, subdomain: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.plan || 'Plan'}</label>
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={formState.plan}
                onChange={(e) => setFormState((prev) => ({ ...prev, plan: e.target.value }))}
              >
                {planOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.adminEmail || 'Admin email'}</label>
              <input
                type="email"
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={isCreate ? formState.adminEmail : formState.primaryAdminEmail}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    ...(isCreate ? { adminEmail: e.target.value } : { primaryAdminEmail: e.target.value })
                  }))
                }
                required
              />
            </div>
            {isCreate && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.adminFirstName || 'Admin first name'}</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                    value={createForm.adminFirstName}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, adminFirstName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.adminLastName || 'Admin last name'}</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                    value={createForm.adminLastName}
                    onChange={(e) => setCreateForm((prev) => ({ ...prev, adminLastName: e.target.value }))}
                  />
                </div>
              </div>
            )}
            {isCreate && (
              <div>
                <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.adminPhone || 'Admin phone'}</label>
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                  value={createForm.adminPhone}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, adminPhone: e.target.value }))}
                />
              </div>
            )}
            {!isCreate && (
              <div>
                <label className="text-sm font-semibold text-zinc-700">{adminCopy.form?.status || 'Status'}</label>
                <select
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                  value={editForm.status}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => (isCreate ? setShowCreateModal(false) : setShowEditModal(false))}
                className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold"
              >
                {adminCopy.cancelLabel || 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-red-900 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? adminCopy.processingLabel || 'Processing...' : isCreate ? adminCopy.form?.submitCreate || 'Create tenant' : adminCopy.form?.submitUpdate || 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const renderAssignModal = () => {
    if (!showAssignModal) return null;
    const close = () => {
      setShowAssignModal(false);
      setAssignForm({ search: '', selectedUserId: null, role: 'STUDENT' });
      setAssignResults([]);
    };
    const roleOptions: Array<'STUDENT' | 'INSTRUCTOR' | 'ADMIN'> = ['STUDENT', 'INSTRUCTOR', 'ADMIN'];
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
        <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">{adminCopy.assignUserTitle || 'Assign user to tenant'}</h3>
            <button onClick={close} className="text-sm text-zinc-500">
              {adminCopy.cancelLabel || 'Cancel'}
            </button>
          </div>
          <form onSubmit={handleAssignSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-semibold text-zinc-700">{adminCopy.assignSearchLabel || 'Search users'}</label>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                placeholder={adminCopy.assignSearchPlaceholder || 'Search by name or email'}
                value={assignForm.search}
                onChange={(e) => setAssignForm((prev) => ({ ...prev, search: e.target.value, selectedUserId: null }))}
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-zinc-100">
              {assignSearching ? (
                <div className="p-4 text-sm text-zinc-500">{adminCopy.assignSearching || 'Searching users...'}</div>
              ) : assignResults.length ? (
                <ul>
                  {assignResults.map((user) => (
                    <li key={user.id} className="border-b border-zinc-100 last:border-b-0">
                      <label className="flex items-center gap-3 px-4 py-3 cursor-pointer">
                        <input
                          type="radio"
                          name="assignUser"
                          value={user.id}
                          checked={assignForm.selectedUserId === user.id}
                          onChange={() => setAssignForm((prev) => ({ ...prev, selectedUserId: user.id }))}
                        />
                        <div>
                          <p className="font-semibold">{user.name}</p>
                          <p className="text-sm text-zinc-500">{user.email}</p>
                        </div>
                        <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-600">{user.role}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : assignForm.search ? (
                <div className="p-4 text-sm text-zinc-500">{adminCopy.assignNoResults || 'No users match your search.'}</div>
              ) : (
                <div className="p-4 text-sm text-zinc-500">{adminCopy.assignStartText || 'Search to find users to assign.'}</div>
              )}
            </div>
            <div>
              <label className="text-sm font-semibold text-zinc-700">{adminCopy.assignRoleLabel || 'Role in tenant'}</label>
              <select
                className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                value={assignForm.role}
                onChange={(e) => setAssignForm((prev) => ({ ...prev, role: e.target.value as typeof prev.role }))}
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={close} className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold">
                {adminCopy.cancelLabel || 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={assignLoading || !assignForm.selectedUserId}
                className="px-4 py-2 rounded-lg bg-red-900 text-white text-sm font-semibold disabled:opacity-50"
              >
                {assignLoading ? adminCopy.processingLabel || 'Processing...' : adminCopy.assignSubmit || 'Assign user'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Refund Modal
  const renderRefundModal = () => {
    if (!showRefundModal) return null;

    const reasonOptions = [
      { value: 'requested_by_customer', label: adminCopy.refund?.reasons?.customer || 'Requested by customer' },
      { value: 'duplicate', label: adminCopy.refund?.reasons?.duplicate || 'Duplicate payment' },
      { value: 'fraudulent', label: adminCopy.refund?.reasons?.fraudulent || 'Fraudulent' },
      { value: 'other', label: adminCopy.refund?.reasons?.other || 'Other' }
    ];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">{adminCopy.refund?.modalTitle || 'Process Refund'}</h2>
              {refundingPayment && (
                <p className="text-sm text-zinc-500 mt-1">
                  {adminCopy.refund?.originalPayment || 'Original payment'}: {formatCurrency(Number(refundingPayment.amount), refundingPayment.currency)}
                </p>
              )}
            </div>
            <button onClick={handleCloseRefundModal} className="text-zinc-400 hover:text-zinc-600">
              ✕
            </button>
          </div>

          {refundCheckLoading ? (
            <div className="py-8 text-center">
              <p className="text-sm text-zinc-500">{adminCopy.refund?.checkingEligibility || 'Checking refund eligibility...'}</p>
            </div>
          ) : refundEligibility && !refundEligibility.canRefund ? (
            <div className="py-6">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-center">
                <p className="text-rose-700 font-semibold">{adminCopy.refund?.notEligible || 'Cannot Refund'}</p>
                <p className="text-sm text-rose-600 mt-1">{refundEligibility.reason}</p>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleCloseRefundModal}
                  className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold"
                >
                  {adminCopy.close || 'Close'}
                </button>
              </div>
            </div>
          ) : refundEligibility?.canRefund ? (
            <form onSubmit={handleProcessRefund} className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                <p className="font-semibold">{adminCopy.refund?.eligibleMessage || 'This payment is eligible for refund'}</p>
                <p className="mt-1">
                  {adminCopy.refund?.maxRefundable || 'Maximum refundable'}: {formatCurrency(refundEligibility.maxRefundAmount || 0, refundingPayment?.currency || 'USD')}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-700">
                  {adminCopy.refund?.amountLabel || 'Refund Amount'} ({refundingPayment?.currency || 'USD'})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={refundEligibility.maxRefundAmount || 0}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                  placeholder={`0.00 - ${refundEligibility.maxRefundAmount?.toFixed(2)}`}
                  required
                />
                <p className="text-xs text-zinc-500 mt-1">
                  {adminCopy.refund?.amountHint || 'Enter full amount for complete refund, or partial amount'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-700">
                  {adminCopy.refund?.reasonLabel || 'Reason for Refund'}
                </label>
                <select
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2"
                >
                  {reasonOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                <p className="font-semibold">{adminCopy.refund?.warningTitle || 'Warning'}</p>
                <p className="mt-1">{adminCopy.refund?.warningMessage || 'This action will initiate a refund through Stripe. The refund may take 5-10 business days to appear on the customer\'s statement.'}</p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCloseRefundModal}
                  className="px-4 py-2 rounded-lg border border-zinc-200 text-sm font-semibold"
                >
                  {adminCopy.cancel || 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={refundLoading || !refundAmount}
                  className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold disabled:opacity-50 hover:bg-amber-700 transition"
                >
                  {refundLoading 
                    ? (adminCopy.refund?.processing || 'Processing...') 
                    : (adminCopy.refund?.processButton || 'Process Refund')}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        {banner && (
          <div className={`rounded-xl border p-3 text-sm ${banner.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            {banner.message}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-red-600 font-semibold">{adminCopy.badge}</p>
            <h1 className="text-3xl font-bold">{adminCopy.title}</h1>
          </div>
          <div className="inline-flex rounded-full border border-zinc-200 bg-white p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-semibold rounded-full transition ${
                  activeTab === tab.key ? 'bg-red-900 text-white shadow' : 'text-zinc-600 hover:text-red-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {renderActiveTab()}

        {renderModal('create')}
        {renderModal('edit')}
        {renderAssignModal()}
        {renderRefundModal()}
      </div>
    </div>
  );
};

export default SuperAdminDashboard;

