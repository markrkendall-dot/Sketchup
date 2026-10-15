import { describe, expect, it } from 'vitest';
import { useUiStore } from '../store/uiStore';

// The view at every load (MK, 15 Oct 2026): the proposed design, roofs off, furniture off. The 3D
// bar's Roofs checkbox (view3d/Scene3D.tsx): LevelMeshes skips every roof while it is off, so the
// top floor can be seen from above.
describe('the view at load and the 3D Roofs checkbox', () => {
  it('opens on the proposed design with the roofs and the furniture off', () => {
    const ui = useUiStore.getState();
    expect(ui.viewMode).toBe('proposed');
    expect(ui.show3dRoofs).toBe(false);
    expect(ui.showFurniture).toBe(false);
  });

  it('puts the roofs on when ticked and lifts them off when unticked', () => {
    useUiStore.getState().setShow3dRoofs(true);
    expect(useUiStore.getState().show3dRoofs).toBe(true);
    useUiStore.getState().setShow3dRoofs(false);
    expect(useUiStore.getState().show3dRoofs).toBe(false);
  });
});
