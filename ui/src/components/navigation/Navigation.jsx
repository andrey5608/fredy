/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useEffect, useState } from 'react';
import { Nav } from '@douyinfe/semi-ui-19';
import {
  IconStar,
  IconSetting,
  IconTerminal,
  IconHistogram,
  IconSidebar,
  IconServerStroked,
} from '@douyinfe/semi-icons';
import logo from '../../assets/logo.png';
import logoWhite from '../../assets/logo_white.png';
import heart from '../../assets/heart.png';
import Logout from '../logout/Logout.jsx';
import Donate from '../donate/Donate.jsx';
import NewsHistory from '../news/NewsHistory.jsx';
import { useLocation, useNavigate } from 'react-router';

import './Navigate.less';
import { useScreenWidth } from '../../hooks/screenWidth.js';
import { useTranslation } from '../../services/i18n/i18n.jsx';
import { navTreeFor, resolveActiveKey } from './navModel.js';
import { currentTheme } from '../../services/theme/theme.js';

/**
 * The icon each top-level entry carries. Keyed by nav key so the tree itself stays free of JSX.
 * @type {Record<string, React.ReactElement>}
 */
const ICONS = {
  '/dashboard': <IconHistogram />,
  '/jobs': <IconTerminal />,
  listings: <IconStar />,
  '/settings': <IconSetting />,
  '/admin': <IconServerStroked />,
};

export default function Navigation({ isAdmin }) {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const width = useScreenWidth();
  const [collapsed, setCollapsed] = useState(width <= 850);

  useEffect(() => {
    if (width <= 850) {
      setCollapsed(true);
    }
  }, [width]);

  const tree = navTreeFor(isAdmin);

  /**
   * The tree in the shape Semi's `<Nav>` wants: translated labels, icons attached, groups nested.
   *
   * @param {import('./navModel.js').NavNode[]} nodes
   * @returns {Object[]}
   */
  const toNavItems = (nodes) =>
    nodes.map((node) => ({
      itemKey: node.key,
      text: t(node.labelKey),
      // Only top-level entries carry an icon. Sub-items are read as a list under the one they
      // belong to, and a single marked entry among unmarked siblings reads as a different kind of
      // thing rather than as one of them.
      icon: ICONS[node.key],
      // A destination (key starting with '/') renders as a real `<a href="#...">` via Semi's
      // built-in `link` prop, not just a `<li onClick>`. That's what gives it a native browser
      // context menu - "open in new tab", "copy link", middle-click - for free; a group heading
      // only toggles its children and stays a plain item.
      ...(node.key.startsWith('/') ? { link: `#${node.key}` } : {}),
      ...(node.children ? { items: toNavItems(node.children) } : {}),
    }));

  const sidebarWidth = collapsed ? '60px' : '220px';

  return (
    <Nav
      style={{ height: '100%', width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
      items={toNavItems(tree)}
      isCollapsed={collapsed}
      selectedKeys={[resolveActiveKey(tree, location.pathname)]}
      onClick={({ itemKey, domEvent }) => {
        // Use onClick (fires on every click) instead of onSelect (skips the
        // already-selected item) so clicking e.g. "Jobs" while on a nested
        // route like /jobs/edit/:id still navigates back to the list. Only
        // leaf routes navigate; parent items (keys without a leading '/') just
        // toggle their submenu.
        if (typeof itemKey !== 'string' || !itemKey.startsWith('/')) {
          return;
        }
        // A modified click (ctrl/cmd/shift) or the middle button means "open elsewhere". Every
        // leaf item is now also a real link (see `link` below), so the browser already opens it
        // in a new tab/window on its own - driving the in-app router here too would additionally
        // navigate the current tab away from under the user.
        if (domEvent?.ctrlKey || domEvent?.metaKey || domEvent?.shiftKey || domEvent?.button === 1) {
          return;
        }
        // A plain click still has a real `href` underneath it, and left unprevented the browser
        // runs its own hash navigation right after this handler returns - racing the router's own
        // update to the same URL. That double write is what made a collapsed group's popover
        // fail to open and a first click on a link appear to do nothing (it takes hold on the
        // second click, once the race has settled). Owning the navigation here means the anchor
        // is only ever a hint to the browser for modified clicks, never a second driver.
        domEvent?.preventDefault?.();
        navigate(itemKey);
      }}
      header={
        <div className="navigate__header">
          {/* The heart reads on either theme; the wordmark does not, so it has two cuts. */}
          <img
            src={collapsed ? heart : currentTheme() === 'dark' ? logoWhite : logo}
            width={collapsed ? 30 : 160}
            alt="Fredy Logo"
          />
        </div>
      }
      footer={
        <Nav.Footer className="navigate__footer">
          {/* Reachable at any time, unlike the dialog that appears on its own: dismissing that one
              used to be the end of it, with no way back to what it had said. */}
          <div className="navigate__footer-news">
            <NewsHistory collapsed={collapsed} />
          </div>
          {/* Shown on the demo instance too. The demo is where most people meet Fredy for the
              first time, so hiding the one place it asks for support removed it from exactly the
              audience that has just seen what the project does. */}
          <div className="navigate__footer-donate">
            <Donate collapsed={collapsed} />
          </div>
          <div className={`navigate__footer-actions${collapsed ? ' navigate__footer-actions--collapsed' : ''}`}>
            <Logout text={!collapsed} />
            <button
              className="navigate__toggle-btn"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            >
              <IconSidebar size="default" />
            </button>
          </div>
        </Nav.Footer>
      }
    />
  );
}
