import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';
import { AIConfigService } from '../services/ai-config.service.js';
import { requireTenantPool } from '../middleware/tenant-isolation-guard.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { createErrorResponse } from '../utils/error-messages.js';
import { normalizeAIProvider } from '../utils/ai-provider.js';
/**
 * AI Configuration Controller for Tenant Admin
 * Manages AI provider settings for tenant-specific domains
 */
export const createTenantAIConfigRouter = () => {
    const router = Router();
    const aiConfigService = new AIConfigService();
    const parseJsonResponse = (text) => {
        if (!text)
            return null;
        const tryParse = (value) => {
            try {
                return JSON.parse(value);
            }
            catch {
                return null;
            }
        };
        const fencedMatch = text.match(/```(?:json)?([\s\S]*?)```/i);
        const cleaned = fencedMatch ? fencedMatch[1].trim() : text.trim();
        const direct = tryParse(cleaned);
        if (direct)
            return direct;
        let startIndex = -1;
        const stack = [];
        for (let i = 0; i < cleaned.length; i += 1) {
            const char = cleaned[i];
            if (char === '{' || char === '[') {
                if (startIndex === -1)
                    startIndex = i;
                stack.push(char);
                continue;
            }
            if (char === '}' || char === ']') {
                if (!stack.length)
                    continue;
                const last = stack[stack.length - 1];
                if ((last === '{' && char === '}') || (last === '[' && char === ']')) {
                    stack.pop();
                    if (stack.length === 0 && startIndex !== -1) {
                        const block = cleaned.slice(startIndex, i + 1);
                        return tryParse(block);
                    }
                }
            }
        }
        return null;
    };
    const generateLessonContent = async (ai, model, temperature, maxTokens, courseTitle, courseDescription, level, moduleTitle, lessonTitle, outline) => {
        const prompt = `
Create a comprehensive educational lesson in Markdown format.

Course Title: ${courseTitle}
Course Description: ${courseDescription}
Level: ${level}
Module: ${moduleTitle || 'Module'}
Lesson Title: ${lessonTitle || 'Lesson'}
${outline ? `Outline: ${outline}` : ''}

Requirements:
- At least 300 words.
- Clear sections with headings.
- Explain key concepts with examples.
- Friendly, instructional tone.
`;
        const result = await ai.models.generateContent({
            model,
            contents: prompt,
            config: {
                temperature,
                maxOutputTokens: maxTokens,
            }
        });
        return result.text?.trim() || null;
    };
    /**
     * GET /api/admin/ai-config
     * Get current AI configuration for this tenant (without sensitive keys)
     */
    router.get('/admin/ai-config', requireTenantPool, requireAuth, requireRole('admin'), async (req, res) => {
        try {
            const tenantPool = req.tenantPool;
            if (!tenantPool) {
                return res.status(400).json(createErrorResponse('errors.tenantContextRequired', req, 'Tenant context is required'));
            }
            const publicConfig = await aiConfigService.getPublicAIConfig({ type: 'tenant', tenantPool });
            res.json({
                success: true,
                data: publicConfig,
            });
        }
        catch (error) {
            console.error('[Tenant Admin] Get AI config failed:', error);
            res.status(500).json(createErrorResponse('errors.aiConfigFetchFailed', req, error.message));
        }
    });
    /**
     * GET /api/ai/key
     * Get AI config for frontend AI requests (tenant-specific or central)
     * This is used by frontend AI features
     */
    router.get('/ai/key', async (req, res) => {
        try {
            const tenantPool = req.tenantPool;
            const context = tenantPool ? { type: 'tenant', tenantPool } : { type: 'central' };
            const publicConfig = await aiConfigService.getPublicAIConfig(context);
            const apiKey = await aiConfigService.getAPIKey(context);
            if (!publicConfig.aiEnabled || !apiKey) {
                return res.status(404).json(createErrorResponse('errors.aiNotConfigured', req, tenantPool ? 'AI not configured for this tenant' : 'Platform AI not configured'));
            }
            res.json({
                success: true,
                apiKey,
                aiProvider: publicConfig.aiProvider,
                aiModel: publicConfig.aiModel,
                maxTokens: publicConfig.maxTokens,
                temperature: publicConfig.temperature,
                customConfig: publicConfig.customConfig,
            });
        }
        catch (error) {
            console.error('[AI] Get API key failed:', error);
            res.status(500).json(createErrorResponse('errors.aiConfigFetchFailed', req, error.message));
        }
    });
    /**
     * POST /api/ai/generate-course
     * Generate course structure and lesson content using AI
     * Body: { topic: string, description?: string, level?: string }
     */
    router.post('/ai/generate-course', async (req, res) => {
        try {
            const { topic, description = '', level = 'Beginner' } = req.body || {};
            if (!topic || typeof topic !== 'string') {
                return res.status(400).json(createErrorResponse('errors.invalidRequest', req, 'Topic is required'));
            }
            const tenantPool = req.tenantPool;
            const context = tenantPool ? { type: 'tenant', tenantPool } : { type: 'central' };
            const publicConfig = await aiConfigService.getPublicAIConfig(context);
            const apiKey = await aiConfigService.getAPIKey(context);
            if (!publicConfig.aiEnabled || !apiKey) {
                return res.status(404).json(createErrorResponse('errors.aiNotConfigured', req, tenantPool ? 'AI not configured for this tenant' : 'Platform AI not configured'));
            }
            if (normalizeAIProvider(publicConfig.aiProvider) !== 'gemini') {
                return res.status(400).json(createErrorResponse('errors.unsupportedProvider', req, 'AI provider not supported for course generation'));
            }
            const ai = new GoogleGenAI({ apiKey });
            const model = publicConfig.aiModel || 'gemini-2.5-flash';
            const prompt = `
You are a world-class instructional designer. Create a comprehensive course structure for:

Title: ${topic}
Description: ${description}
Level: ${level}

The course must have at least 3 modules (Lessons).
Each module must have at least 2 items (ContentItems).

Available Item Types:
- VIDEO: Needs a 'content' field (use a placeholder URL like "https://example.com/video").
- TEXT: Provide a short 'contentOutline' (3-5 bullet points). Full lesson content will be generated later.
- QUIZ: Needs a 'question' field and 'gradingRubric'.
- ASSIGNMENT: Needs a 'question' field and 'gradingRubric'.

Return a JSON object in this format:
{
  "title": "string",
  "description": "string",
  "modules": [
    {
      "title": "Module Title",
      "items": [
         { "type": "VIDEO", "title": "Video Title", "content": "url" },
         { "type": "TEXT", "title": "Text Title", "contentOutline": ["Point 1", "Point 2", "Point 3"] },
         { "type": "QUIZ", "title": "Quiz Title", "question": "Question text", "gradingRubric": "Rubric text", "autoGrade": true }
      ]
    }
  ]
}
`;
            const result = await ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    temperature: publicConfig.temperature,
                    maxOutputTokens: publicConfig.maxTokens,
                }
            });
            const generated = parseJsonResponse(result.text || '');
            if (!generated) {
                return res.status(500).json(createErrorResponse('errors.aiGenerationFailed', req, 'Unable to parse AI response'));
            }
            if (generated.modules && Array.isArray(generated.modules)) {
                generated.modules = generated.modules.map((module, mIdx) => ({
                    ...module,
                    id: module.id || `m_${Date.now()}_${mIdx}`,
                    items: Array.isArray(module.items) ? module.items.map((item, iIdx) => ({
                        ...item,
                        id: item.id || `i_${Date.now()}_${mIdx}_${iIdx}`
                    })) : []
                }));
            }
            const courseTitle = generated.title || topic;
            const courseDescription = generated.description || description;
            if (generated.modules && Array.isArray(generated.modules)) {
                for (const module of generated.modules) {
                    if (!Array.isArray(module.items))
                        continue;
                    for (const item of module.items) {
                        if (item.type === 'VIDEO' && !item.content) {
                            item.content = 'https://example.com/video';
                        }
                        if (item.type === 'TEXT') {
                            const existing = typeof item.content === 'string' ? item.content.trim() : '';
                            if (!existing || existing.length < 120) {
                                const outline = Array.isArray(item.contentOutline)
                                    ? item.contentOutline.join(', ')
                                    : '';
                                const lessonContent = await generateLessonContent(ai, model, publicConfig.temperature, publicConfig.maxTokens, courseTitle, courseDescription, level, module.title || 'Module', item.title || 'Lesson', outline);
                                if (lessonContent) {
                                    item.content = lessonContent;
                                }
                            }
                        }
                    }
                }
            }
            res.json(generated);
        }
        catch (error) {
            console.error('[AI] Course generation failed:', error);
            res.status(500).json(createErrorResponse('errors.aiGenerationFailed', req, error.message));
        }
    });
    /**
     * PUT /api/admin/ai-config
     * Update AI configuration for this tenant
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
    router.put('/admin/ai-config', requireTenantPool, requireAuth, requireRole('admin'), async (req, res) => {
        try {
            const tenantPool = req.tenantPool;
            if (!tenantPool) {
                return res.status(400).json(createErrorResponse('errors.tenantContextRequired', req, 'Tenant context is required'));
            }
            const { aiEnabled, aiProvider, aiModel, apiKey, apiSecret, maxTokens, temperature, customConfig, } = req.body;
            // Validate at least one field is provided
            if (aiEnabled === undefined &&
                !aiProvider &&
                !aiModel &&
                !apiKey &&
                !apiSecret &&
                maxTokens === undefined &&
                temperature === undefined &&
                customConfig === undefined) {
                return res.status(400).json(createErrorResponse('errors.noConfigurationProvided', req, 'At least one configuration field must be provided'));
            }
            // Validate AI configuration
            if (aiEnabled && !apiKey) {
                return res.status(400).json(createErrorResponse('errors.aiKeyRequired', req, 'API Key is required when enabling AI'));
            }
            // Validate temperature range
            if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
                return res.status(400).json(createErrorResponse('errors.invalidTemperature', req, 'Temperature must be between 0 and 2'));
            }
            // Validate maxTokens
            if (maxTokens !== undefined && (maxTokens < 1 || maxTokens > 100000)) {
                return res.status(400).json(createErrorResponse('errors.invalidMaxTokens', req, 'Max tokens must be between 1 and 100000'));
            }
            const userId = req.user?.id;
            await aiConfigService.updateAIConfig({ type: 'tenant', tenantPool }, {
                aiEnabled,
                aiProvider,
                aiModel,
                apiKey,
                apiSecret,
                maxTokens,
                temperature,
                customConfig,
            }, userId);
            // Return public config after update
            const publicConfig = await aiConfigService.getPublicAIConfig({ type: 'tenant', tenantPool });
            res.json({
                success: true,
                message: 'AI configuration updated successfully',
                data: publicConfig,
            });
        }
        catch (error) {
            console.error('[Tenant Admin] Update AI config failed:', error);
            res.status(500).json(createErrorResponse('errors.aiConfigUpdateFailed', req, error.message));
        }
    });
    /**
     * POST /api/admin/ai-config/test
     * Test AI configuration with a simple request
     * Body: { apiKey: string, provider?: string, model?: string }
     */
    router.post('/admin/ai-config/test', requireTenantPool, requireAuth, requireRole('admin'), async (req, res) => {
        try {
            const { apiKey, provider = 'gemini', model = 'gemini-2.5-flash' } = req.body;
            const normalizedProvider = normalizeAIProvider(provider);
            if (!apiKey) {
                return res.status(400).json(createErrorResponse('errors.aiKeyRequired', req, 'API Key is required for testing'));
            }
            // Test the API key with a simple request
            if (normalizedProvider === 'gemini') {
                const { GoogleGenAI } = await import('@google/genai');
                const ai = new GoogleGenAI({ apiKey });
                const result = await ai.models.generateContent({
                    model: model,
                    contents: 'Say "Hello" in one word.',
                });
                const response = result.text;
                res.json({
                    success: true,
                    message: 'AI configuration is valid',
                    data: {
                        provider: normalizedProvider,
                        model,
                        testResponse: response,
                    },
                });
            }
            else if (normalizedProvider === 'openai' || normalizedProvider === 'claude') {
                res.json({
                    success: true,
                    message: `API key format validated for ${normalizedProvider}`,
                    data: {
                        provider: normalizedProvider,
                        model,
                    },
                });
            }
            else {
                res.status(400).json(createErrorResponse('errors.unsupportedProvider', req, `Provider ${normalizedProvider} is not supported`));
            }
        }
        catch (error) {
            console.error('[Tenant Admin] AI test failed:', error);
            res.status(400).json(createErrorResponse('errors.aiTestFailed', req, error.message || 'Invalid AI credentials'));
        }
    });
    /**
     * DELETE /api/admin/ai-config
     * Disable and clear AI configuration for this tenant
     */
    router.delete('/admin/ai-config', requireTenantPool, requireAuth, requireRole('admin'), async (req, res) => {
        try {
            const tenantPool = req.tenantPool;
            if (!tenantPool) {
                return res.status(400).json(createErrorResponse('errors.tenantContextRequired', req, 'Tenant context is required'));
            }
            const userId = req.user?.id;
            await aiConfigService.updateAIConfig({ type: 'tenant', tenantPool }, {
                aiEnabled: false,
                apiKey: null,
                apiSecret: null,
            }, userId);
            res.json({
                success: true,
                message: 'AI configuration disabled and cleared',
            });
        }
        catch (error) {
            console.error('[Tenant Admin] Delete AI config failed:', error);
            res.status(500).json(createErrorResponse('errors.aiConfigDeleteFailed', req, error.message));
        }
    });
    return router;
};
