import { expect } from 'chai';
import esmock from 'esmock';

const navLogicPath = '../../ui/src/components/navigation/navigationLogic.js';

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

    const { navigationSelectHandler } = await esmock(navLogicPath);

    let eventDetail;
    const listener = (e) => {
      eventDetail = e.detail;
    };
    window.addEventListener('jobNavigationRequest', listener);

    navigationSelectHandler({ target: '/jobs', pathname: '/jobs/edit/123', navigate: navigateSpy });

    expect(navigateCalls).to.be.empty;
    expect(eventDetail).to.deep.include({ target: '/jobs' });

    window.removeEventListener('jobNavigationRequest', listener);
  });

  it('navigates normally when not on job edit page', async () => {
    const navigateCalls = [];
    const navigateSpy = (path) => navigateCalls.push(path);

    const { navigationSelectHandler } = await esmock(navLogicPath);

    navigationSelectHandler({ target: '/jobs', pathname: '/dashboard', navigate: navigateSpy });

    expect(navigateCalls).to.deep.equal(['/jobs']);
  });

  it('dispatches jobNavigationRequest when HashRouter hash indicates edit page', async () => {
    const navigateCalls = [];
    const navigateSpy = (path) => navigateCalls.push(path);

    const { navigationSelectHandler } = await esmock(navLogicPath);

    let eventDetail;
    const listener = (e) => {
      eventDetail = e.detail;
    };
    window.addEventListener('jobNavigationRequest', listener);

    navigationSelectHandler({ target: '/jobs', pathname: '/', hash: '#/jobs/edit/abc', navigate: navigateSpy });

    expect(navigateCalls).to.be.empty;
    expect(eventDetail).to.deep.include({ target: '/jobs' });

    window.removeEventListener('jobNavigationRequest', listener);
  });
});
