/*
 * Copyright (c) 2025 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import React, { Fragment, useEffect, useMemo, useState, useLayoutEffect } from 'react';

import NotificationAdapterMutator from './components/notificationAdapter/NotificationAdapterMutator';
import NotificationAdapterTable from '../../../components/table/NotificationAdapterTable';
import ProviderTable from '../../../components/table/ProviderTable';
import ProviderMutator from './components/provider/ProviderMutator';
import Headline from '../../../components/headline/Headline';
import { useActions, useSelector } from '../../../services/state/store';
import { xhrPost } from '../../../services/xhr';
import { useNavigate, useParams } from 'react-router-dom';
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
} from '@douyinfe/semi-ui';
import './JobMutation.less';
import { SegmentPart } from '../../../components/segment/SegmentPart';
import {
  IconBell,
  IconBriefcase,
  IconPaperclip,
  IconPlayCircle,
  IconPlusCircle,
  IconUser,
  IconClear,
} from '@douyinfe/semi-icons';

export default function JobMutator() {
  const jobs = useSelector((state) => state.jobsData.jobs);
  const shareableUserList = useSelector((state) => state.jobsData.shareableUserList);
  const existingNotificationAdapters = useSelector((state) => state.notificationAdapterExisting);
  const params = useParams();

  const jobToBeEdit = params.jobId == null ? null : jobs.find((job) => job.id === params.jobId);

  const defaultBlacklist = jobToBeEdit?.blacklist || [];
  const defaultName = jobToBeEdit?.name || null;
  const defaultProviderData = jobToBeEdit?.provider || [];
  const defaultNotificationAdapter = jobToBeEdit?.notificationAdapter || [];
  const defaultEnabled = jobToBeEdit?.enabled ?? true;

  const [providerToEdit, setProviderToEdit] = useState(null);
  const [providerCreationVisible, setProviderCreationVisibility] = useState(false);
  const [notificationCreationVisible, setNotificationCreationVisibility] = useState(false);
  const [editNotificationAdapter, setEditNotificationAdapter] = useState(null);
  const [providerData, setProviderData] = useState(defaultProviderData);
  const [name, setName] = useState(defaultName);
  const [blacklist, setBlacklist] = useState(defaultBlacklist);
  const [notificationAdapterData, setNotificationAdapterData] = useState(defaultNotificationAdapter);
  const [shareWithUsers, setShareWithUsers] = useState(jobToBeEdit?.shared_with_user ?? []);
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [reuseAdapterSelection, setReuseAdapterSelection] = useState(null);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const actions = useActions();

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

  // Legacy change detection hooks were unused; remove to satisfy lint

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
        enabled,
        jobId: jobToBeEdit?.id || null,
      });
      await actions.jobsData.getJobs();
      Toast.success('Job successfully saved...');
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

      <Headline text={jobToBeEdit ? 'Edit Job' : 'Create new Job'} />
      <form>
        <SegmentPart name="Name" Icon={IconPaperclip}>
          <Input
            autoFocus
            type="text"
            maxLength={40}
            placeholder="Name"
            width={6}
            value={name}
            onChange={(value) => setName(value)}
          />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          name="Providers"
          Icon={IconBriefcase}
          helpText={`
            A provider is essentially the service (e.g. ImmoScout24, Kleinanzeigen) that Fredy searches for new listings.
            Fredy will open a new tab pointing to the website of this provider. You have to adjust your search parameter
            and click on "Search". If the results are being shown, copy the browser URL in here.
            `}
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
            Add new Provider
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
          name="Notification Adapters"
          helpText="Fredy supports multiple ways to notify you about new findings. These are called notification adapter. You can chose between email, Telegram etc."
        >
          <Button
            type="primary"
            className="jobMutation__newButton"
            icon={<IconPlusCircle />}
            onClick={() => setNotificationCreationVisibility(true)}
          >
            Add new Notification Adapter
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
          Icon={IconClear}
          name="Blacklist"
          helpText="If a listing contains one of these words, it will be filtered out. Type in a word, then hit enter."
        >
          <TagInput
            value={blacklist || []}
            placeholder="Add a word for filtering..."
            onChange={(v) => setBlacklist([...v])}
          />
        </SegmentPart>
        <Divider margin="1rem" />
        <SegmentPart
          Icon={IconUser}
          name="Sharing with user"
          helpText="You can share this job with other users. They will be able to see the listings, but only (as the creator) you can edit the job. Admins are filtered from this list as they have access to everything."
        >
          {shareableUserList.length === 0 ? (
            <div>No users found to share this Job to. Please create additional non-admin user.</div>
          ) : (
            <Select
              filter
              multiple
              placeholder="Search user"
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
          name="Job activation"
          helpText="Whether or not the job is activated. Inactive jobs will be ignored when Fredy checks for new listings."
        >
          <Switch className="jobMutation__spaceTop" onChange={(checked) => setEnabled(checked)} checked={enabled} />
        </SegmentPart>
        <Divider margin="1rem" />
        <Button type="danger" style={{ marginRight: '1rem' }} onClick={() => navigate('/jobs')}>
          Cancel
        </Button>
        <Button
          type="primary"
          icon={<IconPlusCircle />}
          disabled={!isSavingEnabled() || saving}
          loading={saving}
          onClick={() => mutateJob()}
        >
          Save
        </Button>
      </form>

      <Modal
        visible={confirmVisible}
        onCancel={() => setConfirmVisible(false)}
        footer={null}
        title="Leave page?"
        maskClosable={false}
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
