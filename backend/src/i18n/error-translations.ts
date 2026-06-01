type Lang = 'en' | 'ar';

type ErrorBuckets = {
  errors: Record<string, string>;
};

export const errorTranslations: Record<Lang, ErrorBuckets> = {
  en: {
    errors: {
      // Authentication Errors
      authLoginFailed: 'Login failed. Please check your credentials.',
      authInvalidCredentials: 'Invalid email or password.',
      authPasswordRequired: 'Password is required.',
      authEmailRequired: 'Email address is required.',
      authPasswordMismatch: 'Passwords do not match.',
      authPasswordTooShort: 'Password must be at least 6 characters.',
      authDuplicateEmail: 'This email is already registered.',
      authSessionExpired: 'Your session has expired. Please log in again.',
      authUnauthorized: 'You are not authorized to perform this action.',
      authRequired: 'Authentication required. Please log in.',
      authInvalid: 'Invalid or expired authentication token.',
      authForbidden: 'You do not have permission to access this resource.',
      authMissingCredentials: 'Email and password are required.',

      // Form Validation Errors
      validationRequired: 'This field is required.',
      validationInvalidEmail: 'Please enter a valid email address.',
      validationInvalidPhone: 'Please enter a valid phone number.',
      validationInvalidUrl: 'Please enter a valid URL.',
      validationTooShort: 'This value is too short.',
      validationTooLong: 'This value is too long.',
      validationInvalidFormat: 'Invalid format.',
      validationNumericOnly: 'Please enter numbers only.',

      // Payment & Financial Errors
      paymentFailed: 'Payment processing failed. Please try again.',
      paymentGatewayUnavailable: 'Payment gateway is currently unavailable.',
      paymentInsufficientFunds: 'Insufficient funds.',
      paymentInvalidCard: 'Invalid card information.',
      paymentTransactionDeclined: 'Transaction was declined.',
      paymentRefundFailed: 'Refund processing failed.',

      // Permission & Authorization Errors
      permissionDenied: 'Permission denied.',
      permissionInsufficientRights: "You don't have sufficient rights for this action.",
      permissionRoleRequired: 'Required role not found.',
      permissionAccessDenied: 'Access denied to this resource.',

      // Backend/API Errors
      apiRequestFailed: 'Request failed. Please try again.',
      apiServerError: 'Server error occurred.',
      apiNetworkError: 'Network connection error.',
      apiTimeoutError: 'Request timed out.',
      apiNotFound: 'Resource not found.',
      apiConflict: 'A conflict occurred. Please check your data.',
      apiBadRequest: 'Invalid request data.',

      // Tenant/Subdomain Errors
      tenantNotFound: 'Tenant not found.',
      tenantSuspended: 'This tenant account is suspended.',
      tenantInvalidSubdomain: 'Invalid subdomain format.',
      tenantSubdomainTaken: 'This subdomain is already in use.',
      tenantSubdomainRequired: 'Subdomain is required.',
      tenantProvisioningFailed: 'Tenant provisioning failed.',

      // Course & Content Errors
      courseNotFound: 'Course not found.',
      courseEnrollmentFailed: 'Failed to enroll in course.',
      courseAccessDenied: "You don't have access to this course.",
      courseContentUnavailable: 'Course content is currently unavailable.',
      courseSaveFailed: 'Failed to save course.',

      // Assignment & Quiz Errors
      assignmentSubmitFailed: 'Failed to submit assignment.',
      assignmentGradingFailed: 'Grading failed.',
      quizSubmitFailed: 'Failed to submit quiz.',
      testResultsUnavailable: 'Test results unavailable.',

      // User & Profile Errors
      userNotFound: 'User not found.',
      profileUpdateFailed: 'Failed to update profile.',
      profileSaveFailed: 'Failed to save profile changes.',

      // File Upload Errors
      fileUploadFailed: 'File upload failed.',
      fileInvalidType: 'Invalid file type.',
      fileTooLarge: 'File size exceeds limit.',

      // Messaging Errors
      messageSendFailed: 'Failed to send message.',
      messageDeleteFailed: 'Failed to delete message.',
      messageLoadFailed: 'Failed to load messages.',

      // AI Configuration Errors
      aiConfigFetchFailed: 'Failed to fetch AI configuration.',
      aiConfigUpdateFailed: 'Failed to update AI configuration.',
      aiConfigDeleteFailed: 'Failed to disable AI configuration.',
      aiNotConfigured: 'AI is not configured for this account.',
      aiKeyRequired: 'API Key is required when AI is enabled.',
      aiTestFailed: 'AI connection test failed.',
      aiGenerationFailed: 'AI generation failed. Please try again.',
      invalidRequest: 'Invalid request data.',
      unsupportedProvider: 'AI provider is not supported for this request.',
      invalidTemperature: 'Temperature must be between 0 and 2.',
      invalidMaxTokens: 'Max tokens must be between 1 and 100,000.',
      noConfigurationProvided: 'At least one configuration field must be provided.',

      // System Alerts
      systemMaintenanceMode: 'System is under maintenance.',
      systemGeneralError: 'An unexpected error occurred.',
      systemTryAgainLater: 'Please try again later.',
      systemContactSupport: 'Please contact support if the issue persists.'
    }
  },
  ar: {
    errors: {
      // Authentication Errors
      authLoginFailed: 'فشل تسجيل الدخول. يرجى التحقق من بياناتك.',
      authInvalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      authPasswordRequired: 'كلمة المرور مطلوبة.',
      authEmailRequired: 'البريد الإلكتروني مطلوب.',
      authPasswordMismatch: 'كلمات المرور غير متطابقة.',
      authPasswordTooShort: 'يجب أن تكون كلمة المرور 6 أحرف على الأقل.',
      authDuplicateEmail: 'هذا البريد الإلكتروني مسجل مسبقاً.',
      authSessionExpired: 'انتهت صلاحية جلستك. يرجى تسجيل الدخول مرة أخرى.',
      authUnauthorized: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.',
      authRequired: 'مطلوب مصادقة. يرجى تسجيل الدخول.',
      authInvalid: 'رمز المصادقة غير صالح أو منتهي الصلاحية.',
      authForbidden: 'ليس لديك صلاحية للوصول إلى هذا المورد.',
      authMissingCredentials: 'البريد الإلكتروني وكلمة المرور مطلوبان.',

      // Form Validation Errors
      validationRequired: 'هذا الحقل مطلوب.',
      validationInvalidEmail: 'يرجى إدخال بريد إلكتروني صحيح.',
      validationInvalidPhone: 'يرجى إدخال رقم هاتف صحيح.',
      validationInvalidUrl: 'يرجى إدخال رابط صحيح.',
      validationTooShort: 'هذه القيمة قصيرة جداً.',
      validationTooLong: 'هذه القيمة طويلة جداً.',
      validationInvalidFormat: 'صيغة غير صحيحة.',
      validationNumericOnly: 'يرجى إدخال أرقام فقط.',

      // Payment & Financial Errors
      paymentFailed: 'فشلت عملية الدفع. يرجى المحاولة مرة أخرى.',
      paymentGatewayUnavailable: 'بوابة الدفع غير متاحة حالياً.',
      paymentInsufficientFunds: 'رصيد غير كافٍ.',
      paymentInvalidCard: 'بيانات البطاقة غير صحيحة.',
      paymentTransactionDeclined: 'تم رفض العملية.',
      paymentRefundFailed: 'فشلت عملية الاسترجاع.',

      // Permission & Authorization Errors
      permissionDenied: 'تم رفض الإذن.',
      permissionInsufficientRights: 'ليس لديك صلاحيات كافية لهذا الإجراء.',
      permissionRoleRequired: 'الدور المطلوب غير موجود.',
      permissionAccessDenied: 'تم رفض الوصول إلى هذا المورد.',

      // Backend/API Errors
      apiRequestFailed: 'فشل الطلب. يرجى المحاولة مرة أخرى.',
      apiServerError: 'حدث خطأ في الخادم.',
      apiNetworkError: 'خطأ في الاتصال بالشبكة.',
      apiTimeoutError: 'انتهت مهلة الطلب.',
      apiNotFound: 'المورد غير موجود.',
      apiConflict: 'حدث تعارض. يرجى التحقق من بياناتك.',
      apiBadRequest: 'بيانات الطلب غير صحيحة.',

      // Tenant/Subdomain Errors
      tenantNotFound: 'المستأجر غير موجود.',
      tenantSuspended: 'هذا الحساب موقوف.',
      tenantInvalidSubdomain: 'صيغة النطاق الفرعي غير صحيحة.',
      tenantSubdomainTaken: 'هذا النطاق الفرعي مستخدم بالفعل.',
      tenantSubdomainRequired: 'النطاق الفرعي مطلوب.',
      tenantProvisioningFailed: 'فشلت عملية تهيئة المستأجر.',

      // Course & Content Errors
      courseNotFound: 'الدورة غير موجودة.',
      courseEnrollmentFailed: 'فشل التسجيل في الدورة.',
      courseAccessDenied: 'ليس لديك صلاحية الوصول لهذه الدورة.',
      courseContentUnavailable: 'محتوى الدورة غير متاح حالياً.',
      courseSaveFailed: 'فشل حفظ الدورة.',

      // Assignment & Quiz Errors
      assignmentSubmitFailed: 'فشل تقديم الواجب.',
      assignmentGradingFailed: 'فشل التصحيح.',
      quizSubmitFailed: 'فشل تقديم الاختبار.',
      testResultsUnavailable: 'نتائج الاختبار غير متاحة.',

      // User & Profile Errors
      userNotFound: 'المستخدم غير موجود.',
      profileUpdateFailed: 'فشل تحديث الملف الشخصي.',
      profileSaveFailed: 'فشل حفظ التغييرات.',

      // File Upload Errors
      fileUploadFailed: 'فشل رفع الملف.',
      fileInvalidType: 'نوع الملف غير صحيح.',
      fileTooLarge: 'حجم الملف يتجاوز الحد المسموح.',

      // Messaging Errors
      messageSendFailed: 'فشل إرسال الرسالة.',
      messageDeleteFailed: 'فشل حذف الرسالة.',
      messageLoadFailed: 'فشل تحميل الرسائل.',

      // AI Configuration Errors
      aiConfigFetchFailed: 'فشل الحصول على إعدادات الذكاء الاصطناعي.',
      aiConfigUpdateFailed: 'فشل تحديث إعدادات الذكاء الاصطناعي.',
      aiConfigDeleteFailed: 'فشل تعطيل إعدادات الذكاء الاصطناعي.',
      aiNotConfigured: 'لم يتم إعداد الذكاء الاصطناعي لهذا الحساب.',
      aiKeyRequired: 'مفتاح API مطلوب عند تفعيل الذكاء الاصطناعي.',
      aiTestFailed: 'فشل اختبار اتصال الذكاء الاصطناعي.',
      aiGenerationFailed: 'فشل توليد المحتوى بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى.',
      invalidRequest: 'بيانات الطلب غير صحيحة.',
      unsupportedProvider: 'موفر الذكاء الاصطناعي غير مدعوم لهذا الطلب.',
      invalidTemperature: 'يجب أن تكون درجة الحرارة بين 0 و 2.',
      invalidMaxTokens: 'يجب أن يكون الحد الأقصى للرموز بين 1 و 100,000.',
      noConfigurationProvided: 'يجب توفير حقل إعدادات واحد على الأقل.',

      // System Alerts
      systemMaintenanceMode: 'النظام قيد الصيانة.',
      systemGeneralError: 'حدث خطأ غير متوقع.',
      systemTryAgainLater: 'يرجى المحاولة لاحقاً.',
      systemContactSupport: 'يرجى التواصل مع الدعم الفني إذا استمرت المشكلة.'
    }
  }
};

export type ErrorKey = keyof typeof errorTranslations.en.errors;
