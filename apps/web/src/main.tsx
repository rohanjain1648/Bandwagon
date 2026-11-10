import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AnnounceProvider } from './lib/announce';
import { queryClient } from './lib/queries';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AnnounceProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AnnounceProvider>
    </QueryClientProvider>
  </StrictMode>,
);
