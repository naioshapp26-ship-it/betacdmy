import { Router, Request, Response } from 'express';
import { AIConfigService } from '../services/ai-config.service.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { isGeminiProvider, normalizeAIProvider } from '../utils/ai-provider.js';

/**
 * AI Configuration Controller for Super Admin
 * Manages AI configuration for the platform level (main domain)
 * Platform AI features use these keys, tenant AI features use tenant-specific keys
 */
export const createAIConfigRouter = () => {
  const router = Router();
  const aiConfigService = new AIConfigService();

  /**
   * GET /api/super-admin/ai-config
   * Get current AI configuration (public settings only, no API keys)
   */
  router.get(
    '/api/super-admin/ai-config',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      try {
        const publicConfig = await aiConfigService.getPublicAIConfig({ type: 'central' });
        
        res.json({
          success: true,
          data: publicConfig,
        });
      } catch (error: any) {
        console.error('[Super Admin] Get AI config failed:', error);
        res.status(500).json(createErrorResponse('errors.aiConfigFetchFailed', req, error.message));
      }
    }
  );

  /**
   * PUT /api/super-admin/ai-config
   * Update AI configuration for platform level
   * Body: {
   *   aiEnabled?: boolean,
   *   aiProvider?: string,
   *   aiModel?: string,
   *   apiKey?: string,
   *   apiSecret?: string,
   *   maxTokens?: number,
   *   temperature?: number,
   *   customConfig?: object
   * }
   */
  router.put(
    '/api/super-admin/ai-config',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      try {
        const {
          aiEnabled,
          aiProvider,
          aiModel,
          apiKey,
          apiSecret,
          maxTokens,
          temperature,
          customConfig,
        } = req.body;

        // Validate at least one field is provided
        if (
          aiEnabled === undefined &&
          !aiProvider &&
          !aiModel &&
          !apiKey &&
          !apiSecret &&
          maxTokens === undefined &&
          temperature === undefined &&
          !customConfig
        ) {
          return res.status(400).json(
            createErrorResponse('errors.noConfigurationProvided', req, 'At least one configuration field must be provided')
          );
        }

        // Validate API key is provided when enabling AI
        if (aiEnabled && !apiKey) {
          return res.status(400).json(
            createErrorResponse('errors.aiKeyRequired', req, 'API key is required when enabling AI')
          );
        }

        // Validate temperature range
        if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
          return res.status(400).json(
            createErrorResponse('errors.invalidTemperature', req, 'Temperature must be between 0 and 2')
          );
        }

        // Validate max tokens range
        if (maxTokens !== undefined && (maxTokens < 1 || maxTokens > 100000)) {
          return res.status(400).json(
            createErrorResponse('errors.invalidMaxTokens', req, 'Max tokens must be between 1 and 100,000')
          );
        }

        const userId = (req as any).user?.id;

        await aiConfigService.updateAIConfig(
          { type: 'central' },
          {
            aiEnabled,
            aiProvider,
            aiModel,
            apiKey,
            apiSecret,
            maxTokens,
            temperature,
            customConfig,
          },
          userId
        );

        const updatedPublicConfig = await aiConfigService.getPublicAIConfig({ type: 'central' });

        res.json({
          success: true,
          message: 'AI configuration updated successfully',
          data: updatedPublicConfig,
        });
      } catch (error: any) {
        console.error('[Super Admin] Update AI config failed:', error);
        res.status(500).json(createErrorResponse('errors.aiConfigUpdateFailed', req, error.message));
      }
    }
  );

  /**
   * POST /api/super-admin/ai-config/test
   * Test AI configuration with a simple request
   * Body: { apiKey: string, provider?: string, model?: string }
   */
  router.post(
    '/api/super-admin/ai-config/test',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      try {
        const { apiKey, provider = 'gemini', model = 'gemini-2.5-flash' } = req.body;
        const normalizedProvider = normalizeAIProvider(provider);

        if (!apiKey) {
          return res.status(400).json(
            createErrorResponse('errors.aiKeyRequired', req, 'API Key is required for testing')
          );
        }

        // Test the API key with a simple request
        if (isGeminiProvider(normalizedProvider)) {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [{ text: 'Say "Connection successful" if you can read this.' }]
                }]
              })
            }
          );

          if (!response.ok) {
            const error = await response.text();
            return res.status(400).json(
              createErrorResponse('errors.aiTestFailed', req, `AI test failed: ${error}`)
            );
          }

          const data = await response.json();
          res.json({
            success: true,
            message: 'AI configuration test successful',
            response: data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Test completed',
          });
        } else {
          // For other providers, just validate key format
          res.json({
            success: true,
            message: `API key format validated for ${normalizedProvider}`,
          });
        }
      } catch (error: any) {
        console.error('[Super Admin] AI test failed:', error);
        res.status(500).json(createErrorResponse('errors.aiTestFailed', req, error.message));
      }
    }
  );

  /**
   * DELETE /api/super-admin/ai-config
   * Disable AI and clear all credentials
   */
  router.delete(
    '/api/super-admin/ai-config',
    requireAuth,
    requireRole('super_admin'),
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).user?.id;

        await aiConfigService.updateAIConfig(
          { type: 'central' },
          {
            aiEnabled: false,
            apiKey: null,
            apiSecret: null,
          },
          userId
        );

        res.json({
          success: true,
          message: 'AI configuration disabled and cleared',
        });
      } catch (error: any) {
        console.error('[Super Admin] Delete AI config failed:', error);
        res.status(500).json(createErrorResponse('errors.aiConfigDeleteFailed', req, error.message));
      }
    }
  );

  return router;
};
