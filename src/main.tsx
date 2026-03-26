console.log('main.tsx starting...');
const status = document.getElementById('debug-status');
if (status) status.innerText = 'main.tsx started, importing React...';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log('Imports successful');
if (status) status.innerText = 'Imports successful, rendering App...';

window.addEventListener('error', (event) => {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding: 20px; color: white; background: #900; font-family: sans-serif;">
      <h1>Application Error</h1>
      <p>${event.message}</p>
      <pre>${event.error?.stack || ''}</pre>
    </div>`;
  }
});

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (e: any) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding: 20px; color: white; background: #900; font-family: sans-serif;">
      <h1>Render Error</h1>
      <p>${e.message}</p>
      <pre>${e.stack || ''}</pre>
    </div>`;
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}
