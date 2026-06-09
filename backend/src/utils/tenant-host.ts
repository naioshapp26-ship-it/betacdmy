export const extractSubdomain = (host?: string | null): string | null => {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  const mainDomain = (process.env.MAIN_DOMAIN || 'betacdmy.com').toLowerCase();
  if (!hostname.endsWith(mainDomain)) return null;
  const remainder = hostname.slice(0, -mainDomain.length).replace(/\.$/, '');
  if (!remainder || remainder === 'www') {
    return null;
  }
  return remainder;
};
