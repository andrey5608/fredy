/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import { Fragment, useEffect, useMemo, useState, useCallback, useLayoutEffect } from 'react';

import NotificationAdapterMutator from './components/notificationAdapter/NotificationAdapterMutator';
import NotificationAdapterTable from '../../../components/table/NotificationAdapterTable';
import ProviderTable from '../../../components/table/ProviderTable';
import ProviderMutator from './components/provider/ProviderMutator';
import AreaFilter from './components/areaFilter/AreaFilter';
import Headline from '../../../components/headline/Headline';
import { useActions, useSelector } from '../../../services/state/store';
import { xhrPost } from '../../../services/xhr';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Divider,
  Input,
  Switch,
  Button,
  TagInput,
  Toast,
  Select,
  Modal,
  Typography,
  Notification,
} from '@douyinfe/semi-ui-19';
import './JobMutation.less';
import { SegmentPart } from '../../../components/segment/SegmentPart';
import {
  IconArrowLeft,
  IconBell,
  IconBriefcase,
  IconPaperclip,
  IconPlayCircle,
  IconPlusCircle,
  IconUser,
  IconFilter,
} from '@douyinfe/semi-icons';
import { useTranslation } from '../../../services/i18n/i18n.jsx';

export default function JobMutator() {
  const t = useTranslation();

  const SPEC_FILTERS = [
    { key: 'maxPrice', translation: t('jobs.mutation.filterMaxPrice') },
    { key: 'minSize', translation: t('jobs.mutation.filterMinSize') },
    { key: 'minRooms', translation: t('jobs.mutation.filterMinRooms') },
  ];

  const jobs = useSelector((state) => state.jobsData.jobs);
  const shareableUserList = useSelector((state) => state.jobsData.shareableUserList);
  const existingNotificationAdapters = useSelector((state) => state.notificationAdapterExisting);
  const params = useParams();
  const location = useLocation();

  const cloneFromId = location.state?.cloneFrom;
  const jobToClone = cloneFromId ? jobs.find((job) => job.id === cloneFromId) : null;
  const jobToBeEdit = params.jobId == null ? null : jobs.find((job) => job.id === params.jobId);

  const sourceJob = jobToBeEdit || jobToClone;

  const defaultBlacklist = sourceJob?.blacklist || [];
  const defaultName = jobToClone ? `Copy of - ${sourceJob?.name}` : sourceJob?.name || null;
  const defaultProviderData = sourceJob?.provider || [];
  const defaultNotificationAdapter = sourceJob?.notificationAdapter || [];
  const defaultEnabled = sourceJob?.enabled ?? true;
  const defaultShareWithUsers = sourceJob?.shared_with_user ?? [];
  const defaultSpatialFilter = sourceJob?.spatialFilter || null;
  const defaultSpecFilter = sourceJob?.specFilter || null;

  const [providerToEdit, setProviderToEdit] = useState(null);
  const [providerCreationVisible, setProviderCreationVisibility] = useState(false);
  const [notificationCreationVisible, setNotificationCreationVisibility] = useState(false);
  const [editNotificationAdapter, setEditNotificationAdapter] = useState(null);
  const [providerData, setProviderData] = useState(defaultProviderData);
  const [name, setName] = useState(defaultName);
  const [blacklist, setBlacklist] = useState(defaultBlacklist);
  const [notificationAdapterData, setNotificationAdapterData] = useState(defaultNotificationAdapter);
  const [shareWithUsers, setShareWithUsers] = useState(defaultShareWithUsers);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [spatialFilter, setSpatialFilter] = useState(defaultSpatialFilter);
  const [specFilter, setSpecFilter] = useState(defaultSpecFilter);
  const [reuseAdapterSelection, setReuseAdapterSelection] = useState(null);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const actions = useActions();

  // Memoize the spatial filter change handler to prevent map reinitializations
  const handleSpatialFilterChange = useCallback((data) => {
    setSpatialFilter(data);
  }, []);

  const handleSpecFilterChange = (key, value) => {
    if (!SPEC_FILTERS.map(({ key }) => key).includes(key)) return;

    setSpecFilter({ ...specFilter, [key]: value ? parseFloat(value) : null });
  };

  useEffect(() => {
    // Sync form and baseline when switching between jobs or when data arrives later
    setName(defaultName);
    setEnabled(defaultEnabled);
    setBlacklist(defaultBlacklist);
    setProviderData(defaultProviderData);
    setNotificationAdapterData(defaultNotificationAdapter);
    setShareWithUsers(jobToBeEdit?.shared_with_user ?? []);
  }, [defaultName, defaultEnabled, defaultBlacklist, defaultProviderData, defaultNotificationAdapter, jobToBeEdit]);

  useEffect(() => {
    actions.notificationAdapter.getAdapter();
    actions.notificationAdapter.getExistingAdapters();
    actions.jobsData.getSharableUserList();
  }, [actions.notificationAdapter, actions.jobsData]);

  const existingAdapterOptions = useMemo(() => {
    return (existingNotificationAdapters || []).map((adapter, idx) => ({
      value: `${adapter.id}-${adapter.sourceJobId}-${idx}`,
      label: `${adapter.name} (${adapter.sourceJobName || 'Job'})`,
      adapter,
    }));
  }, [existingNotificationAdapters]);

  const addOrReplaceAdapter = (adapterConfig) => {
    setNotificationAdapterData((prev) => {
      const exists = prev.some(
        (item) =>
          item.id === adapterConfig.id &&
          JSON.stringify(item.fields || {}) === JSON.stringify(adapterConfig.fields || {}),
      );
      if (exists) return prev;
      return [...prev, adapterConfig];
    });
  };

  const isSavingEnabled = () => {
    return Boolean(notificationAdapterData.length && providerData.length && name);
  };

  const handleProviderEdit = (data) => {
    setProviderData(
      providerData.map((provider) => (provider.url === data.oldProviderToEdit.url ? data.newData : provider)),
    );
  };

  const mutateJob = async ({ redirectToJobs = true } = {}) => {
    setSaveError(null);
    setSaving(true);
    try {
      await xhrPost('/api/jobs', {
        provider: providerData,
        notificationAdapter: notificationAdapterData,
        shareWithUsers,
        name,
        blacklist,
        spatialFilter,
        specFilter,
        enabled,
        jobId: jobToBeEdit?.id || null,
      });
      await actions.jobsData.getJobs();
      Toast.success(t('jobs.mutation.saved'));
      if (redirectToJobs) {
        navigate('/jobs');
      }
      return { ok: true };
    } catch (Exception) {
      const message = Exception?.json?.message || Exception?.message || 'Failed to save job';
      console.error(message);
      Toast.error(Exception.json != null ? Exception.json.message : Exception);
      setSaveError(message);
      return { ok: false, message };
    } finally {
      setSaving(false);
    }
  };

  useLayoutEffect(() => {
    // Expose a direct callback for nav to trigger confirmation reliably (HashRouter friendly)
    window.__jobNavConfirm = (target) => {
      setPendingNavigation(target);
      setConfirmVisible(true);
      setSaveError(null);
    };

    const handler = (e) => {
      const target = e.detail?.target;
      if (target === '/jobs') {
        // Always confirm when leaving the job form via nav
        setPendingNavigation(target);
        setConfirmVisible(true);
        setSaveError(null);
      }
    };

    window.addEventListener('jobNavigationRequest', handler);
    return () => {
      window.removeEventListener('jobNavigationRequest', handler);
      delete window.__jobNavConfirm;
    };
  }, [navigate]);

  return (
    <Fragment>
      <ProviderMutator
        visible={providerCreationVisible}
        onVisibilityChanged={(visible) => setProviderCreationVisibility(visible)}
        onData={(data) => {
          setProviderData([...providerData, data]);
        }}
        onEditData={handleProviderEdit}
        providerToEdit={providerToEdit}
      />

      {notificationCreationVisible && (
        <NotificationAdapterMutator
          visible={notificationCreationVisible}
          onVisibilityChanged={(visible) => {
            setEditNotificationAdapter(null);
            setNotificationCreationVisibility(visible);
          }}
          selected={notificationAdapterData}
          editNotificationAdapter={
            editNotificationAdapter == null
              ? null
              : notificationAdapterData.find((adapter) => adapter.id === editNotificationAdapter)
          }
          onData={(data) => {
            const oldData = [...notificationAdapterData].filter((o) => o.id !== data.id);
            setNotificationAdapterData([...oldData, data]);
          }}
        />
      )}

      <Headline
        text={jobToBeEdit ? t('jobs.mutation.editTitle') : t('jobs.mutation.createTitle')}
        actions={
          <Button
            icon={<IconArrowLeft />}
            onClick={() => navigate('/jobs')}
            theme="borderless"
            style={{ color: '#909090' }}
          >
            {t('jobs.mutation.back')}
          </Button>
        }
      />
      <form>
        <SegmentPart name={t('jobs.mutation.sectionName')} Icon={IconPaperclip}>
          <Input
            autoFocus
            type="text"
            maxLength={40}
            placeholder={t('jobs.mutation.namePlaceholder')}
            width={6}
            value={name}
            onChange={(value) => setName(value)}
          />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          name={t('jobs.mutation.sectionProviders')}
          Icon={IconBriefcase}
          helpText={t('jobs.mutation.providersHelp')}
        >
          <Button
            type="primary"
            icon={<IconPlusCircle />}
            className="jobMutation__newButton"
            onClick={() => {
              setProviderToEdit(null);
              setProviderCreationVisibility(true);
            }}
          >
            {t('jobs.mutation.addProvider')}
          </Button>

          <ProviderTable
            providerData={providerData}
            onRemove={(providerUrl) => {
              setProviderData(providerData.filter((provider) => provider.url !== providerUrl));
            }}
            onEdit={(provider) => {
              setProviderCreationVisibility(true);
              setProviderToEdit(provider);
            }}
          />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          Icon={IconBell}
          name={t('jobs.mutation.sectionNotifications')}
          helpText={t('jobs.mutation.notificationsHelp')}
        >
          <Button
            type="primary"
            className="jobMutation__newButton"
            icon={<IconPlusCircle />}
            onClick={() => setNotificationCreationVisibility(true)}
          >
            {t('jobs.mutation.addNotification')}
          </Button>

          {existingAdapterOptions.length > 0 && (
            <div className="jobMutation__reuseAdapter">
              <Select
                filter
                placeholder="Reuse adapter from another job"
                style={{ maxWidth: '24rem' }}
                value={reuseAdapterSelection}
                optionList={existingAdapterOptions}
                onChange={(value) => {
                  setReuseAdapterSelection(value);
                  const selectedOption = existingAdapterOptions.find((opt) => opt.value === value);
                  if (selectedOption?.adapter) {
                    addOrReplaceAdapter({
                      id: selectedOption.adapter.id,
                      name: selectedOption.adapter.name,
                      fields: selectedOption.adapter.fields || {},
                    });
                  }
                  setTimeout(() => setReuseAdapterSelection(null), 0);
                }}
              />
            </div>
          )}

          <NotificationAdapterTable
            notificationAdapter={notificationAdapterData}
            onRemove={(adapterId) => {
              setEditNotificationAdapter(null);
              setNotificationAdapterData(notificationAdapterData.filter((adapter) => adapter.id !== adapterId));
            }}
            onEdit={(adapterId) => {
              setEditNotificationAdapter(adapterId);
              setNotificationCreationVisibility(true);
            }}
          />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          Icon={IconFilter}
          name={t('jobs.mutation.sectionBlacklist')}
          helpText={t('jobs.mutation.blacklistHelp')}
        >
          <TagInput
            value={blacklist || []}
            placeholder={t('jobs.mutation.blacklistPlaceholder')}
            onChange={(v) => setBlacklist([...v])}
          />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          Icon={IconFilter}
          name={t('jobs.mutation.sectionCriteriaFilter')}
          helpText={t('jobs.mutation.criteriaFilterHelp')}
        >
          <div className="jobMutation__specFilter">
            {SPEC_FILTERS.map((filter) => (
              <div key={filter.key} className="jobMutation__specFilterItem">
                <div className="jobMutation__specFilterLabel">{filter.translation}</div>
                <Input
                  type="number"
                  placeholder={t('jobs.mutation.criteriaNumberPlaceholder')}
                  value={specFilter?.[filter.key]}
                  onChange={(value) => handleSpecFilterChange(filter.key, value)}
                />
              </div>
            ))}
          </div>
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          Icon={IconFilter}
          name={t('jobs.mutation.sectionAreaFilter')}
          helpText={t('jobs.mutation.areaFilterHelp')}
        >
          <AreaFilter spatialFilter={spatialFilter} onChange={handleSpatialFilterChange} />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart Icon={IconUser} name={t('jobs.mutation.sectionSharing')} helpText={t('jobs.mutation.sharingHelp')}>
          {shareableUserList.length === 0 ? (
            <div>{t('jobs.mutation.sharingNoUsers')}</div>
          ) : (
            <Select
              filter
              multiple
              placeholder={t('jobs.mutation.sharingSearchPlaceholder')}
              autoClearSearchValue={false}
              defaultValue={shareWithUsers}
              onChange={(value) => setShareWithUsers(value)}
            >
              {shareableUserList.map((user) => (
                <Select.Option value={user.id} key={user.id}>
                  {user.name}
                </Select.Option>
              ))}
            </Select>
          )}
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          Icon={IconPlayCircle}
          name={t('jobs.mutation.sectionActivation')}
          helpText={t('jobs.mutation.activationHelp')}
        >
          <Switch className="jobMutation__spaceTop" onChange={(checked) => setEnabled(checked)} checked={enabled} />
        </SegmentPart>
        <Divider margin="1rem" />
        <Button type="danger" style={{ marginRight: '1rem' }} onClick={() => navigate('/jobs')}>
          {t('jobs.mutation.cancel')}
        </Button>
        <Button
          type="primary"
          icon={<IconPlusCircle />}
          disabled={!isSavingEnabled() || saving}
          loading={saving}
          onClick={() => mutateJob()}
        >
          {t('jobs.mutation.save')}
        </Button>
      </form>

      <Modal
        visible={confirmVisible}
        onCancel={() => setConfirmVisible(false)}
        footer={null}
        title="Leave page?"
        maskClosable={false}
        bodyStyle={{ paddingBottom: 10 }}
      >
        <Typography.Paragraph>You have unsaved changes. Do you want to save before leaving?</Typography.Paragraph>
        {saveError &&
          Notification.error({
            title: 'Save failed',
            content: saveError,
            duration: 3,
          })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button onClick={() => setConfirmVisible(false)}>Cancel</Button>
          <Button
            theme="solid"
            type="warning"
            onClick={() => {
              setConfirmVisible(false);
              const target = pendingNavigation || '/jobs';
              if (target) {
                navigate(target, { replace: true });
                if (typeof window !== 'undefined') {
                  const normalized = '#' + String(target).replace(/^#?/, '').replace(/^\/?/, '/');
                  window.location.hash = normalized;
                }
              }
            }}
          >
            Don't Save
          </Button>
          <Button
            theme="solid"
            type="primary"
            loading={saving}
            onClick={async () => {
              const result = await mutateJob({ redirectToJobs: false });
              if (result.ok) {
                setConfirmVisible(false);
                if (pendingNavigation) navigate(pendingNavigation);
              }
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </Fragment>
  );
}
