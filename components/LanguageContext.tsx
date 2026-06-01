/**
 * Language Context for i18n support
 * 
 * Provides language switching and translation capabilities for the LMS platform.
 * Currently supports English and Arabic.
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

export type Language = 'en' | 'ar';

export type TranslationKey = 
  // Common
  | 'common.yes'
  | 'common.no'
  | 'common.ok'
  | 'common.cancel'
  | 'common.confirm'
  | 'common.delete'
  | 'common.save'
  | 'common.close'
  | 'common.loading'
  | 'common.error'
  | 'common.success'
  | 'common.warning'
  | 'common.info'
  | 'common.pleaseWait'
  | 'common.tryAgain'
  | 'common.backToHome'
  
  // Confirmation messages
  | 'confirm.delete.title'
  | 'confirm.delete.message'
  | 'confirm.delete.button'
  | 'confirm.cancel.title'
  | 'confirm.cancel.message'
  | 'confirm.unsaved.title'
  | 'confirm.unsaved.message'
  | 'confirm.logout.title'
  | 'confirm.logout.message'
  | 'confirm.remove.title'
  | 'confirm.remove.message'
  | 'confirm.submit.title'
  | 'confirm.submit.message'
  
  // Notifications
  | 'notification.saved'
  | 'notification.deleted'
  | 'notification.updated'
  | 'notification.created'
  | 'notification.error.generic'
  | 'notification.error.network'
  | 'notification.error.unauthorized'
  | 'notification.error.forbidden'
  | 'notification.error.notfound'
  | 'notification.success.generic'
  | 'notification.warning.generic'
  | 'notification.info.generic'
  | 'notification.copied'
  | 'notification.uploaded'
  | 'notification.downloaded'
  
  // Forms
  | 'form.required'
  | 'form.invalid'
  | 'form.email.invalid'
  | 'form.password.weak'
  | 'form.password.mismatch'
  | 'form.submit'
  | 'form.reset'
  | 'form.pleaseEnter'
  | 'form.pleaseSelect'
  
  // Actions
  | 'action.edit'
  | 'action.delete'
  | 'action.view'
  | 'action.download'
  | 'action.upload'
  | 'action.share'
  | 'action.export'
  | 'action.import'
  | 'action.retry'
  | 'action.goBack'
  
  // Alerts
  | 'alert.success'
  | 'alert.error'
  | 'alert.warning'
  | 'alert.info'
  | 'alert.areYouSure'
  | 'alert.cannotUndo'
  
  // Errors
  | 'error.pageNotFound'
  | 'error.serverError'
  | 'error.connectionLost'
  | 'error.sessionExpired'
  | 'error.permissionDenied'
  | 'error.invalidData'
  | 'error.tryAgainLater';

interface Translations {
  [key: string]: string;
}

const translations: Record<Language, Translations> = {
  en: {
    // Common
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.ok': 'OK',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.delete': 'Delete',
    'common.save': 'Save',
    'common.close': 'Close',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.warning': 'Warning',
    'common.info': 'Info',
    'common.pleaseWait': 'Please wait...',
    'common.tryAgain': 'Try Again',
    'common.backToHome': 'Back to Home',
    
    // Confirmation messages
    'confirm.delete.title': 'Confirm Deletion',
    'confirm.delete.message': 'Are you sure you want to delete this item? This action cannot be undone.',
    'confirm.delete.button': 'Delete',
    'confirm.cancel.title': 'Confirm Cancellation',
    'confirm.cancel.message': 'Are you sure you want to cancel? Any unsaved changes will be lost.',
    'confirm.unsaved.title': 'Unsaved Changes',
    'confirm.unsaved.message': 'You have unsaved changes. Do you want to leave without saving?',
    'confirm.logout.title': 'Confirm Logout',
    'confirm.logout.message': 'Are you sure you want to log out?',
    'confirm.remove.title': 'Confirm Removal',
    'confirm.remove.message': 'Are you sure you want to remove this?',
    'confirm.submit.title': 'Confirm Submission',
    'confirm.submit.message': 'Are you ready to submit?',
    
    // Notifications
    'notification.saved': 'Saved successfully',
    'notification.deleted': 'Deleted successfully',
    'notification.updated': 'Updated successfully',
    'notification.created': 'Created successfully',
    'notification.error.generic': 'An error occurred. Please try again.',
    'notification.error.network': 'Network error. Please check your connection.',
    'notification.error.unauthorized': 'You are not authorized to perform this action.',
    'notification.error.forbidden': 'Access denied.',
    'notification.error.notfound': 'The requested resource was not found.',
    'notification.success.generic': 'Operation completed successfully',
    'notification.warning.generic': 'Please review and try again',
    'notification.info.generic': 'Information',
    'notification.copied': 'Copied to clipboard',
    'notification.uploaded': 'Uploaded successfully',
    'notification.downloaded': 'Downloaded successfully',
    
    // Forms
    'form.required': 'This field is required',
    'form.invalid': 'Invalid input',
    'form.email.invalid': 'Please enter a valid email address',
    'form.password.weak': 'Password is too weak',
    'form.password.mismatch': 'Passwords do not match',
    'form.submit': 'Submit',
    'form.reset': 'Reset',
    'form.pleaseEnter': 'Please enter',
    'form.pleaseSelect': 'Please select',
    
    // Actions
    'action.edit': 'Edit',
    'action.delete': 'Delete',
    'action.view': 'View',
    'action.download': 'Download',
    'action.upload': 'Upload',
    'action.share': 'Share',
    'action.export': 'Export',
    'action.import': 'Import',
    'action.retry': 'Retry',
    'action.goBack': 'Go Back',
    
    // Alerts
    'alert.success': 'Success!',
    'alert.error': 'Error!',
    'alert.warning': 'Warning!',
    'alert.info': 'Information',
    'alert.areYouSure': 'Are you sure?',
    'alert.cannotUndo': 'This action cannot be undone',
    
    // Errors
    'error.pageNotFound': 'Page not found',
    'error.serverError': 'Server error occurred',
    'error.connectionLost': 'Connection lost',
    'error.sessionExpired': 'Your session has expired',
    'error.permissionDenied': 'Permission denied',
    'error.invalidData': 'Invalid data provided',
    'error.tryAgainLater': 'Please try again later',
  },
  ar: {
    // Common
    'common.yes': 'نعم',
    'common.no': 'لا',
    'common.ok': 'حسناً',
    'common.cancel': 'إلغاء',
    'common.confirm': 'تأكيد',
    'common.delete': 'حذف',
    'common.save': 'حفظ',
    'common.close': 'إغلاق',
    'common.loading': 'جاري التحميل...',
    'common.error': 'خطأ',
    'common.success': 'نجاح',
    'common.warning': 'تحذير',
    'common.info': 'معلومات',
    'common.pleaseWait': 'يرجى الانتظار...',
    'common.tryAgain': 'حاول مرة أخرى',
    'common.backToHome': 'العودة للصفحة الرئيسية',
    
    // Confirmation messages
    'confirm.delete.title': 'تأكيد الحذف',
    'confirm.delete.message': 'هل أنت متأكد من حذف هذا العنصر؟ لا يمكن التراجع عن هذا الإجراء.',
    'confirm.delete.button': 'حذف',
    'confirm.cancel.title': 'تأكيد الإلغاء',
    'confirm.cancel.message': 'هل أنت متأكد من الإلغاء؟ سيتم فقدان أي تغييرات غير محفوظة.',
    'confirm.unsaved.title': 'تغييرات غير محفوظة',
    'confirm.unsaved.message': 'لديك تغييرات غير محفوظة. هل تريد المغادرة دون الحفظ؟',
    'confirm.logout.title': 'تأكيد تسجيل الخروج',
    'confirm.logout.message': 'هل أنت متأكد من تسجيل الخروج؟',
    'confirm.remove.title': 'تأكيد الإزالة',
    'confirm.remove.message': 'هل أنت متأكد من الإزالة؟',
    'confirm.submit.title': 'تأكيد الإرسال',
    'confirm.submit.message': 'هل أنت مستعد للإرسال؟',
    
    // Notifications
    'notification.saved': 'تم الحفظ بنجاح',
    'notification.deleted': 'تم الحذف بنجاح',
    'notification.updated': 'تم التحديث بنجاح',
    'notification.created': 'تم الإنشاء بنجاح',
    'notification.error.generic': 'حدث خطأ. يرجى المحاولة مرة أخرى.',
    'notification.error.network': 'خطأ في الشبكة. يرجى التحقق من الاتصال.',
    'notification.error.unauthorized': 'غير مصرح لك بتنفيذ هذا الإجراء.',
    'notification.error.forbidden': 'تم رفض الوصول.',
    'notification.error.notfound': 'لم يتم العثور على المورد المطلوب.',
    'notification.success.generic': 'تمت العملية بنجاح',
    'notification.warning.generic': 'يرجى المراجعة والمحاولة مرة أخرى',
    'notification.info.generic': 'معلومات',
    'notification.copied': 'تم النسخ إلى الحافظة',
    'notification.uploaded': 'تم الرفع بنجاح',
    'notification.downloaded': 'تم التنزيل بنجاح',
    
    // Forms
    'form.required': 'هذا الحقل مطلوب',
    'form.invalid': 'إدخال غير صحيح',
    'form.email.invalid': 'يرجى إدخال عنوان بريد إلكتروني صالح',
    'form.password.weak': 'كلمة المرور ضعيفة جداً',
    'form.password.mismatch': 'كلمات المرور غير متطابقة',
    'form.submit': 'إرسال',
    'form.reset': 'إعادة تعيين',
    'form.pleaseEnter': 'يرجى الإدخال',
    'form.pleaseSelect': 'يرجى الاختيار',
    
    // Actions
    'action.edit': 'تعديل',
    'action.delete': 'حذف',
    'action.view': 'عرض',
    'action.download': 'تنزيل',
    'action.upload': 'رفع',
    'action.share': 'مشاركة',
    'action.export': 'تصدير',
    'action.import': 'استيراد',
    'action.retry': 'إعادة المحاولة',
    'action.goBack': 'العودة',
    
    // Alerts
    'alert.success': 'نجاح!',
    'alert.error': 'خطأ!',
    'alert.warning': 'تحذير!',
    'alert.info': 'معلومات',
    'alert.areYouSure': 'هل أنت متأكد؟',
    'alert.cannotUndo': 'لا يمكن التراجع عن هذا الإجراء',
    
    // Errors
    'error.pageNotFound': 'الصفحة غير موجودة',
    'error.serverError': 'حدث خطأ في الخادم',
    'error.connectionLost': 'فقد الاتصال',
    'error.sessionExpired': 'انتهت صلاحية جلستك',
    'error.permissionDenied': 'تم رفض الإذن',
    'error.invalidData': 'تم تقديم بيانات غير صحيحة',
    'error.tryAgainLater': 'يرجى المحاولة مرة أخرى لاحقاً',
  },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string>) => string;
  dir: 'ltr' | 'rtl';
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

interface LanguageProviderProps {
  children: React.ReactNode;
  defaultLanguage?: Language;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ 
  children, 
  defaultLanguage = 'en' 
}) => {
  // Load language from localStorage or use default
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language') as Language;
    return saved && (saved === 'en' || saved === 'ar') ? saved : defaultLanguage;
  });

  // Translation function with parameter substitution
  const t = useCallback((key: TranslationKey, params?: Record<string, string>): string => {
    let translation = translations[language][key] || key;
    
    // Substitute parameters if provided
    if (params) {
      Object.keys(params).forEach((param) => {
        translation = translation.replace(`{${param}}`, params[param]);
      });
    }
    
    return translation;
  }, [language]);

  // Set language and persist to localStorage
  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('app_language', lang);
    
    // Update document direction
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, []);

  // Update document direction on mount and language change
  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const value: LanguageContextType = {
    language,
    setLanguage,
    t,
    dir: language === 'ar' ? 'rtl' : 'ltr',
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

// Helper function to add new translation keys dynamically
export function addTranslations(lang: Language, newTranslations: Record<string, string>) {
  Object.assign(translations[lang], newTranslations);
}
