/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { useState } from 'react';
import { Button, Modal, Tag, Space, Typography, Descriptions, MarkdownRender } from '@douyinfe/semi-ui-19';
import { IconAlertCircle, IconArrowRight, IconClose } from '@douyinfe/semi-icons';
import { useSelector } from '../../services/state/store.js';

import './VersionBanner.less';
import { useTranslation } from '../../services/i18n/i18n.jsx';

const { Text } = Typography;

export default function VersionBanner() {
  const t = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  // Local only, on purpose: there is no "seen this update" flag on the server, so dismissing just
  // clears it for the rest of this visit. It comes back on the next full load - and again on every
  // one after that until the instance is actually upgraded - rather than going quiet forever the
  // moment one tab happens to close it.
  const [dismissed, setDismissed] = useState(false);
  const versionUpdate = useSelector((state) => state.versionUpdate.versionUpdate);

  if (dismissed) {
    return null;
  }

  return (
    <>
      {/* A nudge, not a banner: it used to span the content area at the top of every page, which
          gave a one-line "there's an update" the same weight as the demo-mode and debug-logging
          banners it sat between. Docked to the corner it reads as what it is - a small heads-up
          that a click on "release notes" is always one tap away from, not a strip the layout has
          to make room for. */}
      <div className="versionBanner" role="status">
        <button className="versionBanner__close" onClick={() => setDismissed(true)} aria-label={t('version.dismiss')}>
          <IconClose size="small" />
        </button>
        <div className="versionBanner__header">
          <IconAlertCircle size="small" />
          <Text strong size="small">
            {t('version.newVersionAvailable')}
          </Text>
        </div>
        <Space spacing={8} align="center" wrap className="versionBanner__meta">
          <Tag color="amber" size="small" shape="circle">
            {versionUpdate.version}
          </Tag>
          <Text type="tertiary" size="small">
            {t('version.currentLabel', { version: versionUpdate.localFredyVersion })}
          </Text>
        </Space>
        <Button
          className="versionBanner__cta"
          theme="borderless"
          size="small"
          icon={<IconArrowRight />}
          iconPosition="right"
          onClick={() => setModalVisible(true)}
        >
          {t('version.releaseNotes')}
        </Button>
      </div>
      <Modal
        title={
          <Space spacing={8} align="center">
            <Text strong>Fredy {versionUpdate.version}</Text>
            <Tag color="amber" size="small">
              {t('version.newBadge')}
            </Tag>
          </Space>
        }
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        width={640}
        footer={
          <Space>
            <Button onClick={() => setModalVisible(false)}>{t('version.modalClose')}</Button>
            <Button
              type="primary"
              icon={<IconArrowRight />}
              iconPosition="right"
              onClick={() => window.open(versionUpdate.url, '_blank')}
            >
              {t('version.viewOnGithub')}
            </Button>
          </Space>
        }
      >
        <Descriptions row size="small" className="versionBanner__details">
          <Descriptions.Item itemKey={t('version.yourVersion')}>{versionUpdate.localFredyVersion}</Descriptions.Item>
          <Descriptions.Item itemKey={t('version.latestVersion')}>{versionUpdate.version}</Descriptions.Item>
        </Descriptions>
        <div className="versionBanner__notes">
          <MarkdownRender raw={versionUpdate.body} />
        </div>
      </Modal>
    </>
  );
}
