import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, type ComponentRef } from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { getPlan } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import { planBox } from './bounds';
import { FirstPerson } from './FirstPerson';
import { visible3dLevels } from './visibility';

/** Camera pose kept across unmounts (switching to the 2D layout or to walk mode, and back). */
let saved: { position: Vector3; target: Vector3 } | null = null;

/** Seen from the south-east (plan +x, +y), above. */
const VIEW_DIR = new Vector3(0.85, 0.75, 1.25).normalize();

/**
 * The 3D camera controls: orbit, or the first-person walk. Exactly one is mounted at a time; the
 * orbit pose is saved when the orbit controls unmount and restored when they mount again.
 */
export function Controls() {
  const mode = useUiStore((s) => s.cameraMode);
  return mode === 'walk' ? <FirstPerson /> : <OrbitView />;
}

/**
 * Orbit controls. On first mount the camera frames the whole plan (target at the bounding box
 * centre); the Fit button (uiStore.requestFit3d) re-frames the visible levels.
 */
function OrbitView() {
  const ref = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const fitRequest = useUiStore((s) => s.fit3dRequest);

  const fit = useCallback(() => {
    const controls = ref.current;
    if (!controls) return;
    const ui = useUiStore.getState();
    const plan = getPlan();
    const box = planBox(plan, visible3dLevels(plan.levelOrder, ui));
    const center = new Vector3(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    const radius = 0.5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
    const aspect = camera instanceof PerspectiveCamera ? camera.aspect : 1;
    // Fit the bounding sphere in the narrower of the two field-of-view angles.
    const half = (fov * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(half) * Math.min(1, aspect));
    const distance = (Math.max(radius, 60) / Math.sin(halfH)) * 1.05;
    camera.position.copy(center).addScaledVector(VIEW_DIR, distance);
    controls.target.copy(center);
    controls.update();
    invalidate();
  }, [camera, invalidate]);

  // First mount: restore the previous pose, or frame the plan. The cleanup saves the pose (leaving
  // the 3D layout, or switching to walk mode) from the controls object captured here.
  useEffect(() => {
    const controls = ref.current;
    if (saved && controls) {
      camera.position.copy(saved.position);
      controls.target.copy(saved.target);
      controls.update();
      invalidate();
    } else fit();
    return () => {
      if (controls) saved = { position: camera.position.clone(), target: controls.target.clone() };
    };
  }, [camera, fit, invalidate]);

  const first = useRef(fitRequest);
  useEffect(() => {
    if (fitRequest !== first.current) fit();
  }, [fitRequest, fit]);

  return <OrbitControls ref={ref} makeDefault enableDamping={false} maxPolarAngle={Math.PI * 0.495} />;
}
