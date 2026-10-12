import { describe, expect, it } from 'vitest';
import { useUiStore } from '../store/uiStore';

// The 3D bar's Roofs checkbox (view3d/Scene3D.tsx): LevelMeshes skips every roof while it is off,
// so the top floor can be seen from above.
describe('the 3D Roofs checkbox', () => {
  it('shows the roofs by default and lifts them off when unticked', () => {
    expect(useUiStore.getState().show3dRoofs).toBe(true);
    useUiStore.getState().setShow3dRoofs(false);
    expect(useUiStore.getState().show3dRoofs).toBe(false);
    useUiStore.getState().setShow3dRoofs(true);
    expect(useUiStore.getState().show3dRoofs).toBe(true);
  });
});
