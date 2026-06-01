import { Router, Request, Response } from 'express';
import {
  createCourseCheckoutSession,
  confirmCoursePaymentSession,
  getCoursePaymentBySessionId,
  getStudentCoursePayments,
  resolveTenantRow
} from '../services/course-payment.service.js';
import { getSingleParam } from '../utils/request-params.js';

export const createCoursePaymentRouter = () => {
  const router = Router();

  /**
   * POST /api/course-payment/checkout
   * Create a Stripe checkout session for course purchase
   */
  router.post('/api/course-payment/checkout', async (req: Request, res: Response) => {
    try {
      const {
        tenantId,
        tenantSlug,
        courseId,
        studentId,
        studentEmail,
        courseName,
        coursePrice,
        currency
      } = req.body;

      // Validate required fields
      if (!tenantId || !tenantSlug || !courseId || !studentId || !studentEmail || !courseName || coursePrice === undefined) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['tenantId', 'tenantSlug', 'courseId', 'studentId', 'studentEmail', 'courseName', 'coursePrice']
        });
      }

      // Create checkout session
      const result = await createCourseCheckoutSession({
        tenantId,
        tenantSlug,
        courseId,
        studentId,
        studentEmail,
        courseName,
        coursePrice,
        currency
      });

      res.json(result);
    } catch (error: any) {
      console.error('[Course Payment] Checkout creation failed:', error);
      res.status(500).json({
        error: 'Failed to create checkout session',
        message: error.message
      });
    }
  });

  /**
   * GET /api/course-payment/session/:sessionId
   * Get course payment details by Stripe session ID
   */
  router.get('/api/course-payment/session/:sessionId', async (req: Request, res: Response) => {
    try {
      const sessionId = getSingleParam(req.params.sessionId);
      const tenantId = getSingleParam(req.query.tenantId);

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId parameter' });
      }

      if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenantId query parameter' });
      }

      const tenant = await resolveTenantRow(tenantId);
      const payment = await getCoursePaymentBySessionId(tenant, sessionId);

      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      res.json(payment);
    } catch (error: any) {
      console.error('[Course Payment] Failed to get payment:', error);
      res.status(500).json({
        error: 'Failed to retrieve payment',
        message: error.message
      });
    }
  });

  /**
   * POST /api/course-payment/confirm
   * Confirm Stripe checkout session for course purchase (fallback)
   */
  router.post('/api/course-payment/confirm', async (req: Request, res: Response) => {
    try {
      const { tenantId, sessionId } = req.body || {};

      if (!tenantId || !sessionId) {
        return res.status(400).json({ error: 'Missing tenantId or sessionId' });
      }

      const tenant = await resolveTenantRow(tenantId);
      const result = await confirmCoursePaymentSession(tenant, sessionId);

      res.json({ success: true, status: result.status });
    } catch (error: any) {
      console.error('[Course Payment] Confirm session failed:', error);
      res.status(500).json({
        error: 'Failed to confirm payment',
        message: error.message
      });
    }
  });

  /**
   * GET /api/course-payment/student/:studentId
   * Get all course payments for a student
   */
  router.get('/api/course-payment/student/:studentId', async (req: Request, res: Response) => {
    try {
      const studentId = getSingleParam(req.params.studentId);
      const tenantId = getSingleParam(req.query.tenantId);

      if (!studentId) {
        return res.status(400).json({ error: 'Missing studentId parameter' });
      }

      if (!tenantId) {
        return res.status(400).json({ error: 'Missing tenantId query parameter' });
      }

      const tenant = await resolveTenantRow(tenantId);
      const payments = await getStudentCoursePayments(tenant, studentId);

      res.json(payments);
    } catch (error: any) {
      console.error('[Course Payment] Failed to get student payments:', error);
      res.status(500).json({
        error: 'Failed to retrieve student payments',
        message: error.message
      });
    }
  });

  return router;
};
