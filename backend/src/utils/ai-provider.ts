export const normalizeAIProvider = (provider: string | null | undefined): string => {
  if (!provider) return 'gemini';

  const normalized = provider.trim().toLowerCase();
  if (!normalized) return 'gemini';

  if (normalized.includes('gemini')) return 'gemini';
  if (normalized.includes('openai')) return 'openai';
  if (normalized.includes('claude') || normalized.includes('anthropic')) return 'claude';

  return normalized;
};

export const isGeminiProvider = (provider: string | null | undefined): boolean => {
  return normalizeAIProvider(provider) === 'gemini';
};
