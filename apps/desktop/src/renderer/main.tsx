import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StartupErrorBoundary } from './startup-error-boundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </React.StrictMode>
);
