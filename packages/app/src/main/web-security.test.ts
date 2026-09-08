import { describe, expect, it } from 'vitest';
import {
  allowPermission,
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpenHandler,
  isMediaPermission
} from './web-security.ts';

describe('web-security C1 defaults', () => {
  it('denies window.open unless a later handler replaces it', () => {
    expect(denyWindowOpenHandler()).toEqual({ action: 'deny' });
  });

  it('denies session permission checks by default', () => {
    expect(denyPermissionCheck()).toBe(false);
  });

  it('denies permission requests via callback(false)', () => {
    let granted: boolean | undefined;
    denyPermissionRequest(undefined, 'notifications', (value) => {
      granted = value;
    });
    expect(granted).toBe(false);
  });

  it('allows microphone only on the chrome renderer, never the guest', () => {
    expect(isMediaPermission('media')).toBe(true);
    expect(allowPermission({ isChrome: true, permission: 'media' })).toBe(true);
    expect(allowPermission({ isChrome: false, permission: 'media' })).toBe(false);
    expect(allowPermission({ isChrome: true, permission: 'notifications' })).toBe(false);
  });
});
