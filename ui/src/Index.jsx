/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { HashRouter } from 'react-router';
import { createRoot } from 'react-dom/client';
import en_US from '@douyinfe/semi-ui-19/lib/es/locale/source/en_US';
import { LocaleProvider, semiGlobal } from '@douyinfe/semi-ui-19';
import App from './App';
// The two faces are bundled, not fetched from fonts.googleapis.com: a stylesheet `<link>` to
// another origin blocks first paint, so an unreachable or intercepted Google (proxy, VPN, offline
// LAN) used to leave the page blank. Only the latin subset, which carries the umlauts and ß, and
// only the weights the stylesheets use. Each import emits one hashed woff2 into `ui/public/assets`.
import '@fontsource/schibsted-grotesk/latin-400.css';
import '@fontsource/schibsted-grotesk/latin-500.css';
import '@fontsource/schibsted-grotesk/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './Index.less';

// Semi UI uses react-dom (not react-dom/client) internally for imperative renders
// like Toast, Notification, etc. In React 19, createRoot was removed from react-dom
// and lives only in react-dom/client - inject it so Toast can create its own root.
semiGlobal.config.createRoot = createRoot;

const container = document.getElementById('fredy');
const root = createRoot(container);

root.render(
  <HashRouter>
    <LocaleProvider locale={en_US}>
      <App />
    </LocaleProvider>
  </HashRouter>,
);
