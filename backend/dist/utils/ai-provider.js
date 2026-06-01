export const normalizeAIProvider = (provider) => {
    if (!provider)
        return 'gemini';
    const normalized = provider.trim().toLowerCase();
    if (!normalized)
        return 'gemini';
    if (normalized.includes('gemini'))
        return 'gemini';
    if (normalized.includes('openai'))
        return 'openai';
    if (normalized.includes('claude') || normalized.includes('anthropic'))
        return 'claude';
    return normalized;
};
export const isGeminiProvider = (provider) => {
    return normalizeAIProvider(provider) === 'gemini';
};
