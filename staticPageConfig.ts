import definitions from './static-pages.json';

export interface StaticPageDefinition {
  slug: string;
  title: string;
  path: string;
}

export const STATIC_PAGE_DEFINITIONS: StaticPageDefinition[] = definitions as StaticPageDefinition[];
export const STATIC_PAGE_SLUGS = STATIC_PAGE_DEFINITIONS.map((page) => page.slug);
export const getStaticPageDefinition = (slug: string) =>
  STATIC_PAGE_DEFINITIONS.find((page) => page.slug === slug);
