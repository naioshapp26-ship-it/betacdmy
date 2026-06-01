import React, { useEffect, useMemo, useState } from 'react';
import { Ad, AdAnnouncement, AdCategory, MediaGalleryItem } from '../types';
import { RefreshCw, Plus, Save } from 'lucide-react';
import MediaUpload from './MediaUpload';
import MediaGalleryManager from './MediaGalleryManager';
import useTenant from '../hooks/useTenant';

type AdsDisplaySettings = {
  heroTitle: string;
  heroSubtitle: string;
  searchPlaceholder: string;
  statAdsLabel: string;
  statUsersLabel: string;
  statSatisfactionLabel: string;
  statSupportLabel: string;
  statSupportValue: string;
  homepagePromoEnabled: boolean;
  homepagePromoType: 'image' | 'video';
  homepagePromoMediaUrl: string;
  homepagePromoLink: string;
  homepagePromoTitle: string;
  homepagePromoSubtitle: string;
};

const DEFAULT_SETTINGS: AdsDisplaySettings = {
  heroTitle: '',
  heroSubtitle: '',
  searchPlaceholder: '',
  statAdsLabel: '',
  statUsersLabel: '',
  statSatisfactionLabel: '',
  statSupportLabel: '',
  statSupportValue: '24/7',
  homepagePromoEnabled: false,
  homepagePromoType: 'image',
  homepagePromoMediaUrl: '',
  homepagePromoLink: '',
  homepagePromoTitle: '',
  homepagePromoSubtitle: ''
};

const EMPTY_AD: Partial<Ad> = {
  title: '',
  description: '',
  categoryId: '',
  price: null,
  location: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  imageUrl: '',
  mediaType: 'image',
  mediaUrl: '',
  gallery: [],
  status: 'DRAFT',
  isFeatured: false,
  publishDate: ''
};

const EMPTY_ANNOUNCEMENT: Partial<AdAnnouncement> = {
  textEn: '',
  textAr: '',
  enabled: true,
  showInTopBar: true,
  sortOrder: 0
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
          id: `ad_media_${index}_${Math.random().toString(36).slice(2, 7)}`,
          url: trimmed,
          mediaType: 'image' as const,
          order: index
        };
      }
      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      return {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `ad_media_${index}_${Math.random().toString(36).slice(2, 7)}`,
        url,
        mediaType: item.mediaType === 'video' ? 'video' : 'image',
        order: index
      };
    })
    .filter((item): item is MediaGalleryItem => Boolean(item));
};

const buildAdMediaFallback = (ad: Partial<Ad>): MediaGalleryItem[] => {
  const normalized = normalizeMediaGallery(ad.gallery);
  if (normalized.length > 0) {
    return normalized;
  }
  const imageUrl = (ad.imageUrl || '').trim();
  const videoUrl = (ad.mediaType === 'video' ? ad.mediaUrl : '').trim();
  const items: MediaGalleryItem[] = [];
  if (imageUrl) {
    items.push({ id: `ad_media_fallback_image_${Math.random().toString(36).slice(2, 7)}`, url: imageUrl, mediaType: 'image', order: items.length });
  }
  if (videoUrl) {
    items.push({ id: `ad_media_fallback_video_${Math.random().toString(36).slice(2, 7)}`, url: videoUrl, mediaType: 'video', order: items.length });
  }
  return items;
};

const AdsManagement: React.FC<{ t?: any; lang?: 'ar' | 'en' }> = ({ t, lang = 'en' }) => {
  const { isMainSite, subdomain } = useTenant();
  const [ads, setAds] = useState<Ad[]>([]);
  const [categories, setCategories] = useState<AdCategory[]>([]);
  const [announcements, setAnnouncements] = useState<AdAnnouncement[]>([]);
  const [settings, setSettings] = useState<AdsDisplaySettings>(DEFAULT_SETTINGS);
  const [editingAd, setEditingAd] = useState<Partial<Ad> | null>(null);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Partial<AdAnnouncement> | null>(null);
  const [isSavingAd, setIsSavingAd] = useState(false);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ADS' | 'ANNOUNCEMENTS' | 'CATEGORIES' | 'CUSTOMIZE'>('ADS');
  const [scopeInfo, setScopeInfo] = useState<{ scope: 'central' | 'tenant'; tenantName?: string | null; tenantSubdomain?: string | null } | null>(null);

  const getAccessToken = (): string | null => {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const savedUser = window.localStorage.getItem('betacademy_user');
      if (!savedUser) return null;
      const parsed = JSON.parse(savedUser);
      const token = typeof parsed?.accessToken === 'string' ? parsed.accessToken.trim() : '';
      return token || null;
    } catch {
      return null;
    }
  };

  const authFetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    const accessToken = getAccessToken();
    if (accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
    if (!headers.has('Accept-Language')) {
      headers.set('Accept-Language', lang === 'ar' ? 'ar' : 'en');
    }

    return fetch(input, {
      ...init,
      headers,
      credentials: init.credentials ?? 'include'
    });
  };

  const filteredAds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ads;
    return ads.filter((ad) =>
      ad.title.toLowerCase().includes(q) ||
      ad.description.toLowerCase().includes(q) ||
      (ad.categoryName || '').toLowerCase().includes(q)
    );
  }, [ads, searchQuery]);

  const loadData = async () => {
    setIsLoading(true);
    setNotice(null);
    try {
      const [adsResponse, categoriesResponse, settingsResponse, announcementsResponse, contextResponse] = await Promise.all([
        authFetch('/api/admin/ads'),
        authFetch('/api/admin/ads-categories'),
        authFetch('/api/admin/ads-display-settings'),
        authFetch('/api/admin/ads-announcements'),
        authFetch('/api/admin/ads-context')
      ]);
      const adsPayload = await adsResponse.json().catch(() => []);
      const categoriesPayload = await categoriesResponse.json().catch(() => []);
      const settingsPayload = await settingsResponse.json().catch(() => null);
      const announcementsPayload = await announcementsResponse.json().catch(() => []);
      const contextPayload = await contextResponse.json().catch(() => null);
      if (!adsResponse.ok || !categoriesResponse.ok || !settingsResponse.ok || !announcementsResponse.ok || !contextResponse.ok) {
        throw new Error(t?.adActionError || 'Unable to load ads management data.');
      }
      setAds(Array.isArray(adsPayload) ? adsPayload : []);
      setCategories(Array.isArray(categoriesPayload) ? categoriesPayload : []);
      setAnnouncements(Array.isArray(announcementsPayload) ? announcementsPayload : []);
      setSettings(settingsPayload ? { ...DEFAULT_SETTINGS, ...settingsPayload } : DEFAULT_SETTINGS);
      setScopeInfo(contextPayload);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to load ads management data.') });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const saveAd = async () => {
    if (!editingAd) return;
    if (!editingAd.title?.trim() || !editingAd.description?.trim()) {
      setNotice({ type: 'error', text: lang === 'ar' ? 'العنوان والوصف مطلوبان.' : 'Title and description are required.' });
      return;
    }
    setIsSavingAd(true);
    setNotice(null);
    try {
      const isUpdate = Boolean(editingAd.id);
      const mediaGallery = normalizeMediaGallery(editingAd.gallery);
      const persistedMediaGallery = mediaGallery
        .filter((item) => item.url.trim().length > 0)
        .map((item, index) => ({ ...item, order: index }));
      const firstImage = persistedMediaGallery.find((item) => item.mediaType === 'image');
      const firstVideo = persistedMediaGallery.find((item) => item.mediaType === 'video');
      const normalizedPayload: Partial<Ad> = {
        ...editingAd,
        gallery: persistedMediaGallery,
        imageUrl: firstImage?.url || '',
        mediaType: firstVideo ? 'video' : 'image',
        mediaUrl: firstVideo?.url || ''
      };
      const response = await authFetch(isUpdate ? `/api/admin/ads/${editingAd.id}` : '/api/admin/ads', {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedPayload)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to save ad.');
      }
      setNotice({ type: 'success', text: t?.adSavedSuccess || (lang === 'ar' ? 'تم حفظ الإعلان بنجاح.' : 'Ad saved successfully.') });
      setEditingAd(null);
      await loadData();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to save ad.') });
    } finally {
      setIsSavingAd(false);
    }
  };

  const saveAnnouncement = async () => {
    if (!editingAnnouncement) return;
    const textEn = (editingAnnouncement.textEn || '').trim();
    const textAr = (editingAnnouncement.textAr || '').trim();
    if (!textEn) {
      setNotice({
        type: 'error',
        text: t?.announcementTextEnRequired || (lang === 'ar' ? 'نص الإعلان المتحرك بالإنجليزية مطلوب.' : 'English announcement text is required.')
      });
      return;
    }
    if (!textAr) {
      setNotice({
        type: 'error',
        text: t?.announcementTextArRequired || (lang === 'ar' ? 'نص الإعلان المتحرك بالعربية مطلوب.' : 'Arabic announcement text is required.')
      });
      return;
    }
    if (textEn.length > 240 || textAr.length > 240) {
      setNotice({
        type: 'error',
        text: t?.announcementTextTooLong || (lang === 'ar' ? 'يجب ألا يزيد نص الإعلان عن 240 حرفاً.' : 'Announcement text must be 240 characters or less.')
      });
      return;
    }

    setIsSavingAnnouncement(true);
    setNotice(null);
    try {
      const isUpdate = Boolean(editingAnnouncement.id);
      const response = await authFetch(
        isUpdate ? `/api/admin/ads-announcements/${editingAnnouncement.id}` : '/api/admin/ads-announcements',
        {
          method: isUpdate ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textEn,
            textAr,
            enabled: editingAnnouncement.enabled ?? true,
            showInTopBar: editingAnnouncement.showInTopBar ?? true,
            sortOrder: editingAnnouncement.sortOrder ?? 0
          })
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.announcementActionError || 'Unable to save announcement.');
      }
      setNotice({
        type: 'success',
        text: t?.announcementSavedSuccess || (lang === 'ar' ? 'تم حفظ الإعلان المتحرك بنجاح.' : 'Announcement saved successfully.')
      });
      setEditingAnnouncement(null);
      await loadData();
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (t?.announcementActionError || 'Unable to save announcement.')
      });
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const removeAnnouncement = async (id: string) => {
    const confirmed = window.confirm(
      t?.deleteAnnouncementConfirm ||
      (lang === 'ar' ? 'هل أنت متأكد من حذف هذا الإعلان المتحرك؟' : 'Are you sure you want to delete this announcement?')
    );
    if (!confirmed) return;
    try {
      const response = await authFetch(`/api/admin/ads-announcements/${id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.announcementActionError || 'Unable to delete announcement.');
      }
      setNotice({
        type: 'success',
        text: t?.announcementDeletedSuccess || (lang === 'ar' ? 'تم حذف الإعلان المتحرك بنجاح.' : 'Announcement deleted successfully.')
      });
      await loadData();
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (t?.announcementActionError || 'Unable to delete announcement.')
      });
    }
  };

  const patchAnnouncement = async (announcement: AdAnnouncement, partial: Partial<AdAnnouncement>) => {
    const response = await authFetch(`/api/admin/ads-announcements/${announcement.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        textEn: partial.textEn ?? announcement.textEn ?? announcement.text,
        textAr: partial.textAr ?? announcement.textAr ?? announcement.text,
        enabled: partial.enabled ?? announcement.enabled,
        showInTopBar: partial.showInTopBar ?? announcement.showInTopBar,
        sortOrder: partial.sortOrder ?? announcement.sortOrder
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || t?.announcementActionError || 'Unable to update announcement.');
    }
  };

  const toggleAnnouncementField = async (announcement: AdAnnouncement, field: 'enabled' | 'showInTopBar') => {
    try {
      await patchAnnouncement(announcement, { [field]: !announcement[field] });
      await loadData();
      setNotice({
        type: 'success',
        text: t?.announcementUpdatedSuccess || (lang === 'ar' ? 'تم تحديث الإعلان المتحرك بنجاح.' : 'Announcement updated successfully.')
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (t?.announcementActionError || 'Unable to update announcement.')
      });
    }
  };

  const moveAnnouncement = async (announcement: AdAnnouncement, direction: 'up' | 'down') => {
    const sorted = [...announcements].sort((a, b) => (a.sortOrder - b.sortOrder) || ((a.createdAt || '').localeCompare(b.createdAt || '')));
    const index = sorted.findIndex((item) => item.id === announcement.id);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sorted.length) return;

    const current = sorted[index];
    const target = sorted[targetIndex];
    try {
      await Promise.all([
        patchAnnouncement(current, { sortOrder: target.sortOrder }),
        patchAnnouncement(target, { sortOrder: current.sortOrder })
      ]);
      await loadData();
      setNotice({
        type: 'success',
        text: t?.announcementOrderSaved || (lang === 'ar' ? 'تم تحديث ترتيب الإعلانات المتحركة.' : 'Announcement order updated.')
      });
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (t?.announcementActionError || 'Unable to update announcement order.')
      });
    }
  };

  const deleteAd = async (adId: string) => {
    const confirmed = window.confirm(t?.deleteAdConfirm || (lang === 'ar' ? 'هل أنت متأكد من حذف هذا الإعلان؟' : 'Are you sure you want to delete this ad?'));
    if (!confirmed) return;
    try {
      const response = await authFetch(`/api/admin/ads/${adId}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to delete ad.');
      }
      setNotice({ type: 'success', text: t?.adDeletedSuccess || (lang === 'ar' ? 'تم حذف الإعلان بنجاح.' : 'Ad deleted successfully.') });
      await loadData();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to delete ad.') });
    }
  };

  const publishAd = async (ad: Ad) => {
    const confirmed = window.confirm(t?.publishAdConfirm || (lang === 'ar' ? 'هل تريد نشر هذا الإعلان الآن؟' : 'Publish this ad now?'));
    if (!confirmed) return;
    try {
      const response = await authFetch(`/api/admin/ads/${ad.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PUBLISHED', publishDate: new Date().toISOString().slice(0, 10) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to publish ad.');
      }
      setNotice({ type: 'success', text: t?.adPublishSuccess || (lang === 'ar' ? 'تم نشر الإعلان بنجاح.' : 'Ad published successfully.') });
      await loadData();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to publish ad.') });
    }
  };

  const addCategory = async () => {
    const name = newCategory.trim();
    if (!name) {
      return;
    }
    try {
      const response = await authFetch('/api/admin/ads-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to create category.');
      }
      setNewCategory('');
      setNotice({ type: 'success', text: t?.categorySavedSuccess || (lang === 'ar' ? 'تم حفظ الفئة بنجاح.' : 'Category saved successfully.') });
      await loadData();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to create category.') });
    }
  };

  const startCategoryEdit = (category: AdCategory) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name || '');
    setNotice(null);
  };

  const cancelCategoryEdit = () => {
    setEditingCategoryId(null);
    setEditingCategoryName('');
  };

  const saveCategoryEdit = async () => {
    if (!editingCategoryId) return;
    const name = editingCategoryName.trim();
    if (!name) {
      setNotice({ type: 'error', text: lang === 'ar' ? 'اسم الفئة مطلوب.' : 'Category name is required.' });
      return;
    }
    setIsSavingCategory(true);
    setNotice(null);
    try {
      const response = await authFetch(`/api/admin/ads-categories/${editingCategoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to update category.');
      }
      setNotice({
        type: 'success',
        text: t?.categoryUpdatedSuccess || (lang === 'ar' ? 'تم تحديث الفئة بنجاح.' : 'Category updated successfully.')
      });
      cancelCategoryEdit();
      await loadData();
    } catch (error) {
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to update category.')
      });
    } finally {
      setIsSavingCategory(false);
    }
  };

  const deleteCategory = async (id: string) => {
    const confirmed = window.confirm(t?.categoryDeleteConfirm || (lang === 'ar' ? 'هل تريد حذف هذه الفئة؟' : 'Delete this category?'));
    if (!confirmed) return;
    try {
      const response = await authFetch(`/api/admin/ads-categories/${id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to delete category.');
      }
      setNotice({ type: 'success', text: t?.categoryDeletedSuccess || (lang === 'ar' ? 'تم حذف الفئة بنجاح.' : 'Category deleted successfully.') });
      await loadData();
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to delete category.') });
    }
  };

  const saveSettings = async () => {
    try {
      const response = await authFetch('/api/admin/ads-display-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t?.adActionError || 'Unable to save ads settings.');
      }
      setSettings({ ...DEFAULT_SETTINGS, ...payload });
      setNotice({ type: 'success', text: lang === 'ar' ? 'تم حفظ إعدادات الإعلانات بنجاح.' : 'Ads settings saved successfully.' });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : (t?.adActionError || 'Unable to save ads settings.') });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900">{t?.adsManagerTitle || 'Ads Management'}</h2>
          <p className="text-sm text-zinc-500">{t?.adsManagerSubtitle || 'Create, publish, edit, and organize educational marketplace ads.'}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {scopeInfo?.scope === 'tenant'
              ? (t?.adsScopeTenant || (lang === 'ar' ? `نطاق الإدارة: إعلانات المستأجر ${scopeInfo.tenantSubdomain ? `(${scopeInfo.tenantSubdomain})` : ''}` : `Scope: Tenant ads ${scopeInfo.tenantSubdomain ? `(${scopeInfo.tenantSubdomain})` : ''}`))
              : (t?.adsScopeCentral || (lang === 'ar' ? 'نطاق الإدارة: الدومين الرئيسي' : 'Scope: Central domain'))}
          </p>
        </div>
        <div className="flex gap-2">
          {(activeTab === 'ADS' || activeTab === 'ANNOUNCEMENTS') && (
            <button
              onClick={() => {
                if (activeTab === 'ANNOUNCEMENTS') {
                  const nextSort = announcements.length ? Math.max(...announcements.map((item) => item.sortOrder || 0)) + 1 : 0;
                  setEditingAnnouncement({ ...EMPTY_ANNOUNCEMENT, sortOrder: nextSort });
                  return;
                }
                setEditingAd({ ...EMPTY_AD });
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-red-900 text-white px-4 py-2 font-semibold hover:bg-red-950"
            >
              <Plus className="h-4 w-4" />
              {activeTab === 'ANNOUNCEMENTS'
                ? (t?.addAnnouncement || (lang === 'ar' ? 'إضافة إعلان متحرك' : 'Add Announcement'))
                : (t?.addAd || 'Add Ad')}
            </button>
          )}
          <button
            onClick={loadData}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 text-zinc-700 px-4 py-2 font-semibold hover:bg-zinc-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t?.refresh || 'Refresh'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 p-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => setActiveTab('ADS')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'ADS' ? 'bg-red-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            {lang === 'ar' ? 'الإعلانات' : 'Ads'}
          </button>
          <button
            onClick={() => setActiveTab('ANNOUNCEMENTS')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'ANNOUNCEMENTS' ? 'bg-red-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            {t?.announcementsTabLabel || (lang === 'ar' ? 'الشريط المتحرك' : 'Announcement Bar')}
          </button>
          <button
            onClick={() => setActiveTab('CATEGORIES')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'CATEGORIES' ? 'bg-red-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            {t?.manageAdCategories || (lang === 'ar' ? 'الفئات' : 'Categories')}
          </button>
          <button
            onClick={() => setActiveTab('CUSTOMIZE')}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === 'CUSTOMIZE' ? 'bg-red-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'}`}
          >
            {lang === 'ar' ? 'تخصيص /ads' : 'Customize /ads'}
          </button>
        </div>
      </div>

      {notice && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      {editingAd && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <h3 className="font-bold text-zinc-900">{editingAd.id ? (t?.editAd || 'Edit Ad') : (t?.addAd || 'Add Ad')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.title || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), title: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان الإعلان' : 'Ad title'} />
            <select className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.categoryId || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), categoryId: e.target.value }))}>
              <option value="">{lang === 'ar' ? 'اختر الفئة' : 'Select category'}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <textarea className="md:col-span-2 border border-zinc-300 rounded-lg p-2.5 min-h-[110px]" value={editingAd.description || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), description: e.target.value }))} placeholder={lang === 'ar' ? 'وصف الإعلان' : 'Ad description'} />
            <input className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.location || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), location: e.target.value }))} placeholder={t?.locationLabel || 'Location'} />
            <input type="number" className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.price ?? ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), price: e.target.value === '' ? null : Number(e.target.value) }))} placeholder={t?.priceLabel || 'Price'} />
            <input className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.contactName || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), contactName: e.target.value }))} placeholder={lang === 'ar' ? 'اسم جهة التواصل' : 'Contact name'} />
            <input className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.contactPhone || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), contactPhone: e.target.value }))} placeholder={lang === 'ar' ? 'رقم الهاتف' : 'Phone number'} />
            <input type="email" className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.contactEmail || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), contactEmail: e.target.value }))} placeholder={lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} />
            <div className="md:col-span-2">
              <MediaGalleryManager
                items={buildAdMediaFallback(editingAd)}
                onChange={(items) => setEditingAd((prev) => ({ ...(prev || {}), gallery: normalizeMediaGallery(items) }))}
                label={lang === 'ar' ? 'معرض وسائط الإعلان' : 'Ad Media Gallery'}
                addLabel={lang === 'ar' ? 'إضافة وسائط' : 'Add media'}
                emptyLabel={lang === 'ar' ? 'أضف صوراً أو فيديوهات للإعلان.' : 'Add one or more images/videos for this ad.'}
              />
            </div>
            <select className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.status || 'DRAFT'} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), status: e.target.value as Ad['status'] }))}>
              <option value="DRAFT">DRAFT</option>
              <option value="PUBLISHED">PUBLISHED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
            <input type="date" className="border border-zinc-300 rounded-lg p-2.5" value={editingAd.publishDate || ''} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), publishDate: e.target.value }))} />
            <label className="md:col-span-2 inline-flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={Boolean(editingAd.isFeatured)} onChange={(e) => setEditingAd((prev) => ({ ...(prev || {}), isFeatured: e.target.checked }))} />
              {lang === 'ar' ? 'إضافة كإعلان مميز' : 'Mark as featured ad'}
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingAd(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">{t?.cancel || 'Cancel'}</button>
            <button onClick={saveAd} disabled={isSavingAd} className="inline-flex items-center gap-2 rounded-lg bg-red-900 px-4 py-2 text-sm font-semibold text-white hover:bg-red-950 disabled:opacity-60">
              {isSavingAd ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t?.save || 'Save'}
            </button>
          </div>
        </div>
      )}

      {editingAnnouncement && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <h3 className="font-bold text-zinc-900">
            {editingAnnouncement.id
              ? (t?.editAnnouncement || (lang === 'ar' ? 'تعديل الإعلان المتحرك' : 'Edit Announcement'))
              : (t?.addAnnouncement || (lang === 'ar' ? 'إضافة إعلان متحرك' : 'Add Announcement'))}
          </h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-600">
                {t?.announcementTextEnLabel || (lang === 'ar' ? 'النص بالإنجليزية' : 'English text')}
              </label>
              <textarea
                className="w-full border border-zinc-300 rounded-lg p-2.5 min-h-[120px]"
                value={editingAnnouncement.textEn || ''}
                onChange={(e) => setEditingAnnouncement((prev) => ({ ...(prev || {}), textEn: e.target.value }))}
                placeholder={t?.announcementTextEnPlaceholder || (lang === 'ar' ? 'اكتب نص الإعلان بالإنجليزية...' : 'Write announcement text in English...')}
                maxLength={240}
              />
              <div className="text-xs text-zinc-500 text-end">{(editingAnnouncement.textEn || '').length}/240</div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-600">
                {t?.announcementTextArLabel || (lang === 'ar' ? 'النص بالعربية' : 'Arabic text')}
              </label>
              <textarea
                className="w-full border border-zinc-300 rounded-lg p-2.5 min-h-[120px]"
                value={editingAnnouncement.textAr || ''}
                onChange={(e) => setEditingAnnouncement((prev) => ({ ...(prev || {}), textAr: e.target.value }))}
                placeholder={t?.announcementTextArPlaceholder || (lang === 'ar' ? 'اكتب نص الإعلان بالعربية...' : 'Write announcement text in Arabic...')}
                maxLength={240}
              />
              <div className="text-xs text-zinc-500 text-end">{(editingAnnouncement.textAr || '').length}/240</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={Boolean(editingAnnouncement.enabled ?? true)}
                  onChange={(e) => setEditingAnnouncement((prev) => ({ ...(prev || {}), enabled: e.target.checked }))}
                />
                {t?.announcementEnabledLabel || (lang === 'ar' ? 'مفعل' : 'Enabled')}
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={Boolean(editingAnnouncement.showInTopBar ?? true)}
                  onChange={(e) => setEditingAnnouncement((prev) => ({ ...(prev || {}), showInTopBar: e.target.checked }))}
                />
                {t?.announcementShowInBarLabel || (lang === 'ar' ? 'الظهور في الشريط' : 'Show in top bar')}
              </label>
              <input
                type="number"
                className="border border-zinc-300 rounded-lg p-2.5"
                value={editingAnnouncement.sortOrder ?? 0}
                onChange={(e) => setEditingAnnouncement((prev) => ({ ...(prev || {}), sortOrder: Number(e.target.value) || 0 }))}
                placeholder={t?.announcementSortOrderLabel || (lang === 'ar' ? 'ترتيب العرض' : 'Sort order')}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditingAnnouncement(null)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50">{t?.cancel || 'Cancel'}</button>
            <button onClick={saveAnnouncement} disabled={isSavingAnnouncement} className="inline-flex items-center gap-2 rounded-lg bg-red-900 px-4 py-2 text-sm font-semibold text-white hover:bg-red-950 disabled:opacity-60">
              {isSavingAnnouncement ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t?.save || 'Save'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'ADS' && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="font-bold text-zinc-900">{lang === 'ar' ? 'الإعلانات' : 'Ads'}</h3>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border border-zinc-300 rounded-lg p-2.5 text-sm w-full max-w-sm"
              placeholder={lang === 'ar' ? 'بحث في الإعلانات...' : 'Search ads...'}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500 uppercase">
                <tr>
                  <th className="text-left p-2">{lang === 'ar' ? 'العنوان' : 'Title'}</th>
                  <th className="text-left p-2">{t?.categoryLabel || 'Category'}</th>
                  <th className="text-left p-2">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="text-right p-2">{t?.actions || 'Actions'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredAds.map((ad) => (
                  <tr key={ad.id} className="border-t border-zinc-100">
                    <td className="p-2 font-medium text-zinc-900">{ad.title}</td>
                    <td className="p-2 text-zinc-600">{ad.categoryName || '-'}</td>
                    <td className="p-2 text-zinc-600">{ad.status}</td>
                    <td className="p-2">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setEditingAd({ ...ad, gallery: buildAdMediaFallback(ad) })}
                          className="text-xs font-semibold text-zinc-600 hover:text-zinc-900"
                        >
                          تعديل
                        </button>
                        {ad.status !== 'PUBLISHED' && <button onClick={() => publishAd(ad)} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">نشر</button>}
                        <button onClick={() => deleteAd(ad.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'ANNOUNCEMENTS' && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <div className="flex flex-col gap-1">
            <h3 className="font-bold text-zinc-900">{t?.announcementsTabLabel || (lang === 'ar' ? 'إعلانات الشريط المتحرك' : 'Announcement bar items')}</h3>
            <p className="text-sm text-zinc-500">{t?.announcementsHint || (lang === 'ar' ? 'الإعلانات المفعلة والمحددة للعرض فقط ستظهر في الشريط العلوي.' : 'Only enabled items selected for top bar will appear publicly.')}</p>
          </div>
          <div className="space-y-3">
            {announcements.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
                {t?.noAnnouncementsYet || (lang === 'ar' ? 'لا توجد إعلانات متحركة بعد.' : 'No announcements yet.')}
              </div>
            )}
            {announcements
              .slice()
              .sort((a, b) => (a.sortOrder - b.sortOrder) || ((a.createdAt || '').localeCompare(b.createdAt || '')))
              .map((announcement, index, sorted) => (
                <div key={announcement.id} className="rounded-lg border border-zinc-200 p-3 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div>
                        <div className="text-[11px] font-semibold text-zinc-500">EN</div>
                        <p className="text-sm text-zinc-800 leading-6 break-words">{announcement.textEn || announcement.text || '-'}</p>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-zinc-500">AR</div>
                        <p className="text-sm text-zinc-800 leading-6 break-words">{announcement.textAr || announcement.text || '-'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => moveAnnouncement(announcement, 'up')}
                        disabled={index === 0}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-700 disabled:opacity-40"
                      >
                        {lang === 'ar' ? 'أعلى' : 'Up'}
                      </button>
                      <button
                        onClick={() => moveAnnouncement(announcement, 'down')}
                        disabled={index === sorted.length - 1}
                        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-700 disabled:opacity-40"
                      >
                        {lang === 'ar' ? 'أسفل' : 'Down'}
                      </button>
                      <button onClick={() => setEditingAnnouncement(announcement)} className="text-xs font-semibold text-zinc-600 hover:text-zinc-900">تعديل</button>
                      <button onClick={() => removeAnnouncement(announcement.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">حذف</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-zinc-600">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={announcement.enabled}
                        onChange={() => toggleAnnouncementField(announcement, 'enabled')}
                      />
                      {t?.announcementEnabledLabel || (lang === 'ar' ? 'مفعل' : 'Enabled')}
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={announcement.showInTopBar}
                        onChange={() => toggleAnnouncementField(announcement, 'showInTopBar')}
                      />
                      {t?.announcementShowInBarLabel || (lang === 'ar' ? 'الظهور في الشريط' : 'Show in top bar')}
                    </label>
                    <span>
                      {t?.announcementSortOrderLabel || (lang === 'ar' ? 'ترتيب العرض' : 'Sort order')}: {announcement.sortOrder}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'CATEGORIES' && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <h3 className="font-bold text-zinc-900">{t?.manageAdCategories || (lang === 'ar' ? 'إدارة فئات الإعلانات' : 'Manage ad categories')}</h3>
          <div className="flex gap-2">
            <input className="flex-1 border border-zinc-300 rounded-lg p-2.5" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={lang === 'ar' ? 'اسم الفئة' : 'Category name'} />
            <button onClick={addCategory} className="rounded-lg bg-zinc-900 text-white px-4 py-2 text-sm font-semibold hover:bg-black">{t?.addCategory || 'Add category'}</button>
          </div>
          <div className="space-y-2">
            {categories.map((category) => (
              <div key={category.id} className="flex items-center justify-between border border-zinc-100 rounded-lg px-3 py-2">
                {editingCategoryId === category.id ? (
                  <input
                    className="flex-1 border border-zinc-300 rounded-lg p-2 text-sm"
                    value={editingCategoryName}
                    onChange={(e) => setEditingCategoryName(e.target.value)}
                    placeholder={lang === 'ar' ? 'اسم الفئة' : 'Category name'}
                  />
                ) : (
                  <span className="text-sm text-zinc-700">{category.name}</span>
                )}
                <div className="flex items-center gap-3">
                  {editingCategoryId === category.id ? (
                    <>
                      <button
                        onClick={saveCategoryEdit}
                        disabled={isSavingCategory}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                      >
                        {isSavingCategory ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (t?.save || 'Save')}
                      </button>
                      <button onClick={cancelCategoryEdit} className="text-xs font-semibold text-zinc-600 hover:text-zinc-900">{t?.cancel || 'Cancel'}</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => startCategoryEdit(category)} className="text-xs font-semibold text-zinc-600 hover:text-zinc-900">{t?.editCategory || (lang === 'ar' ? 'تعديل' : 'Edit')}</button>
                      <button onClick={() => deleteCategory(category.id)} className="text-xs font-semibold text-red-600 hover:text-red-700">{lang === 'ar' ? 'حذف' : 'Delete'}</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'CUSTOMIZE' && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5 space-y-4">
          <h3 className="font-bold text-zinc-900">{lang === 'ar' ? 'تخصيص صفحة /ads' : 'Customize /ads page'}</h3>
          <input className="w-full border border-zinc-300 rounded-lg p-2.5" value={settings.heroTitle} onChange={(e) => setSettings((prev) => ({ ...prev, heroTitle: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان الهيرو' : 'Hero title'} />
          <textarea className="w-full border border-zinc-300 rounded-lg p-2.5 min-h-[90px]" value={settings.heroSubtitle} onChange={(e) => setSettings((prev) => ({ ...prev, heroSubtitle: e.target.value }))} placeholder={lang === 'ar' ? 'وصف الهيرو' : 'Hero subtitle'} />
          <input className="w-full border border-zinc-300 rounded-lg p-2.5" value={settings.searchPlaceholder} onChange={(e) => setSettings((prev) => ({ ...prev, searchPlaceholder: e.target.value }))} placeholder={lang === 'ar' ? 'Placeholder البحث' : 'Search placeholder'} />
          <div className="grid grid-cols-2 gap-2">
            <input className="border border-zinc-300 rounded-lg p-2.5" value={settings.statAdsLabel} onChange={(e) => setSettings((prev) => ({ ...prev, statAdsLabel: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان إحصائية الإعلانات' : 'Ads stat label'} />
            <input className="border border-zinc-300 rounded-lg p-2.5" value={settings.statUsersLabel} onChange={(e) => setSettings((prev) => ({ ...prev, statUsersLabel: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان إحصائية المستخدمين' : 'Users stat label'} />
            <input className="border border-zinc-300 rounded-lg p-2.5" value={settings.statSatisfactionLabel} onChange={(e) => setSettings((prev) => ({ ...prev, statSatisfactionLabel: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان نسبة الرضا' : 'Satisfaction stat label'} />
            <input className="border border-zinc-300 rounded-lg p-2.5" value={settings.statSupportLabel} onChange={(e) => setSettings((prev) => ({ ...prev, statSupportLabel: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان الدعم الفني' : 'Support stat label'} />
          </div>
          <input className="w-full border border-zinc-300 rounded-lg p-2.5" value={settings.statSupportValue} onChange={(e) => setSettings((prev) => ({ ...prev, statSupportValue: e.target.value }))} placeholder={lang === 'ar' ? 'قيمة الدعم الفني' : 'Support value'} />

          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={settings.homepagePromoEnabled} onChange={(e) => setSettings((prev) => ({ ...prev, homepagePromoEnabled: e.target.checked }))} />
            {lang === 'ar' ? 'تفعيل بانر/فيديو الصفحة الرئيسية' : 'Enable homepage banner/video'}
          </label>
          <select className="w-full border border-zinc-300 rounded-lg p-2.5" value={settings.homepagePromoType} onChange={(e) => setSettings((prev) => ({ ...prev, homepagePromoType: e.target.value as 'image' | 'video' }))}>
            <option value="image">{lang === 'ar' ? 'صورة' : 'Image'}</option>
            <option value="video">{lang === 'ar' ? 'فيديو' : 'Video'}</option>
          </select>
          <MediaUpload
            type={settings.homepagePromoType === 'video' ? 'video' : 'image'}
            value={settings.homepagePromoMediaUrl}
            onChange={(url) => setSettings((prev) => ({ ...prev, homepagePromoMediaUrl: url }))}
            label={lang === 'ar' ? 'وسائط البانر/الفيديو' : 'Banner/video media'}
            showPreview
          />
          <input className="w-full border border-zinc-300 rounded-lg p-2.5" value={settings.homepagePromoLink} onChange={(e) => setSettings((prev) => ({ ...prev, homepagePromoLink: e.target.value }))} placeholder={lang === 'ar' ? 'رابط عند الضغط' : 'Click-through URL'} />
          <input className="w-full border border-zinc-300 rounded-lg p-2.5" value={settings.homepagePromoTitle} onChange={(e) => setSettings((prev) => ({ ...prev, homepagePromoTitle: e.target.value }))} placeholder={lang === 'ar' ? 'عنوان البانر' : 'Promo title'} />
          <textarea className="w-full border border-zinc-300 rounded-lg p-2.5 min-h-[80px]" value={settings.homepagePromoSubtitle} onChange={(e) => setSettings((prev) => ({ ...prev, homepagePromoSubtitle: e.target.value }))} placeholder={lang === 'ar' ? 'وصف البانر' : 'Promo subtitle'} />
          <div className="flex justify-end">
            <button onClick={saveSettings} className="inline-flex items-center gap-2 rounded-lg bg-red-900 text-white px-4 py-2 font-semibold hover:bg-red-950">
              <Save className="h-4 w-4" /> {t?.save || 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdsManagement;
