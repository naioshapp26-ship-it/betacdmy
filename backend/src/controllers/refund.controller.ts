import { Router, Request, Response } from 'express';
import { RefundService } from '../services/refund.service.js';
import { requireTenantPool } from '../middleware/tenant-isolation-guard.js';
import { requireRole } from '../middleware/auth.middleware.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { getSingleParam } from '../utils/request-params.js';

const refundService = new RefundService();

export const createRefundRouter = () => {
  const router = Router();

  /**
   * POST /api/refunds/:paymentId
   * Process a refund for a course payment
   * Requires admin role
   */
  router.post(
    '/api/refunds/:paymentId',
    requireTenantPool,
    requireRole('ADMIN'),
    async (req: Request, res: Response) => {
      try {
        const paymentId = getSingleParam(req.params.paymentId);
        const { amount, reason } = req.body;
        const tenantId = (req as any).tenant?.id;
        const userId = (req as any).user?.id;

        if (!paymentId) {
          return res.status(400).json(
            createErrorResponse('errors.invalidInput', req, 'Payment ID is required')
          );
        }

        if (!tenantId || !userId) {
          return res.status(401).json(
            createErrorResponse('errors.unauthorized', req, 'Authentication required')
          );
        }

        // Validate amount if provided (for partial refunds)
        if (amount !== undefined) {
          const numAmount = parseFloat(amount);
          if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json(
              createErrorResponse('errors.invalidAmount', req, 'Invalid refund amount')
            );
          }
        }

        // Check if payment can be refunded
        const canRefundResult = await refundService.canRefund(tenantId, paymentId);
        if (!canRefundResult.canRefund) {
          return res.status(400).json(
            createErrorResponse('errors.refundNotAllowed', req, canRefundResult.reason || 'Refund not allowed')
          );
        }

        // Process the refund
        const result = await refundService.processRefund({
          paymentId,
          amount: amount ? parseFloat(amount) : undefined,
          reason,
          refundedBy: userId,
          tenantId
        });

        res.json({
          success: true,
          message: 'Refund processed successfully',
          data: result
        });

      } catch (error: any) {
        console.error('[Refund Controller] Process refund failed:', error);
        
        let errorMessage = 'Failed to process refund';
        let statusCode = 500;

        if (error.message.includes('Payment not found')) {
          statusCode = 404;
          errorMessage = error.message;
        } else if (error.message.includes('Refund amount exceeds') || 
                   error.message.includes('already been fully refunded')) {
          statusCode = 400;
          errorMessage = error.message;
        } else if (error.message.includes('Stripe')) {
          statusCode = 400;
          errorMessage = error.message;
        }

        res.status(statusCode).json(
          createErrorResponse('errors.paymentRefundFailed', req, errorMessage)
        );
      }
    }
  );

  /**
   * GET /api/refunds/payment/:paymentId
   * Get refunds for a specific payment
   */
  router.get(
    '/api/refunds/payment/:paymentId',
    requireTenantPool,
    requireRole('ADMIN'),
    async (req: Request, res: Response) => {
      try {
        const paymentId = getSingleParam(req.params.paymentId);
        const tenantId = (req as any).tenant?.id;

        if (!paymentId) {
          return res.status(400).json(
            createErrorResponse('errors.invalidInput', req, 'Payment ID is required')
          );
        }

        if (!tenantId) {
          return res.status(401).json(
            createErrorResponse('errors.unauthorized', req, 'Authentication required')
          );
        }

        const refunds = await refundService.getRefundsForPayment(tenantId, paymentId);

        res.json({
          success: true,
          data: refunds
        });

      } catch (error: any) {
        console.error('[Refund Controller] Get payment refunds failed:', error);
        res.status(500).json(
          createErrorResponse('errors.refundQueryFailed', req, error.message || 'Failed to retrieve refunds')
        );
      }
    }
  );

  /**
   * GET /api/refunds
   * Get all refunds for tenant with optional filters
   */
  router.get(
    '/api/refunds',
    requireTenantPool,
    requireRole('ADMIN'),
    async (req: Request, res: Response) => {
      try {
        const tenantId = (req as any).tenant?.id;

        if (!tenantId) {
          return res.status(401).json(
            createErrorResponse('errors.unauthorized', req, 'Authentication required')
          );
        }

        const refunds = await refundService.getTenantRefunds(tenantId);

        res.json({
          success: true,
          data: refunds,
          total: refunds.length
        });

      } catch (error: any) {
        console.error('[Refund Controller] Get tenant refunds failed:', error);
        res.status(500).json(
          createErrorResponse('errors.refundQueryFailed', req, error.message || 'Failed to retrieve refunds')
        );
      }
    }
  );

  /**
   * GET /api/refunds/check/:paymentId
   * Check if a payment can be refunded
   */
  router.get(
    '/api/refunds/check/:paymentId',
    requireTenantPool,
    requireRole('ADMIN'),
    async (req: Request, res: Response) => {
      try {
        const paymentId = getSingleParam(req.params.paymentId);
        const tenantId = (req as any).tenant?.id;

        if (!paymentId) {
          return res.status(400).json(
            createErrorResponse('errors.invalidInput', req, 'Payment ID is required')
          );
        }

        if (!tenantId) {
          return res.status(401).json(
            createErrorResponse('errors.unauthorized', req, 'Authentication required')
          );
        }

        const result = await refundService.canRefund(tenantId, paymentId);

        res.json({
          success: true,
          data: result
        });

      } catch (error: any) {
        console.error('[Refund Controller] Check refund eligibility failed:', error);
        res.status(500).json(
          createErrorResponse('errors.refundCheckFailed', req, error.message || 'Failed to check refund eligibility')
        );
      }
    }
  );

  return router;
};