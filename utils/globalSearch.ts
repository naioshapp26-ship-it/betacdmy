import { User, UserRole } from '../types';

export type SearchItemType = 'page' | 'section' | 'feature' | 'settings' | 'module';

type SearchAudience =
  | 'ALL'
  | UserRole.STUDENT
  | UserRole.INSTRUCTOR
  | UserRole.ADMIN
  | UserRole.SUPER_ADMIN
  | UserRole.GUEST
  | 'GUEST_STUDENT'
  | 'GUEST_INSTRUCTOR';

export interface GlobalSearchItem {
  id: string;
  type: SearchItemType;
  route: string;
  anchor?: string;
  label: {
    en: string;
    ar: string;
  };
  description?: {
    en: string;
    ar: string;
  };
  content?: {
    en?: string[];
    ar?: string[];
  };
  keywords?: {
    en?: string[];
    ar?: string[];
  };
  audience: SearchAudience[];
}

const SECTION_CONTENT_INDEX: Record<string, { en: string[]; ar: string[] }> = {
  'student-overview': {
    en: ['learning summary, daily streak, and quick actions', 'overview cards show progress and enrolled courses'],
    ar: ['ملخص التعلم والسلسلة اليومية والإجراءات السريعة', 'بطاقات النظرة العامة تعرض التقدم والدورات المسجل بها']
  },
  'student-progress': {
    en: ['progress bars, completion percentage, and study momentum', 'track course completion and learning status'],
    ar: ['أشرطة التقدم ونسبة الإكمال واستمرارية الدراسة', 'متابعة إكمال الدورة وحالة التعلم']
  },
  'student-courses': {
    en: ['current courses, finished courses, and lesson continuity', 'browse and open course learning content'],
    ar: ['الدورات الحالية والدورات المكتملة واستمرارية التعلم', 'تصفح محتوى الدورات وفتح الدروس']
  },
  'student-assignments': {
    en: ['pending tasks, assignment status, and submission workflow'],
    ar: ['المهام المعلقة وحالة الواجبات وخطوات التسليم']
  },
  'student-certificates': {
    en: ['issued certificates, credential history, and downloads'],
    ar: ['الشهادات الصادرة وسجل الاعتمادات والتنزيل']
  },
  'student-messages': {
    en: ['direct messaging, inbox threads, and communication panel'],
    ar: ['المراسلة المباشرة وخيوط الرسائل ولوحة التواصل']
  },
  'student-live': {
    en: ['live classes schedule, session links, and attendance'],
    ar: ['جدول الحصص المباشرة وروابط الجلسات والحضور']
  },
  'student-credits': {
    en: ['credit wallet, earning history, and reward redemption'],
    ar: ['محفظة النقاط وسجل الكسب واستبدال المكافآت']
  },
  'instructor-overview': {
    en: ['teaching summary, productivity cards, and instructor insights'],
    ar: ['ملخص التدريس وبطاقات الإنتاجية ورؤى المدرب']
  },
  'instructor-students': {
    en: ['student list, enrollment status, and learner management'],
    ar: ['قائمة الطلاب وحالة التسجيل وإدارة المتعلمين']
  },
  'instructor-courses': {
    en: ['course authoring, modules, curriculum, and publishing'],
    ar: ['إنشاء الدورات والوحدات والمنهج والنشر']
  },
  'instructor-offers': {
    en: ['discount creation, coupon codes, and offers performance'],
    ar: ['إنشاء الخصومات وأكواد القسائم وأداء العروض']
  },
  'instructor-credits': {
    en: ['credit adjustments, rewards activity, and student balances'],
    ar: ['تعديلات النقاط ونشاط المكافآت وأرصدة الطلاب']
  },
  'instructor-financial': {
    en: ['receipts, payouts, and instructor financial tracking'],
    ar: ['الإيصالات والمدفوعات والمتابعة المالية للمدرب']
  },
  'instructor-attendance': {
    en: ['attendance records, class participation, and logs'],
    ar: ['سجلات الحضور والمشاركة الصفية والسجلات']
  },
  'instructor-live': {
    en: ['host live sessions, meeting links, and schedule control'],
    ar: ['استضافة الجلسات المباشرة وروابط الاجتماعات والتحكم بالجدول']
  },
  'instructor-messages': {
    en: ['instructor inbox, communication threads, and course chats'],
    ar: ['صندوق رسائل المدرب وخيوط التواصل ومحادثات الدورات']
  },
  'admin-overview': {
    en: ['platform overview, health metrics, and system summary'],
    ar: ['نظرة عامة على المنصة ومؤشرات الأداء وملخص النظام']
  },
  'admin-users': {
    en: ['user accounts, role permissions, and bulk import'],
    ar: ['حسابات المستخدمين وصلاحيات الأدوار والاستيراد الجماعي']
  },
  'admin-courses': {
    en: ['course catalog, categories, publication, and management'],
    ar: ['كتالوج الدورات والفئات والنشر والإدارة']
  },
  'admin-offers': {
    en: ['discount rules, promotional campaigns, and coupons'],
    ar: ['قواعد الخصم والحملات الترويجية والقسائم']
  },
  'admin-blog': {
    en: ['blog posts, featured content, and publishing queue'],
    ar: ['مقالات المدونة والمحتوى المميز وجدول النشر']
  },
  'admin-financial': {
    en: ['payment records, invoices, payouts, and balances'],
    ar: ['سجلات المدفوعات والفواتير والدفعات والأرصدة']
  },
  'admin-credits': {
    en: ['credit engine settings, grants, and redemption operations'],
    ar: ['إعدادات نظام النقاط والمنح وعمليات الاستبدال']
  },
  'admin-attendance': {
    en: ['attendance tracking reports and class activity logs'],
    ar: ['تقارير متابعة الحضور وسجلات نشاط الحصص']
  },
  'admin-reports': {
    en: ['analytics dashboards, export data, and insights'],
    ar: ['لوحات التحليلات وتصدير البيانات والرؤى']
  },
  'admin-messages': {
    en: ['messaging center, support threads, and moderation'],
    ar: ['مركز الرسائل وخيوط الدعم والإشراف']
  },
  'admin-pages': {
    en: ['static pages editor, content blocks, and layout settings'],
    ar: ['محرر الصفحات الثابتة وكتل المحتوى وإعدادات التخطيط']
  },
  'admin-seo': {
    en: ['search engine metadata, titles, and indexing controls'],
    ar: ['بيانات محركات البحث الوصفية والعناوين وضبط الأرشفة']
  },
  'admin-settings': {
    en: ['platform settings center and configuration overview'],
    ar: ['مركز إعدادات المنصة ونظرة عامة على التكوين']
  },
  'admin-settings-appearance': {
    en: [
      'appearance settings branding logo favicon primary color secondary color accent color',
      'hero title subtitle badge primary cta secondary cta pricing cta footer text academy name',
      'save appearance branding and visual identity'
    ],
    ar: [
      'إعدادات المظهر الهوية الشعار الأيقونة لون أساسي لون ثانوي لون مميز',
      'عنوان الهيرو العنوان الفرعي الشارة زر أساسي زر ثانوي زر التسعير نص التذييل اسم الأكاديمية',
      'حفظ إعدادات المظهر والهوية البصرية'
    ]
  },
  'admin-settings-email': {
    en: [
      'email smtp settings host port username from email password secure tls ssl delete settings',
      'smtp configuration for password reset delivery and tenant email setup'
    ],
    ar: [
      'إعدادات البريد smtp المضيف المنفذ اسم المستخدم بريد المرسل كلمة المرور اتصال آمن tls ssl',
      'إعداد smtp لتسليم رسائل إعادة تعيين كلمة المرور وبريد المؤسسة'
    ]
  },
  'admin-settings-saas-config': {
    en: [
      'saas config academy name enable classroom enable stripe permissions',
      'core tenant toggles and academy configuration options'
    ],
    ar: [
      'إعدادات ساس اسم الأكاديمية تفعيل كلاس روم تفعيل سترايب الصلاحيات',
      'خيارات إعداد المؤسسة ومفاتيح التفعيل الأساسية'
    ]
  },
  'admin-settings-live-platforms': {
    en: [
      'live platform settings smrrtx permanent room link zoom google meet scheduling meetings',
      'zoom configuration link client id client secret account id user id oauth api credentials',
      'google service account email private key calendar id meet configuration',
      'save platform settings for live providers'
    ],
    ar: [
      'إعدادات المنصات المباشرة سمرتيكس زووم جوجل ميت رابط غرفة دائمة جدولة الاجتماعات',
      'رابط إعدادات زووم معرف العميل سر العميل معرف الحساب معرف المستخدم بيانات api',
      'حساب خدمة جوجل بريد الحساب مفتاح خاص معرف التقويم إعدادات جوجل ميت',
      'حفظ إعدادات منصات البث المباشر'
    ]
  },
  'admin-settings-payment-gateways': {
    en: [
      'payment gateways integration paypal stripe client id publishable key secret key webhook signing secret',
      'subscription plan pricing basic pro enterprise monthly yearly amount currency stripe recurring price id',
      'save payment gateways checkout billing configuration'
    ],
    ar: [
      'بوابات الدفع باي بال سترايب مفتاح قابل للنشر مفتاح سري سر توقيع ويب هوك',
      'تسعير الاشتراكات باقة أساسية باقة برو باقة مؤسسة شهري سنوي المبلغ العملة معرف سعر سترايب',
      'حفظ إعدادات بوابات الدفع والفوترة'
    ]
  },
  'admin-settings-ai': {
    en: [
      'ai integration ai provider gemini openai claude model api key max tokens temperature test connection',
      'save ai settings and provider credentials'
    ],
    ar: [
      'تكامل الذكاء الاصطناعي مزود الذكاء جيميني اوبن اي اي كلود نموذج مفتاح api الحد الأقصى للرموز درجة الحرارة اختبار الاتصال',
      'حفظ إعدادات الذكاء الاصطناعي ومفاتيح المزود'
    ]
  },
  'admin-settings-media': {
    en: [
      'media upload settings file upload storage limits image upload links only allow direct upload',
      'save media settings for uploads and external links'
    ],
    ar: [
      'إعدادات رفع الوسائط رفع الملفات حدود التخزين رفع الصور روابط فقط السماح بالرفع المباشر',
      'حفظ إعدادات الوسائط للرفع والروابط الخارجية'
    ]
  }
};

export const GLOBAL_SEARCH_ITEMS: GlobalSearchItem[] = [
  {
    id: 'student-overview-page',
    type: 'page',
    route: '/dashboard/overview',
    anchor: 'student-overview',
    label: { en: 'Student Overview', ar: 'نظرة عامة للطالب' },
    description: { en: 'Main student dashboard page', ar: 'الصفحة الرئيسية للطالب' },
    keywords: { en: ['dashboard', 'overview', 'home'], ar: ['لوحة', 'الرئيسية', 'نظرة'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-progress-section',
    type: 'section',
    route: '/dashboard/overview',
    anchor: 'student-progress',
    label: { en: 'Course Progress', ar: 'تقدم الدورة' },
    description: { en: 'Student learning progress section', ar: 'قسم متابعة تقدم التعلم' },
    keywords: { en: ['progress', 'completion'], ar: ['تقدم', 'إكمال'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-courses-page',
    type: 'module',
    route: '/dashboard/courses',
    anchor: 'student-courses',
    label: { en: 'My Courses', ar: 'دوراتي' },
    keywords: { en: ['courses', 'lessons'], ar: ['دورات', 'دروس'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-assignments-page',
    type: 'module',
    route: '/dashboard/assignments',
    anchor: 'student-assignments',
    label: { en: 'Assignments', ar: 'الواجبات' },
    keywords: { en: ['tasks', 'homework'], ar: ['مهام', 'واجب'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-certificates-page',
    type: 'module',
    route: '/dashboard/certificates',
    anchor: 'student-certificates',
    label: { en: 'Certificates', ar: 'الشهادات' },
    keywords: { en: ['certificates', 'achievement'], ar: ['شهادات', 'إنجاز'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-messages-page',
    type: 'feature',
    route: '/dashboard/messages',
    anchor: 'student-messages',
    label: { en: 'Messages', ar: 'الرسائل' },
    keywords: { en: ['chat', 'inbox'], ar: ['محادثة', 'صندوق الرسائل'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-live-page',
    type: 'feature',
    route: '/dashboard/live',
    anchor: 'student-live',
    label: { en: 'Live Classes', ar: 'الحصص المباشرة' },
    keywords: { en: ['live', 'sessions'], ar: ['مباشر', 'جلسات'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'student-credits-page',
    type: 'feature',
    route: '/dashboard/credits',
    anchor: 'student-credits',
    label: { en: 'Credits Wallet', ar: 'محفظة النقاط' },
    keywords: { en: ['credits', 'wallet', 'redeem'], ar: ['نقاط', 'محفظة', 'استبدال'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'instructor-overview-page',
    type: 'page',
    route: '/dashboard/overview',
    anchor: 'instructor-overview',
    label: { en: 'Instructor Overview', ar: 'نظرة عامة للمدرب' },
    keywords: { en: ['instructor', 'dashboard'], ar: ['مدرب', 'لوحة'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-students-page',
    type: 'module',
    route: '/dashboard/students',
    anchor: 'instructor-students',
    label: { en: 'My Students', ar: 'طلابي' },
    keywords: { en: ['students', 'learners'], ar: ['طلاب', 'متعلمين'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-courses-page',
    type: 'module',
    route: '/dashboard/courses',
    anchor: 'instructor-courses',
    label: { en: 'Manage Courses', ar: 'إدارة الدورات' },
    keywords: { en: ['course management', 'create course'], ar: ['إدارة الدورات', 'إنشاء دورة'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-offers-page',
    type: 'feature',
    route: '/dashboard/offers',
    anchor: 'instructor-offers',
    label: { en: 'Offers & Discounts', ar: 'العروض والخصومات' },
    keywords: { en: ['offers', 'discounts', 'coupons'], ar: ['عروض', 'خصومات', 'كوبونات'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-financial-page',
    type: 'settings',
    route: '/dashboard/financial',
    anchor: 'instructor-financial',
    label: { en: 'Financial', ar: 'المالية' },
    keywords: { en: ['receipts', 'payouts', 'finance'], ar: ['إيصالات', 'مدفوعات', 'مالية'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-attendance-page',
    type: 'feature',
    route: '/dashboard/attendance',
    anchor: 'instructor-attendance',
    label: { en: 'Attendance', ar: 'الحضور' },
    keywords: { en: ['attendance', 'tracking'], ar: ['حضور', 'متابعة'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-live-page',
    type: 'feature',
    route: '/dashboard/live',
    anchor: 'instructor-live',
    label: { en: 'Live Class Manager', ar: 'إدارة الحصص المباشرة' },
    keywords: { en: ['live classes', 'host'], ar: ['حصص مباشرة', 'استضافة'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-messages-page',
    type: 'feature',
    route: '/dashboard/messages',
    anchor: 'instructor-messages',
    label: { en: 'Instructor Messages', ar: 'رسائل المدرب' },
    keywords: { en: ['messages', 'communication'], ar: ['رسائل', 'تواصل'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'instructor-credits-page',
    type: 'feature',
    route: '/dashboard/credits',
    anchor: 'instructor-credits',
    label: { en: 'Instructor Credits', ar: 'نقاط المدرب' },
    keywords: { en: ['credits', 'wallet', 'adjustments', 'rewards'], ar: ['نقاط', 'محفظة', 'تعديلات', 'مكافآت'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'admin-overview-page',
    type: 'page',
    route: '/dashboard/overview',
    anchor: 'admin-overview',
    label: { en: 'Admin Overview', ar: 'نظرة عامة للإدارة' },
    keywords: { en: ['admin dashboard', 'overview'], ar: ['لوحة الإدارة', 'نظرة عامة'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-users-page',
    type: 'module',
    route: '/dashboard/users',
    anchor: 'admin-users',
    label: { en: 'User Management', ar: 'إدارة المستخدمين' },
    keywords: { en: ['users', 'accounts', 'roles'], ar: ['مستخدمين', 'حسابات', 'أدوار'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-courses-page',
    type: 'module',
    route: '/dashboard/courses',
    anchor: 'admin-courses',
    label: { en: 'Courses Management', ar: 'إدارة الدورات' },
    keywords: { en: ['courses', 'catalog'], ar: ['دورات', 'كتالوج'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-offers-page',
    type: 'feature',
    route: '/dashboard/offers',
    anchor: 'admin-offers',
    label: { en: 'Discount Manager', ar: 'إدارة الخصومات' },
    keywords: { en: ['offers', 'discounts'], ar: ['عروض', 'خصومات'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-blog-page',
    type: 'feature',
    route: '/dashboard/blog',
    anchor: 'admin-blog',
    label: { en: 'Blog Manager', ar: 'إدارة المدونة' },
    keywords: { en: ['blog', 'posts', 'content'], ar: ['مدونة', 'مقالات', 'محتوى'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-financial-page',
    type: 'module',
    route: '/dashboard/financial',
    anchor: 'admin-financial',
    label: { en: 'Financial Center', ar: 'المركز المالي' },
    keywords: { en: ['payments', 'payouts', 'balances'], ar: ['مدفوعات', 'دفعات', 'أرصدة'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-credits-page',
    type: 'feature',
    route: '/dashboard/credits',
    anchor: 'admin-credits',
    label: { en: 'Credits Engine', ar: 'نظام النقاط' },
    keywords: { en: ['credits', 'rewards', 'redemptions'], ar: ['نقاط', 'مكافآت', 'استبدال'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-attendance-page',
    type: 'feature',
    route: '/dashboard/attendance',
    anchor: 'admin-attendance',
    label: { en: 'Attendance Logs', ar: 'سجلات الحضور' },
    keywords: { en: ['attendance', 'logs'], ar: ['حضور', 'سجلات'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-reports-page',
    type: 'module',
    route: '/dashboard/reports',
    anchor: 'admin-reports',
    label: { en: 'Reports', ar: 'التقارير' },
    keywords: { en: ['analytics', 'reports', 'insights'], ar: ['تحليلات', 'تقارير', 'إحصائيات'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-messages-page',
    type: 'feature',
    route: '/dashboard/messages',
    anchor: 'admin-messages',
    label: { en: 'Messages Center', ar: 'مركز الرسائل' },
    keywords: { en: ['messages', 'chat', 'support'], ar: ['رسائل', 'محادثة', 'دعم'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-pages-page',
    type: 'settings',
    route: '/dashboard/pages',
    anchor: 'admin-pages',
    label: { en: 'Page Editor', ar: 'محرر الصفحات' },
    keywords: { en: ['pages', 'cms', 'content'], ar: ['صفحات', 'محتوى', 'تحرير'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-seo-page',
    type: 'settings',
    route: '/dashboard/seo',
    anchor: 'admin-seo',
    label: { en: 'SEO Settings', ar: 'إعدادات SEO' },
    keywords: { en: ['seo', 'meta', 'search engine'], ar: ['سيو', 'ميتا', 'محرك بحث'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-page',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings',
    label: { en: 'Platform Settings', ar: 'إعدادات المنصة' },
    keywords: { en: ['settings', 'appearance', 'branding'], ar: ['إعدادات', 'المظهر', 'الهوية'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-appearance-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-appearance',
    label: { en: 'Appearance & Branding', ar: 'المظهر والهوية' },
    keywords: { en: ['appearance', 'branding', 'logo', 'favicon', 'hero', 'colors'], ar: ['المظهر', 'الهوية', 'الشعار', 'أيقونة', 'الوان', 'هيرو'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-email-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-email',
    label: { en: 'Email SMTP Settings', ar: 'إعدادات البريد SMTP' },
    keywords: { en: ['smtp', 'email', 'host', 'port', 'tls', 'ssl', 'password reset'], ar: ['smtp', 'بريد', 'منفذ', 'مضيف', 'تشفير', 'اعادة تعيين'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-saas-config-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-saas-config',
    label: { en: 'SaaS Config', ar: 'إعدادات SaaS' },
    keywords: { en: ['saas', 'academy name', 'enable classroom', 'enable stripe', 'permissions'], ar: ['ساس', 'اسم الأكاديمية', 'تفعيل كلاس روم', 'تفعيل سترايب', 'صلاحيات'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-live-platforms-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-live-platforms',
    label: { en: 'Live Platforms Config', ar: 'إعدادات المنصات المباشرة' },
    keywords: { en: ['zoom', 'google meet', 'smrrtx', 'client id', 'client secret', 'calendar id', 'room link'], ar: ['زووم', 'جوجل ميت', 'سمرتيكس', 'معرف العميل', 'سر العميل', 'معرف التقويم', 'رابط الغرفة'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-payment-gateways-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-payment-gateways',
    label: { en: 'Payment Gateways', ar: 'بوابات الدفع' },
    keywords: { en: ['payment', 'paypal', 'stripe', 'webhook', 'price id', 'billing', 'currency'], ar: ['دفع', 'باي بال', 'سترايب', 'ويب هوك', 'معرف السعر', 'فوترة', 'عملة'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-ai-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-ai',
    label: { en: 'AI Integration Settings', ar: 'إعدادات تكامل الذكاء الاصطناعي' },
    keywords: { en: ['ai', 'gemini', 'openai', 'claude', 'api key', 'model', 'temperature', 'max tokens'], ar: ['ذكاء اصطناعي', 'جيميني', 'اوبن اي', 'كلود', 'مفتاح api', 'نموذج', 'درجة الحرارة', 'الرموز'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'admin-settings-media-section',
    type: 'settings',
    route: '/dashboard/settings',
    anchor: 'admin-settings-media',
    label: { en: 'Media Upload Settings', ar: 'إعدادات رفع الوسائط' },
    keywords: { en: ['media', 'upload', 'direct upload', 'links only', 'storage'], ar: ['وسائط', 'رفع', 'رفع مباشر', 'روابط فقط', 'تخزين'] },
    audience: [UserRole.ADMIN, UserRole.SUPER_ADMIN]
  },
  {
    id: 'student-profile-page',
    type: 'page',
    route: '/student-profile',
    label: { en: 'Student Profile', ar: 'الملف الشخصي للطالب' },
    description: { en: 'Student profile and account details', ar: 'الملف الشخصي للطالب وتفاصيل الحساب' },
    keywords: { en: ['profile', 'account', 'personal info'], ar: ['الملف الشخصي', 'الحساب', 'البيانات الشخصية'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  },
  {
    id: 'instructor-profile-page',
    type: 'page',
    route: '/my-instructor-profile',
    label: { en: 'Instructor Profile', ar: 'الملف الشخصي للمدرب' },
    description: { en: 'Instructor profile and public details', ar: 'ملف المدرب والتفاصيل العامة' },
    keywords: { en: ['profile', 'instructor profile', 'bio'], ar: ['الملف الشخصي', 'ملف المدرب', 'السيرة'] },
    audience: [UserRole.INSTRUCTOR, 'GUEST_INSTRUCTOR']
  },
  {
    id: 'course-player-page',
    type: 'module',
    route: '/course-player',
    label: { en: 'Course Player', ar: 'مشغل الدورة' },
    description: { en: 'Watch lessons and track course progress', ar: 'مشاهدة الدروس ومتابعة تقدم الدورة' },
    keywords: { en: ['player', 'lesson', 'watch', 'course content'], ar: ['مشغل', 'درس', 'مشاهدة', 'محتوى الدورة'] },
    audience: [UserRole.STUDENT, 'GUEST_STUDENT']
  }
];

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export const normalizeSearchText = (value: string) => {
  return value
    .normalize('NFKD')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const resolveEffectiveAudience = (user?: User | null): SearchAudience[] => {
  if (!user) return [];

  if (user.role === UserRole.GUEST) {
    if (user.guestRole === 'INSTRUCTOR') {
      return [UserRole.GUEST, 'GUEST_INSTRUCTOR', UserRole.INSTRUCTOR];
    }
    return [UserRole.GUEST, 'GUEST_STUDENT', UserRole.STUDENT];
  }

  if (user.role === UserRole.SUPER_ADMIN) {
    return [UserRole.SUPER_ADMIN, UserRole.ADMIN];
  }

  if (
    user.role === UserRole.STUDENT ||
    user.role === UserRole.INSTRUCTOR ||
    user.role === UserRole.ADMIN
  ) {
    return [user.role];
  }

  return [];
};

const canAccessItem = (item: GlobalSearchItem, user?: User | null) => {
  if (item.audience.includes('ALL')) return true;
  const effective = resolveEffectiveAudience(user);
  if (!effective.length) return false;
  return item.audience.some((audience) => effective.includes(audience));
};

const buildHaystack = (item: GlobalSearchItem) => {
  const routeTokens = item.route
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .join(' ');
  const anchorTokens = (item.anchor || '').replace(/-/g, ' ');
  const indexedContent = item.anchor ? SECTION_CONTENT_INDEX[item.anchor] : undefined;
  const text = [
    item.label.en,
    item.label.ar,
    item.description?.en,
    item.description?.ar,
    ...(item.content?.en || []),
    ...(item.content?.ar || []),
    ...(indexedContent?.en || []),
    ...(indexedContent?.ar || []),
    routeTokens,
    anchorTokens,
    ...(item.keywords?.en || []),
    ...(item.keywords?.ar || [])
  ]
    .filter(Boolean)
    .join(' ');
  return normalizeSearchText(text);
};

const splitWords = (text: string) => normalizeSearchText(text).split(' ').filter(Boolean);

const getWordPool = (item: GlobalSearchItem) => {
  const indexedContent = item.anchor ? SECTION_CONTENT_INDEX[item.anchor] : undefined;
  const words = [
    ...splitWords(item.label.en),
    ...splitWords(item.label.ar),
    ...splitWords(item.description?.en || ''),
    ...splitWords(item.description?.ar || ''),
    ...splitWords((item.content?.en || []).join(' ')),
    ...splitWords((item.content?.ar || []).join(' ')),
    ...splitWords((indexedContent?.en || []).join(' ')),
    ...splitWords((indexedContent?.ar || []).join(' ')),
    ...splitWords((item.keywords?.en || []).join(' ')),
    ...splitWords((item.keywords?.ar || []).join(' ')),
    ...splitWords(item.route.replace(/^\//, '').replace(/\//g, ' ')),
    ...splitWords((item.anchor || '').replace(/-/g, ' '))
  ];
  return Array.from(new Set(words));
};

const getItemScore = (item: GlobalSearchItem, query: string) => {
  const nQuery = normalizeSearchText(query);
  if (!nQuery) return 0;
  const queryTokens = nQuery.split(' ').filter(Boolean);

  const enLabel = normalizeSearchText(item.label.en);
  const arLabel = normalizeSearchText(item.label.ar);
  const haystack = buildHaystack(item);
  const words = getWordPool(item);

  const exactTokenMatch = words.includes(nQuery) || queryTokens.every((token) => words.includes(token));
  if (exactTokenMatch) {
    const labelBoost = enLabel === nQuery || arLabel === nQuery ? 40 : 0;
    const startsBoost = enLabel.startsWith(nQuery) || arLabel.startsWith(nQuery) ? 20 : 0;
    return 320 + labelBoost + startsBoost;
  }

  const partialTokenMatch =
    words.some((word) => word.startsWith(nQuery)) ||
    queryTokens.every((token) => words.some((word) => word.startsWith(token)));
  if (partialTokenMatch) {
    const labelBoost = enLabel.includes(nQuery) || arLabel.includes(nQuery) ? 25 : 0;
    return 220 + labelBoost;
  }

  const insideSentenceMatch =
    haystack.includes(nQuery) ||
    queryTokens.some((token) => token.length >= 2 && haystack.includes(token));
  if (insideSentenceMatch) {
    return 120;
  }

  return 0;
};

export const searchGlobalItems = (query: string, user?: User | null, limit = 20): GlobalSearchItem[] => {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  return GLOBAL_SEARCH_ITEMS
    .filter((item) => canAccessItem(item, user))
    .map((item) => ({ item, score: getItemScore(item, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.en.localeCompare(b.item.label.en))
    .slice(0, limit)
    .map((entry) => entry.item);
};
