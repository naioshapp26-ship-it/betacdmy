// cPanel / LiteSpeed lsnode launcher (CommonJS).
// lsnode uses require() and cannot load ESM modules with top-level await directly.
void import('./server.js').catch((error) => {
  console.error('Failed to bootstrap server:', error);
  process.exit(1);
});
