import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Analytics } from '@vercel/analytics/react';
import './style.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App />{import.meta.env.PROD && <Analytics />}</React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);
