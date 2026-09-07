import { describe, expect, it } from 'vitest';
import {
  denyPermissionCheck,
  denyPermissionRequest,
  denyWindowOpenHandler
} from './web-security.ts';

describe('web-security C1 defaults', () => {
  it('denies window.open unless a later handler replaces it', () => {
    expect(denyWindowOpenHandler()).toEqual({ action: 'deny' });
  });

  it('denies session permission checks', () => {
    expect(denyPermissionCheck()).toBe(false);
  });

  it('denies permission requests via callback(false)', () => {
    let granted: boolean | undefined;
    denyPermissionRequest(undefined, 'notifications', (value) => {
      granted = value;
    });
    expect(granted).toBe(false);
  });
});
