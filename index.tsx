import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './components/NotificationContext';
import { LanguageProvider } from './components/LanguageContext';
import {
  TENANT_SUBDOMAIN_COOKIE,
  TENANT_SUBDOMAIN_HEADER,
  extractTenantPathSubdomain
} from './utils/platform-host.js';

// Attach tenant slug on API calls when browsing /t/{sub} on Railway apex hosts.
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const pathTenant = extractTenantPathSubdomain(window.location.pathname);
    const cookieMatch = document.cookie.match(new RegExp(`(?:^|; )${TENANT_SUBDOMAIN_COOKIE}=([^;]*)`));
    const cookieTenant = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;
    const tenant = pathTenant || cookieTenant;
    if (!tenant) {
      return originalFetch(input, init);
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has(TENANT_SUBDOMAIN_HEADER)) {
      headers.set(TENANT_SUBDOMAIN_HEADER, tenant);
    }
    return originalFetch(input, { ...init, headers });
  };
}

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider defaultLanguage="en">
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>
);

const shouldRegisterServiceWorker = () => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  const { protocol, hostname } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  return protocol === 'https:' || isLocalhost;
};

if (shouldRegisterServiceWorker()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((error) => console.error('SW registration failed', error));
  });
}