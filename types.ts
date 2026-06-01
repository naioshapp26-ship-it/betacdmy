
export enum UserRole {
  STUDENT = 'STUDENT',
  MEMBER = 'MEMBER',
  INSTRUCTOR = 'INSTRUCTOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  VISITOR = 'VISITOR',
  GUEST = 'GUEST'
}

export enum ViewState {
  HOME = 'HOME',
  ADS = 'ADS',
  AD_DETAIL = 'AD_DETAIL',
  COURSES = 'COURSES',
  SERVICES = 'SERVICES',
  WHO_WE_ARE = 'WHO_WE_ARE',
  CAREERS = 'CAREERS',
  CONTACT_US = 'CONTACT_US',
  BLOG = 'BLOG',
  BLOG_POST = 'BLOG_POST',
  CONTACT = 'CONTACT',
  LOGIN = 'LOGIN',
  FORGOT_PASSWORD = 'FORGOT_PASSWORD',
  RESET_PASSWORD = 'RESET_PASSWORD',
  REGISTER = 'REGISTER',
  DASHBOARD = 'DASHBOARD',
  COURSE_VIEW = 'COURSE_VIEW',
  COURSE_PLAYER = 'COURSE_PLAYER',
  PRIVACY = 'PRIVACY',
  TOS = 'TOS',
  ENROLLMENT = 'ENROLLMENT',
  STUDENT_PROFILE = 'STUDENT_PROFILE',
  INSTRUCTOR_PROFILE = 'INSTRUCTOR_PROFILE',
  PUBLIC_INSTRUCTOR_PROFILE = 'PUBLIC_INSTRUCTOR_PROFILE',
  NOT_FOUND = 'NOT_FOUND'
}

export interface User {
  id: string;
  publicUserId?: string;
  name: string;
  email: string;
  nationalId?: string;
  phoneCountryCode?: string;
  gender?: 'male' | 'female';
  followUpStatus?: string;
  role: UserRole;
  avatar?: string;
  // Guest mode specific
  guestRole?: 'STUDENT' | 'INSTRUCTOR';
  // CRM fields
  status?: 'Active' | 'Inactive' | 'Pending' | 'Suspended';
  phone?: string;
  joinDate?: string;
  lastActive?: string;
  lastLoginDate?: string; // YYYY-MM-DD
  enrolledCourses?: string[]; // Course IDs
  progress?: number; // Overall progress average
  notes?: string; // Internal notes for CRM
  plan?: 'Free' | 'Starter' | 'Pro' | 'Enterprise';
  // Rewards
  credits: number;
  streak: number;
  // Instructor Fields
  expertise?: string; // Kept for backward compatibility or mapping
  specialization?: string;
  bio?: string;
  portfolioUrl?: string;
  yearsOfExperience?: number;
  certifications?: string[]; // URLs or Base64 strings
  socialLinks?: {
    linkedin?: string;
  };
}

export interface RewardsConfig {
  dailyLogin: number;
  lessonCompletion: number;
  quizPass: number;
  assignmentSubmission: number;
  creditsPerCurrencyUnit?: number;
  currencyCode?: string;
}

export interface CourseCategory {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export type RewardActivityType = 'LESSON_COMPLETION' | 'ASSIGNMENT_SUBMISSION' | 'QUIZ_PASS' | 'COURSE_COMPLETION';

export interface RewardGrantRequest {
  amount: number;
  reason: string;
  rewardType: RewardActivityType;
  rewardKey: string;
  courseId: string;
  moduleId?: string;
  itemId?: string;
}

export type CreditTransactionAction = 'EARN' | 'DEDUCT' | 'REDEEM';
export type CreditTransactionSource = 'SYSTEM' | 'INSTRUCTOR' | 'ADMIN' | 'COURSE_PLAYER';

export interface CreditTransaction {
  id: string;
  userId: string;
  userName?: string;
  actorId?: string;
  actorName?: string;
  amount: number;
  actionType: CreditTransactionAction;
  source: CreditTransactionSource;
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

export type CreditRedemptionType = 'FREE_COURSE' | 'DISCOUNT' | 'SCHOLARSHIP';
export type CreditRedemptionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';

export interface CreditRedemptionOption {
  id: string;
  title: string;
  type: CreditRedemptionType;
  description?: string;
  requiredCredits: number;
  metadata?: Record<string, any>;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreditRedemption {
  id: string;
  userId: string;
  optionId: string;
  optionTitle?: string;
  creditsSpent: number;
  status: CreditRedemptionStatus;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface TestQuestion {
  id: string;
  question: string;
  type: 'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'ESSAY';
  options?: string[]; // For multiple choice
  correctAnswer?: string | number; // For multiple choice (index) or short answer
  points?: number;
}

export interface CourseTest {
  enabled: boolean;
  questions: TestQuestion[];
  aiGradingRubric?: string; // Optional AI grading instructions
}

export interface SeoOverride {
  title_en?: string;
  title_ar?: string;
  description_en?: string;
  description_ar?: string;
  keywords_en?: string;
  keywords_ar?: string;
  canonical_url?: string;
  robots?: string;
  indexable?: boolean;
  og_title_en?: string;
  og_title_ar?: string;
  og_description_en?: string;
  og_description_ar?: string;
  og_image_url?: string;
  og_type?: string;
  og_site_name?: string;
  twitter_card?: string;
  twitter_title_en?: string;
  twitter_title_ar?: string;
  twitter_description_en?: string;
  twitter_description_ar?: string;
  twitter_image_url?: string;
  jsonld_en?: string;
  jsonld_ar?: string;
  locale?: string;
  locale_alternate?: string;
  sitemap_priority?: number;
  sitemap_changefreq?: string;
}

export interface Course {
  id: string;
  title: string;
  description: string;
  instructor: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  category?: 'Technology' | 'Business' | 'Finance' | 'Marketing' | 'Design' | 'Languages' | 'Personal Development' | 'Health & Fitness' | 'Academics' | 'Professional Skills';
  price: number;
  originalPrice?: number; // Original price before discount
  discountPercentage?: number; // Discount percentage if applicable
  discountCode?: string; // Discount code if applicable
  thumbnail: string;
  modules: CourseModule[]; // These are now "Lessons"
  syncSessions?: string[]; // Dates for live classes
  preCourseTest?: CourseTest;
  postCourseTest?: CourseTest;
  duration?: number; // Course duration in hours
  createdAt?: string; // Timestamp when course was created
  createdBy?: string; // User ID who created the course
  createdByName?: string; // Name of the user who created the course
  createdByEmail?: string; // Email of the user who created the course
  language?: 'ar' | 'en' | 'fr' | 'es'; // Course language
  status?: 'draft' | 'published'; // Course status
  targetAudience?: string; // Who should take this course
  prerequisites?: string; // What students need to know beforehand
  learningOutcomes?: string; // What students will learn
  seoOverride?: SeoOverride;
}

export interface CourseProgress {
  id: string;
  userId: string;
  courseId: string;
  completedItemIds: string[];
  totalItems: number;
  completedCount: number;
  progressPercent: number;
  preTestCompleted?: boolean;
  postTestCompleted?: boolean;
  preTestScore?: number;
  postTestScore?: number;
  lastActivity?: string;
}

export interface CourseModule {
  id: string;
  title: string; // Lesson Title
  items: CourseContentItem[]; // List of content in this lesson
  completed?: boolean; // True if all items are completed
  timeSpent?: number; // Seconds spent on this lesson
}

export interface CourseContentItem {
  id: string;
  type: 'VIDEO' | 'TEXT' | 'QUIZ' | 'ASSIGNMENT' | 'PDF' | 'PPT' | 'IMAGE' | 'INTERACTIVE_EXERCISE';
  title: string;
  content?: string; // Text content, Video URL, or Base64 File Data
  question?: string; // For Quiz/Assignment/Interactive Exercise
  attachment?: string; // Base64 data for auxiliary content in Quizzes/Assignments
  attachmentType?: 'PDF' | 'PPT' | 'IMAGE' | 'VIDEO'; // Type of the attachment
  completed?: boolean;
  score?: number;
  feedback?: string;
  autoGrade?: boolean; // If true, AI grades it immediately
  gradingRubric?: string; // Instructions for the AI grader
  gradingStatus?: 'PENDING' | 'GRADED';
  lastAttemptDate?: string; // Date of last attempt
  exerciseData?: any; // For Interactive Exercise - stores exercise content
}

export interface AssignmentSubmission {
  id: string;
  studentId: string;
  studentName?: string | null;
  studentEmail?: string | null;
  instructorId?: string | null;
  courseId: string;
  courseTitle?: string | null;
  assignmentId?: string | null;
  itemId?: string | null;
  submissionType: 'COURSE_ITEM' | 'INSTRUCTOR_ASSIGNMENT' | 'COURSE_TEST';
  status: 'PENDING' | 'GRADED';
  score?: number | null;
  feedback?: string | null;
  prompt?: string | null;
  rubric?: string | null;
  answer?: string | null;
  itemTitle?: string | null;
  moduleTitle?: string | null;
  testType?: 'pre' | 'post' | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  gradedAt?: string | null;
}

export interface BlogPost {
  id: string;
  slug: string; // URL-friendly identifier for SEO
  title: string;
  excerpt: string;
  content: string;
  author: string;
  date: string;
  image: string;
  isFeatured?: boolean; // For "Important News"
  status: 'DRAFT' | 'PUBLISHED';
  category?: 'Technology' | 'Business' | 'Finance' | 'Marketing' | 'Design' | 'Languages' | 'Personal Development' | 'Health & Fitness' | 'Academics' | 'Professional Skills';
  videoUrl?: string; // URL for embedded videos (e.g., YouTube)
  uploadedImagePath?: string; // Path to uploaded image file
  uploadedVideoPath?: string; // Path to uploaded video file
  seoOverride?: SeoOverride;
}

export type AdStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface AdCategory {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export type MediaItemType = 'image' | 'video';

export interface MediaGalleryItem {
  id: string;
  url: string;
  mediaType: MediaItemType;
  order: number;
}

export interface Ad {
  id: string;
  title: string;
  description: string;
  categoryId?: string | null;
  categoryName?: string | null;
  price?: number | null;
  location?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  imageUrl?: string | null;
  mediaType?: 'image' | 'video';
  mediaUrl?: string | null;
  gallery?: Array<MediaGalleryItem | string>;
  status: AdStatus;
  isFeatured?: boolean;
  publishDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AdAnnouncement {
  id: string;
  text?: string;
  textEn?: string;
  textAr?: string;
  enabled: boolean;
  showInTopBar: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExamResult {
  examId: string;
  score: number;
  feedback: string;
  passed: boolean;
  date: string;
}

export type NotificationCategory =
  | 'SYSTEM'
  | 'COURSE_UPDATE'
  | 'ASSIGNMENT_DEADLINE'
  | 'EXAM_RESULT'
  | 'NEW_CONTENT'
  | 'LIVE_MEETING'
  | 'MESSAGE';

export interface NotificationMetadata {
  [key: string]: any;
}

export interface Notification {
  id: string;
  userId: string;
  actorId?: string;
  courseId?: string;
  category: NotificationCategory;
  type: 'INFO' | 'SUCCESS' | 'WARNING';
  message: string;
  metadata?: NotificationMetadata;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export type PaymentMethod = 'ONLINE' | 'CASH' | 'TRANSFER' | 'MANUAL';

export interface PaymentRecord {
  id: string;
  receiptId: string;
  studentId: string;
  studentName: string;
  studentEmail?: string | null;
  courseId: string;
  courseTitle: string;
  instructorName?: string | null;
  instructorId?: string | null;
  coursePrice?: number | null;
  amount: number;
  paymentMethod: PaymentMethod | string;
  collectedBy?: string | null;
  collectedById?: string | null;
  notes?: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstructorPayout {
  id: string;
  instructorId: string;
  instructorName: string;
  amount: number;
  paymentMethod: PaymentMethod | string;
  courseId?: string | null;
  courseTitle?: string | null;
  reference?: string | null;
  notes?: string | null;
  recordedById?: string | null;
  recordedByName?: string | null;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
}

export type CoursePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface CourseFinancialSummary {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail?: string | null;
  courseId: string;
  courseTitle: string;
  instructorName?: string | null;
  coursePrice: number;
  totalPaid: number;
  remainingBalance: number;
  status: CoursePaymentStatus;
  lastPaymentAt?: string | null;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'LATE';
  durationSeconds?: number;
  durationMinutes?: number;
  itemsCompleted?: number;
  milestoneEvents?: number;
  lastActiveAt?: string;
}

export interface Certificate {
  id: string;
  userId: string;
  userName: string;
  courseId: string;
  courseTitle: string;
  courseLevel?: string;
  issueDate: string;
  certificationNumber: string;
  type: 'COMPLETION' | 'ATTENDANCE';
  url?: string;
}

export interface Discount {
  id: string;
  code: string;
  percentage: number;
  courseId?: string; // If undefined/null, it's a global discount (Admin only)
  courseTitle?: string;
  createdBy: string;
  expiryDate: string;
  usageCount: number;
}

export interface StaticPageContent {
  slug: string;
  title: string;
  content: string;
  updatedAt: string | null;
  updatedBy?: string | null;
}

export interface ServicesPageCardContent {
  title: string;
  description: string;
}

export interface ServicesPageContentPayload {
  sectionLabel?: string;
  sectionHeading?: string;
  cards: ServicesPageCardContent[];
}

export interface HomeWhyChooseCardContent {
  title: string;
  description: string;
}

export interface HomeFooterSocialLink {
  label: string;
  url: string;
}

export interface HomeFooterContentPayload {
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  copyrightText?: string;
  socialLinks: HomeFooterSocialLink[];
}

export interface HomePageContentPayload {
  whyChooseLabel?: string;
  whyChooseHeading?: string;
  whyChooseSubtitle?: string;
  whyChooseCards: HomeWhyChooseCardContent[];
  footer: HomeFooterContentPayload;
}

export interface CareerJob {
  id: string;
  title: string;
  description: string;
  location: string;
  employmentType: string;
  applyButtonText: string;
  isPublished: boolean;
  department?: string;
  sortOrder?: number;
  highlight?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CareerApplicationPayload {
  jobId: string;
  jobTitle: string;
  name: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  coverLetter?: string;
  jobSnapshot?: CareerJob;
}

export interface CareerApplication {
  id: string;
  jobId: string;
  jobTitle: string;
  name: string;
  email: string;
  phone?: string | null;
  resumeUrl?: string | null;
  coverLetter?: string | null;
  status?: string;
  jobSnapshot?: CareerJob | null;
  createdAt?: string | null;
}

export type LivePlatform = 'smrrtx' | 'zoom' | 'meet';

export type LiveClassStatus = 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

export interface LiveClassInvite {
  id: string;
  studentId: string;
  studentName?: string;
  email?: string;
  status: 'INVITED' | 'CONFIRMED' | 'DECLINED';
  createdAt: string;
}

export interface LiveClass {
  id: string;
  instructorId: string;
  instructorName?: string;
  topic: string;
  agenda?: string;
  startTime: string;
  platform: LivePlatform;
  providerMeetingId?: string;
  hostUrl: string;
  joinUrl: string;
  passcode?: string | null;
  inviteType: 'all' | 'specific';
  durationMinutes: number;
  status: LiveClassStatus;
  recordingUrl?: string;
  createdAt: string;
  invites: LiveClassInvite[];
}

export interface LivePlatformConfig {
  smrrtxEnabled: boolean;
  smrrtxPermanentRoomLink?: string;
  zoomEnabled: boolean;
  zoomConfigLink?: string;
  zoomClientId?: string;
  zoomClientSecret?: string;
  zoomAccountId?: string;
  zoomUserId?: string;
  meetEnabled: boolean;
  meetConfigLink?: string;
  googleSaEmail?: string;
  googleSaKey?: string;
  googleCalendarId?: string;
}

export type PaymentGateway = 'paypal' | 'stripe';

export interface PaymentGatewayConfig {
  paypalEnabled: boolean;
  paypalClientId?: string;
  paypalSecretKey?: string;
  stripeEnabled: boolean;
  stripePublicKey?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePriceBasicMonthly?: string | null;
  stripePriceBasicYearly?: string | null;
  stripePriceProMonthly?: string | null;
  stripePriceProYearly?: string | null;
  stripePriceEnterpriseMonthly?: string | null;
  stripePriceEnterpriseYearly?: string | null;
  planBasicMonthlyAmount?: number | null;
  planBasicMonthlyCurrency?: string | null;
  planBasicYearlyAmount?: number | null;
  planBasicYearlyCurrency?: string | null;
  planProMonthlyAmount?: number | null;
  planProMonthlyCurrency?: string | null;
  planProYearlyAmount?: number | null;
  planProYearlyCurrency?: string | null;
  planEnterpriseMonthlyAmount?: number | null;
  planEnterpriseMonthlyCurrency?: string | null;
  planEnterpriseYearlyAmount?: number | null;
  planEnterpriseYearlyCurrency?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface TenantBrandingConfig {
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  footerBackgroundColor?: string;
  announcementBarColor?: string;
  heroBackgroundColor?: string;
  heroBackgroundMode?: 'color' | 'image' | 'video';
  heroBackgroundImageUrl?: string;
  heroBackgroundVideoUrl?: string;
  heroMediaGallery?: Array<MediaGalleryItem | string>;
  footerText?: string;
  heroTitleLeading?: string;
  heroTitleHighlight?: string;
  heroSubtitle?: string;
  heroBadge?: string;
  primaryCtaLabel?: string;
  secondaryCtaLabel?: string;
  pricingCtaLabel?: string;
}

export interface TenantPricingPlan {
  id: string;
  title: string;
  price: string;
  description?: string;
  highlight?: boolean;
  features: string[];
}

export interface TenantPricingConfig {
  headline?: string;
  subheading?: string;
  ctaLabel?: string;
  plans: TenantPricingPlan[];
}

export interface TenantAppearanceConfig {
  branding: TenantBrandingConfig;
  pricing: TenantPricingConfig;
  updatedAt?: string;
  updatedBy?: string | null;
}

export type ConversationType = 'INSTRUCTOR_STUDENT' | 'STUDENT_STUDENT' | 'COURSE_GROUP' | 'ADMIN_USER';

export interface MessageParticipant {
  userId: string;
  name?: string;
  email?: string;
  role: UserRole;
  status?: string;
  canPost?: boolean;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  courseId?: string | null;
  senderId: string;
  senderName?: string;
  senderRole?: UserRole;
  targetUserId?: string | null;
  body: string;
  createdAt: string;
  deletedAt?: string | null;
}

export interface ConversationSummary {
  id: string;
  courseId?: string | null;
  courseTitle?: string | null;
  type: ConversationType;
  title?: string | null;
  createdBy?: string | null;
  createdAt: string;
  isMuted?: boolean;
  mutedUntil?: string | null;
  mutedReason?: string | null;
  participants: MessageParticipant[];
  lastMessage?: ConversationMessage | null;
  unreadCount: number;
}

export interface MessageBlock {
  id: string;
  userId: string;
  blockedBy: string;
  reason?: string | null;
  expiresAt?: string | null;
  active: boolean;
  createdAt: string;
}

export type MessagingScope = 'DIRECT' | 'COURSE_GROUP' | 'ADMIN';

export interface SEOSetting {
  id: string;
  page_path: string;
  title_en?: string;
  title_ar?: string;
  description_en?: string;
  description_ar?: string;
  keywords_en?: string;
  keywords_ar?: string;
  canonical_url?: string;
  robots?: string;
  indexable?: boolean;
  og_title_en?: string;
  og_title_ar?: string;
  og_description_en?: string;
  og_description_ar?: string;
  og_image_url?: string;
  og_type?: string;
  og_site_name?: string;
  twitter_card?: string;
  twitter_title_en?: string;
  twitter_title_ar?: string;
  twitter_description_en?: string;
  twitter_description_ar?: string;
  twitter_image_url?: string;
  jsonld_en?: string;
  jsonld_ar?: string;
  locale?: string;
  locale_alternate?: string;
  sitemap_priority?: number;
  sitemap_changefreq?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
  created_by_name?: string;
  updated_by_name?: string;
}
