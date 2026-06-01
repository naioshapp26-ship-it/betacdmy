import {
  HomePageContentPayload,
  HomeWhyChooseCardContent,
  HomeFooterSocialLink,
  HomeFooterContentPayload
} from '../types';

const DEFAULT_WHY_CHOOSE_CARDS: HomeWhyChooseCardContent[] = [
  {
    title: 'All-in-one learning platform',
    description: 'Everything you need to run learning in one place, from courses to assessments and tracking.'
  },
  {
    title: 'Launch your own academy',
    description: 'Get your own subdomain and build your academy with zero technical hassle.'
  },
  {
    title: 'Effortless user management',
    description: 'Full control over users, permissions, and subscriptions with ease.'
  },
  {
    title: 'Smart quizzes and assignments',
    description: 'Create exams and assignments with automatic or manual grading.'
  },
  {
    title: 'AI-powered support',
    description: 'An advanced learning experience using AI tools to improve learning and follow-up.'
  },
  {
    title: 'Built to scale',
    description: 'Made for individuals and institutions, with easy expansion anytime.'
  }
];

const DEFAULT_SOCIAL_LINKS: HomeFooterSocialLink[] = [
  { label: 'Facebook', url: '' },
  { label: 'Instagram', url: '' },
  { label: 'LinkedIn', url: '' },
  { label: 'YouTube', url: '' }
];

const cloneCard = (card: HomeWhyChooseCardContent): HomeWhyChooseCardContent => ({
  title: card.title,
  description: card.description
});

const cloneSocial = (entry: HomeFooterSocialLink): HomeFooterSocialLink => ({
  label: entry.label,
  url: entry.url
});

export const HOME_WHY_CHOOSE_CARD_LIMIT = DEFAULT_WHY_CHOOSE_CARDS.length;
export const HOME_FOOTER_SOCIAL_LIMIT = DEFAULT_SOCIAL_LINKS.length;

export const buildDefaultHomePageContent = (): HomePageContentPayload => ({
  whyChooseLabel: 'Why Choose Us',
  whyChooseHeading: '',
  whyChooseSubtitle: '',
  whyChooseCards: DEFAULT_WHY_CHOOSE_CARDS.map(cloneCard),
  footer: {
    description: '',
    contactEmail: '',
    contactPhone: '',
    copyrightText: '',
    socialLinks: DEFAULT_SOCIAL_LINKS.map(cloneSocial)
  }
});

const normalizeWhyChooseCards = (cards?: HomeWhyChooseCardContent[]): HomeWhyChooseCardContent[] => {
  const source = Array.isArray(cards) ? cards : [];
  return DEFAULT_WHY_CHOOSE_CARDS.map((fallback, index) => {
    const entry = source[index];
    return {
      title: typeof entry?.title === 'string' ? entry.title : fallback.title,
      description: typeof entry?.description === 'string' ? entry.description : fallback.description
    };
  });
};

const normalizeSocialLinks = (links?: HomeFooterSocialLink[]): HomeFooterSocialLink[] => {
  const source = Array.isArray(links) ? links : [];
  return DEFAULT_SOCIAL_LINKS.map((fallback, index) => {
    const entry = source[index];
    return {
      label: typeof entry?.label === 'string' ? entry.label : fallback.label,
      url: typeof entry?.url === 'string' ? entry.url : fallback.url
    };
  });
};

const normalizeFooter = (footer?: HomeFooterContentPayload): HomeFooterContentPayload => ({
  description: typeof footer?.description === 'string' ? footer.description : '',
  contactEmail: typeof footer?.contactEmail === 'string' ? footer.contactEmail : '',
  contactPhone: typeof footer?.contactPhone === 'string' ? footer.contactPhone : '',
  copyrightText: typeof footer?.copyrightText === 'string' ? footer.copyrightText : '',
  socialLinks: normalizeSocialLinks(footer?.socialLinks)
});

export const parseHomePageContent = (raw?: string | null): HomePageContentPayload => {
  if (!raw || !raw.trim()) {
    return buildDefaultHomePageContent();
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      whyChooseLabel: typeof parsed?.whyChooseLabel === 'string' ? parsed.whyChooseLabel : 'Why Choose Us',
      whyChooseHeading: typeof parsed?.whyChooseHeading === 'string' ? parsed.whyChooseHeading : '',
      whyChooseSubtitle: typeof parsed?.whyChooseSubtitle === 'string' ? parsed.whyChooseSubtitle : '',
      whyChooseCards: normalizeWhyChooseCards(parsed?.whyChooseCards),
      footer: normalizeFooter(parsed?.footer)
    };
  } catch (error) {
    console.warn('[homePage] Failed to parse content payload, falling back to defaults.', error);
    return buildDefaultHomePageContent();
  }
};

export const serializeHomePageContent = (content: HomePageContentPayload): string => {
  const normalized: HomePageContentPayload = {
    whyChooseLabel: typeof content?.whyChooseLabel === 'string' ? content.whyChooseLabel : 'Why Choose Us',
    whyChooseHeading: typeof content?.whyChooseHeading === 'string' ? content.whyChooseHeading : '',
    whyChooseSubtitle: typeof content?.whyChooseSubtitle === 'string' ? content.whyChooseSubtitle : '',
    whyChooseCards: normalizeWhyChooseCards(content?.whyChooseCards),
    footer: normalizeFooter(content?.footer)
  };

  return JSON.stringify(normalized, null, 2);
};
