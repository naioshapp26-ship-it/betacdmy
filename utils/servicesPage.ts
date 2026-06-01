import { SERVICES } from '../constants';
import { ServicesPageCardContent, ServicesPageContentPayload } from '../types';

const DEFAULT_CARD_CONTENT: ServicesPageCardContent[] = SERVICES.map((service) => ({
  title: service.title,
  description: service.desc
}));

const cloneCard = (card: ServicesPageCardContent): ServicesPageCardContent => ({
  title: card.title,
  description: card.description
});

export const SERVICES_CARD_LIMIT = DEFAULT_CARD_CONTENT.length;

export const buildDefaultServicesPageContent = (): ServicesPageContentPayload => ({
  sectionLabel: '',
  sectionHeading: '',
  cards: DEFAULT_CARD_CONTENT.map(cloneCard)
});

const normalizeServicesCards = (cards?: ServicesPageCardContent[]): ServicesPageCardContent[] => {
  const source = Array.isArray(cards) ? cards : [];
  return DEFAULT_CARD_CONTENT.map((fallback, index) => {
    const entry = source[index];
    const title = typeof entry?.title === 'string' ? entry.title : fallback.title;
    const description = typeof entry?.description === 'string' ? entry.description : fallback.description;
    return { title, description };
  });
};

export const parseServicesPageContent = (raw?: string | null): ServicesPageContentPayload => {
  if (!raw || !raw.trim()) {
    return buildDefaultServicesPageContent();
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      sectionLabel: typeof parsed?.sectionLabel === 'string' ? parsed.sectionLabel : '',
      sectionHeading: typeof parsed?.sectionHeading === 'string' ? parsed.sectionHeading : '',
      cards: normalizeServicesCards(parsed?.cards)
    };
  } catch (error) {
    console.warn('[servicesPage] Failed to parse content payload, falling back to defaults.', error);
    return buildDefaultServicesPageContent();
  }
};

export const serializeServicesPageContent = (content: ServicesPageContentPayload): string => {
  const normalized: ServicesPageContentPayload = {
    sectionLabel: typeof content.sectionLabel === 'string' ? content.sectionLabel : '',
    sectionHeading: typeof content.sectionHeading === 'string' ? content.sectionHeading : '',
    cards: normalizeServicesCards(content.cards)
  };
  return JSON.stringify(normalized, null, 2);
};

export const mergeServicesContentWithDefaults = (
  content?: ServicesPageContentPayload | null
): ServicesPageContentPayload => {
  if (!content) {
    return buildDefaultServicesPageContent();
  }
  return {
    sectionLabel: typeof content.sectionLabel === 'string' ? content.sectionLabel : '',
    sectionHeading: typeof content.sectionHeading === 'string' ? content.sectionHeading : '',
    cards: normalizeServicesCards(content.cards)
  };
};
