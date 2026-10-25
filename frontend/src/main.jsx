import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider } from './auth/AuthContext';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || ''}>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </GoogleOAuthProvider>
    </HelmetProvider>
  </React.StrictMode>
);
