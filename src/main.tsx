import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {PRODUCT_DOCUMENT_TITLE} from './brand';
import App from './App.tsx';
import './index.css';

document.title = PRODUCT_DOCUMENT_TITLE;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
