import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { NotificationProvider } from './components/NotificationContext';
import { LanguageProvider } from './components/LanguageContext';

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