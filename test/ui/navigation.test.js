import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import { navigationSelectHandler } from '../../ui/src/components/navigation/navigationLogic.js';

describe('Navigation onSelect behaviour', () => {
  let originalWindow;
  let originalCustomEvent;

  beforeEach(() => {
    originalWindow = global.window;
    originalCustomEvent = global.CustomEvent;

    class FakeCustomEvent extends Event {
      constructor(type, params = {}) {
        super(type, params);
        this.detail = params.detail;
      }
    }

    global.CustomEvent = FakeCustomEvent;
    global.window = new EventTarget();
  });

  afterEach(() => {
    global.window = originalWindow;
    global.CustomEvent = originalCustomEvent;
  });

  it('dispatches jobNavigationRequest instead of navigating when editing a job and clicking Jobs (pathname)', async () => {
    const navigateCalls = [];
    const navigateSpy = (path) => navigateCalls.push(path);

    let eventDetail;
    const listener = (e) => {
      eventDetail = e.detail;
    };
    window.addEventListener('jobNavigationRequest', listener);

    navigationSelectHandler({ target: '/jobs', pathname: '/jobs/edit/123', navigate: navigateSpy });

    expect(navigateCalls).toHaveLength(0);
    expect(eventDetail).toMatchObject({ target: '/jobs' });

    window.removeEventListener('jobNavigationRequest', listener);
  });

  it('navigates normally when not on job edit page', async () => {
    const navigateCalls = [];
    const navigateSpy = (path) => navigateCalls.push(path);

    navigationSelectHandler({ target: '/jobs', pathname: '/dashboard', navigate: navigateSpy });

    expect(navigateCalls).toEqual(['/jobs']);
  });

  it('dispatches jobNavigationRequest when HashRouter hash indicates edit page', async () => {
    const navigateCalls = [];
    const navigateSpy = (path) => navigateCalls.push(path);

    let eventDetail;
    const listener = (e) => {
      eventDetail = e.detail;
    };
    window.addEventListener('jobNavigationRequest', listener);

    navigationSelectHandler({ target: '/jobs', pathname: '/', hash: '#/jobs/edit/abc', navigate: navigateSpy });

    expect(navigateCalls).toHaveLength(0);
    expect(eventDetail).toMatchObject({ target: '/jobs' });

    window.removeEventListener('jobNavigationRequest', listener);
  });
});
