import Stripe from 'stripe';
import { getTenantPool } from './db-manager.js';
import { centralPool, TenantRow } from '../central-db.js';
import { PaymentConfigService } from './payment-config.service.js';

const paymentConfigService = new PaymentConfigService();

export type CourseCheckoutData = {
  tenantId: string;
  tenantSlug: string;
  courseId: string;
  studentId: string;
  studentEmail: string;
  courseName: string;
  coursePrice: number;
  currency?: string;
};

export type CoursePaymentRecord = {
  id: string;
  user_id: string;
  course_id: string;
  amount: number;
  payment_method: string;
  payment_date: Date;
  receipt_url?: string;
  stripe_payment_intent_id?: string;
  stripe_session_id?: string;
};

/**
 * Virtual tenant row for central domain (main platform) course payments
 */
const CENTRAL_VIRTUAL_TENANT: TenantRow = {
  id: 'central',
  subdomain: 'central',
  company_name: 'Central Platform',
  status: 'active',
  subscription_plan: 'enterprise',
  database_url_encrypted: Buffer.from(''),
  database_name: '',
};

/**
 * Resolve tenant row - returns virtual central tenant for 'central' context
 */
export async function resolveTenantRow(tenantId: string): Promise<TenantRow> {
  if (tenantId === 'central') {
    return CENTRAL_VIRTUAL_TENANT;
  }
  const tenantResult = await centralPool.query(
    `SELECT * FROM tenants WHERE id = $1`,
    [tenantId]
  );
  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }
  return tenantResult.rows[0];
}

/**
 * Create a Stripe checkout session for course purchase
 */
export async function createCourseCheckoutSession(data: CourseCheckoutData): Promise<{
  sessionId: string;
  checkoutUrl: string;
}> {
  const {
    tenantId,
    tenantSlug,
    courseId,
    studentId,
    studentEmail,
    courseName,
    coursePrice,
    currency = 'USD'
  } = data;

  const frontendBaseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const isCentral = tenantId === 'central' || tenantSlug === 'central';

  let paymentConfig;
  if (isCentral) {
    // Central domain payment - use central payment config
    paymentConfig = await paymentConfigService.getCentralPaymentConfig();
  } else {
    // Tenant payment - verify tenant is active and get tenant payment config
    const tenantResult = await centralPool.query(
      `SELECT id, subdomain, status FROM tenants WHERE id = $1`,
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    const tenant = tenantResult.rows[0];

    if (tenant.status !== 'active') {
      throw new Error('Tenant is not active. Please ensure your subscription is current.');
    }

    const tenantPool = await getTenantPool(tenant);
    paymentConfig = await paymentConfigService.getTenantPaymentConfig(tenantPool);
  }

  if (!paymentConfig.stripeEnabled || !paymentConfig.stripeSecretKey) {
    throw new Error('Stripe payment gateway is not configured. Please contact your administrator.');
  }

  // Initialize Stripe with tenant-specific secret key
  const stripe = new Stripe(paymentConfig.stripeSecretKey, {
    apiVersion: '2025-12-15.clover' as any,
  });

  const unitAmountCents = Math.round(coursePrice * 100);
  const orderId = `course_${courseId}_${studentId}`;
  const metadata: Record<string, string> = {
    type: 'course_purchase',
    tenant_id: String(tenantId),
    tenant_slug: String(tenantSlug),
    course_id: String(courseId),
    course_name: String(courseName),
    product_id: String(courseId),
    product_name: String(courseName),
    student_id: String(studentId),
    student_email: String(studentEmail),
    amount: String(coursePrice),
    currency: String(currency).toUpperCase(),
    order_id: orderId,
  };

  // Create checkout session
  const protocol = process.env.PROTOCOL || 'https';
  const mainDomain = process.env.MAIN_DOMAIN || 'betacdmy.com';
  const isLocalFrontend = /localhost|127\.0\.0\.1/.test(frontendBaseUrl);
  let tenantOrigin: string;
  if (isCentral) {
    tenantOrigin = isLocalFrontend ? frontendBaseUrl : `${protocol}://www.${mainDomain}`;
  } else {
    tenantOrigin = isLocalFrontend
      ? frontendBaseUrl
      : `${protocol}://${tenantSlug}.${mainDomain}`;
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment', // One-time payment for course
    client_reference_id: orderId,
    line_items: [
      {
        price_data: {
          currency: currency.toLowerCase(),
          product_data: {
            name: courseName,
            description: `Course enrollment for ${courseName}`,
          },
          unit_amount: unitAmountCents, // Convert to cents
        },
        quantity: 1,
      },
    ],
    customer_email: studentEmail,
    metadata,
    success_url: `${tenantOrigin}/enrollment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${tenantOrigin}/courses/${courseId}`,
  });

  return {
    sessionId: session.id,
    checkoutUrl: session.url || '',
  };
}

/**
 * Record course payment in tenant database
 */
export async function recordCoursePayment(
  tenant: TenantRow,
  payment: {
    userId: string;
    courseId: string;
    amount: number;
    paymentMethod: string;
    stripePaymentIntentId?: string;
    stripeSessionId?: string;
    receiptUrl?: string;
  }
): Promise<CoursePaymentRecord> {
  const pool = await getTenantPool(tenant);

  // Get student and course details
  const studentResult = await pool.query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [payment.userId]
  );

  const courseResult = await pool.query(
    `SELECT id, title, instructor FROM courses WHERE id = $1`,
    [payment.courseId]
  );

  if (studentResult.rows.length === 0) {
    throw new Error(`Student ${payment.userId} not found`);
  }

  if (courseResult.rows.length === 0) {
    throw new Error(`Course ${payment.courseId} not found`);
  }

  const student = studentResult.rows[0];
  const course = courseResult.rows[0];

  // Preserve compatibility with schemas that store instructor name directly
  const instructorName = course.instructor || 'Unknown';
  const instructorId = null;

  // Generate receipt ID
  const receiptId = payment.stripeSessionId 
    ? `STRIPE-${payment.stripeSessionId.substring(0, 20)}`
    : `PAYMENT-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  const result = await pool.query(
    `INSERT INTO course_payments 
      (receipt_id, student_id, student_name, student_email, course_id, course_title, 
       instructor_id, instructor_name, course_price, amount, payment_method, 
       stripe_session_id, stripe_payment_intent_id, receipt_url, received_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
    RETURNING id, student_id as user_id, course_id, amount, payment_method, received_at as payment_date, 
              receipt_url, stripe_payment_intent_id, stripe_session_id`,
    [
      receiptId,
      payment.userId,
      student.name,
      student.email,
      payment.courseId,
      course.title,
      instructorId,
      instructorName,
      payment.amount,
      payment.amount,
      payment.paymentMethod,
      payment.stripeSessionId,
      payment.stripePaymentIntentId,
      payment.receiptUrl,
    ]
  );

  return result.rows[0];
}

/**
 * Enroll student in course
 */
export async function enrollStudentInCourse(
  tenant: TenantRow,
  data: {
    userId: string;
    courseId: string;
  }
): Promise<void> {
  const pool = await getTenantPool(tenant);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      enrolled_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(user_id, course_id)
    );
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments (user_id);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_id);');

  // Check if already enrolled
  const existingEnrollment = await pool.query(
    `SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2`,
    [data.userId, data.courseId]
  );

  if (existingEnrollment.rows.length > 0) {
    console.log(`Student ${data.userId} already enrolled in course ${data.courseId}`);
    return;
  }

  const statusColumn = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'enrollments'
       AND column_name = 'status'
     LIMIT 1`
  );

  if (statusColumn.rowCount) {
    await pool.query(
      `INSERT INTO enrollments (user_id, course_id, enrolled_at, status)
      VALUES ($1, $2, NOW(), 'active')`,
      [data.userId, data.courseId]
    );
  } else {
    await pool.query(
      `INSERT INTO enrollments (user_id, course_id, enrolled_at)
      VALUES ($1, $2, NOW())`,
      [data.userId, data.courseId]
    );
  }

  const enrolledCoursesColumn = await pool.query(
    `SELECT udt_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'enrolled_courses'
     LIMIT 1`
  );

  if (enrolledCoursesColumn.rowCount) {
    const udtName = enrolledCoursesColumn.rows[0]?.udt_name as string | undefined;
    const arrayType = udtName === '_uuid' ? 'uuid' : 'text';
    await pool.query(
      `UPDATE users
         SET enrolled_courses = CASE
           WHEN enrolled_courses @> ARRAY[$2]::${arrayType}[] THEN enrolled_courses
           ELSE array_append(COALESCE(enrolled_courses, ARRAY[]::${arrayType}[]), $2::${arrayType})
         END
       WHERE id = $1`,
      [data.userId, data.courseId]
    );
  }

  console.log(`Successfully enrolled student ${data.userId} in course ${data.courseId}`);
}

/**
 * Handle successful course payment from Stripe webhook
 */
export async function handleCoursePurchaseSuccess(session: Stripe.Checkout.Session): Promise<void> {
  const {
    tenant_id,
    tenant_slug,
    course_id,
    student_id,
  } = session.metadata || {};

  if (!tenant_id || !course_id || !student_id) {
    throw new Error('Missing required metadata in checkout session');
  }

  // Resolve tenant - supports both real tenants and 'central' virtual tenant
  const tenant = await resolveTenantRow(tenant_id);

  const existingPayment = await getCoursePaymentBySessionId(tenant, session.id);
  if (existingPayment) {
    console.log(`Course purchase already recorded for session ${session.id}, ensuring enrollment is complete`);
    // Payment exists but enrollment may have failed previously - always ensure enrollment
    await enrollStudentInCourse(tenant, {
      userId: student_id,
      courseId: course_id,
    });
    return;
  }

  // Get payment configuration - central or tenant-specific
  const tenantPool = await getTenantPool(tenant);
  const isCentralTenant = tenant.id === 'central';
  const paymentConfig = isCentralTenant
    ? await paymentConfigService.getCentralPaymentConfig()
    : await paymentConfigService.getTenantPaymentConfig(tenantPool);

  if (!paymentConfig.stripeSecretKey) {
    throw new Error('Stripe not configured');
  }

  // Initialize Stripe with tenant-specific secret key
  const stripe = new Stripe(paymentConfig.stripeSecretKey, {
    apiVersion: '2025-12-15.clover' as any,
  });

  // Get payment intent details for receipt URL
  const paymentIntentId = session.payment_intent as string;
  let receiptUrl: string | undefined;
  
  if (paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const chargeId = (paymentIntent.latest_charge as any)?.id || (paymentIntent as any).charges?.data?.[0]?.id;
    
    if (chargeId) {
      const charge = await stripe.charges.retrieve(chargeId);
      receiptUrl = charge.receipt_url || undefined;
    }
  }

  // Record payment in tenant database
  await recordCoursePayment(tenant, {
    userId: student_id,
    courseId: course_id,
    amount: (session.amount_total || 0) / 100, // Convert from cents
    paymentMethod: 'ONLINE',
    stripePaymentIntentId: paymentIntentId,
    stripeSessionId: session.id,
    receiptUrl,
  });

  // Enroll student in course
  await enrollStudentInCourse(tenant, {
    userId: student_id,
    courseId: course_id,
  });

  console.log(`Course purchase completed: Student ${student_id} enrolled in course ${course_id} (Tenant: ${tenant_slug})`);
}

/**
 * Confirm Stripe checkout session for course purchase (fallback if webhook is delayed)
 */
export async function confirmCoursePaymentSession(tenant: TenantRow, sessionId: string): Promise<{ status: 'paid' | 'unpaid' }> {
  const tenantPool = await getTenantPool(tenant);
  const isCentralTenant = tenant.id === 'central';
  const paymentConfig = isCentralTenant
    ? await paymentConfigService.getCentralPaymentConfig()
    : await paymentConfigService.getTenantPaymentConfig(tenantPool);

  if (!paymentConfig.stripeSecretKey) {
    throw new Error('Stripe not configured');
  }

  const stripe = new Stripe(paymentConfig.stripeSecretKey, {
    apiVersion: '2025-12-15.clover' as any,
  });

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    return { status: 'unpaid' };
  }

  const metadataTenantId = session.metadata?.tenant_id;
  if (metadataTenantId && metadataTenantId !== tenant.id) {
    throw new Error('Tenant mismatch for checkout session');
  }

  await handleCoursePurchaseSuccess(session);
  return { status: 'paid' };
}

/**
 * Get course payment details by session ID
 */
export async function getCoursePaymentBySessionId(
  tenant: TenantRow,
  sessionId: string
): Promise<CoursePaymentRecord | null> {
  const pool = await getTenantPool(tenant);

  const result = await pool.query(
    `SELECT id, student_id as user_id, course_id, amount, payment_method, 
            received_at as payment_date, receipt_url, stripe_payment_intent_id, stripe_session_id
     FROM course_payments 
     WHERE stripe_session_id = $1`,
    [sessionId]
  );

  return result.rows[0] || null;
}

/**
 * Get student's course payments
 */
export async function getStudentCoursePayments(
  tenant: TenantRow,
  studentId: string
): Promise<CoursePaymentRecord[]> {
  const pool = await getTenantPool(tenant);

  const result = await pool.query(
    `SELECT id, student_id as user_id, course_id, amount, payment_method, 
            received_at as payment_date, receipt_url, stripe_payment_intent_id, stripe_session_id
     FROM course_payments 
     WHERE student_id = $1 
     ORDER BY received_at DESC`,
    [studentId]
  );

  return result.rows;
}
