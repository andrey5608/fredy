/*
 * Extracted navigation handler to enable unit testing without JSX parsing.
 */

export function navigationSelectHandler({ target, pathname, hash = '', navigate }) {
  const runtimeHash = typeof window !== 'undefined' && window.location ? window.location.hash || '' : '';
  const effectiveHash = hash || runtimeHash;
  const effectivePath = (effectiveHash && effectiveHash.replace(/^#/, '')) || pathname || '';
  const isJobEdit = effectivePath.startsWith('/jobs/edit') || effectivePath.startsWith('/jobs/new');
  const hasJobConfirm = typeof window !== 'undefined' && typeof window.__jobNavConfirm === 'function';

  if (target === '/jobs' && (isJobEdit || hasJobConfirm)) {
    if (hasJobConfirm) {
      window.__jobNavConfirm(target);
    } else {
      window.dispatchEvent(new CustomEvent('jobNavigationRequest', { detail: { target } }));
    }
    return;
  }
  navigate(target);
}
