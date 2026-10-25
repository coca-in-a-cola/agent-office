import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/base.scss';
import './styles/office-svg.scss';
import './styles/office.scss';
import './styles/mobile.scss';
import './styles/automaton.scss';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find the root element');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
