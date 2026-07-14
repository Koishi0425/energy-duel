import React from 'react';
import ReactDOM from 'react-dom/client';
import 'antd/dist/reset.css';
import { ConfigProvider, theme } from 'antd';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: '#7b89ff', borderRadius: 10 } }}>
      <App />
    </ConfigProvider>
  </React.StrictMode>
);
