import { PointerLockControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { Euler, PerspectiveCamera, type PointLight } from 'three';
import { getPlan } from '../store/planStore';
import { useUiStore } from '../store/uiStore';
import {
  eyeElevation,
  MAX_STEP_SECONDS,
  RUN_FACTOR,
  stepLevel,
  WALK_SPEED,
  walkLevels,
  walkStart,
  walkStartLevel,
  walkStep,
} from './walk';

/** Wider than the orbit view's 50 degrees: rooms feel less like a keyhole. */
const WALK_FOV = 65;
/** Radians per pixel of mouse movement, as PointerLockControls. */
const LOOK_SPEED = 0.002;
/**
 * A soft light at the eye while walking: indoors the sky and the sun reach only the floor, so
 * without it ceilings (slab undersides) and walls facing away from the sun are murky.
 */
const HEADLAMP_INTENSITY = 0.7;
/** Keep the view a little short of straight up or down. */
const MIN_POLAR = 0.05;
const MAX_POLAR = Math.PI - 0.05;

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const RUN = ['ShiftLeft', 'ShiftRight'];
const CAPTURED = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT, 'Space', 'PageUp', 'PageDown', 'Tab']);

const euler = new Euler(0, 0, 0, 'YXZ');

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

const exitWalk = () => useUiStore.getState().setCameraMode('orbit');

/**
 * First-person walkthrough: drei PointerLockControls for mouse look (a click on the canvas locks
 * the pointer), WASD / arrows to walk at WALK_SPEED in the horizontal plane (Shift runs), Q / E or
 * PageDown / PageUp to change level, Esc (or losing the pointer lock) back to orbit. When the
 * browser refuses the pointer lock, dragging with the left button looks around instead. Mounted only
 * in walk mode (Controls.tsx), so it never coexists with the orbit controls; the canvas renders
 * every frame meanwhile (Scene3D sets frameloop="always").
 */
export function FirstPerson() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef(new Set<string>());
  const lamp = useRef<PointLight>(null);
  const levelId = useRef<string | null>(null);

  // Enter: eye height on the start level, at the start point (the picked one, the entry door, or
  // the middle of the house; walk.ts walkStart), looking the way it says.
  useEffect(() => {
    const plan = getPlan();
    const ui = useUiStore.getState();
    const levels = walkLevels(plan, ui);
    const id = walkStartLevel(plan, ui);
    if (!id) return;
    const { at, dir } = walkStart(plan, id, ui.viewMode, levels, ui.walkFrom);
    const y = eyeElevation(plan, id);
    camera.position.set(at.x, y, at.y);
    camera.lookAt(at.x + dir.x, y, at.y + dir.y);
    levelId.current = id;
    ui.setWalkLevel(id);
    const fov = camera instanceof PerspectiveCamera ? camera.fov : null;
    if (camera instanceof PerspectiveCamera) {
      camera.fov = WALK_FOV;
      camera.updateProjectionMatrix();
    }
    const pressed = keys.current;
    return () => {
      pressed.clear();
      if (camera instanceof PerspectiveCamera && fov !== null) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock();
      useUiStore.getState().setWalkLocked(false);
    };
  }, [camera, gl]);

  const changeLevel = useCallback(
    (dir: -1 | 1) => {
      const plan = getPlan();
      const current = levelId.current;
      if (!current) return;
      const next = stepLevel(walkLevels(plan, useUiStore.getState()), current, dir);
      if (!next) return;
      camera.position.y = eyeElevation(plan, next);
      levelId.current = next;
      useUiStore.getState().setWalkLevel(next);
    },
    [camera],
  );

  // Keys: captured on the window before the app's 2D hotkeys see them, all of them while walking
  // (except typing into a text field while the pointer is free).
  useEffect(() => {
    const pressed = keys.current;
    const onDown = (e: KeyboardEvent) => {
      if (!document.pointerLockElement && isEditable(e.target)) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts keep working
      pressed.add(e.code);
      if (CAPTURED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyF') {
        e.preventDefault();
        exitWalk();
      } else if (e.code === 'KeyQ' || e.code === 'PageDown') changeLevel(-1);
      else if (e.code === 'KeyE' || e.code === 'PageUp') changeLevel(1);
    };
    const onUp = (e: KeyboardEvent) => {
      pressed.delete(e.code);
      if (document.pointerLockElement || !isEditable(e.target)) e.stopPropagation();
    };
    const onBlur = () => pressed.clear();
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [changeLevel]);

  // A click on the canvas locks the pointer (we request it ourselves to catch a refusal, e.g. a
  // click right after Esc, or a browser without the API). Dragging with the left button looks
  // around whenever the pointer is not locked, so walking still works without the lock.
  useEffect(() => {
    const el = gl.domElement;
    let drag: number | null = null;
    let lockRefused = false;
    const onClick = () => {
      if (lockRefused || document.pointerLockElement === el) return;
      try {
        const p = el.requestPointerLock() as Promise<void> | undefined;
        p?.catch(() => {
          lockRefused = true;
        });
      } catch {
        lockRefused = true;
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || document.pointerLockElement === el) return;
      drag = e.pointerId;
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (drag !== e.pointerId || document.pointerLockElement === el) return;
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= e.movementX * LOOK_SPEED;
      euler.x -= e.movementY * LOOK_SPEED;
      euler.x = Math.max(Math.PI / 2 - MAX_POLAR, Math.min(Math.PI / 2 - MIN_POLAR, euler.x));
      camera.quaternion.setFromEuler(euler);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (drag !== e.pointerId) return;
      drag = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    lamp.current?.position.copy(camera.position);
    const k = keys.current;
    if (!k.size) return;
    const has = (codes: string[]) => codes.some((c) => k.has(c));
    const forward = Number(has(FORWARD)) - Number(has(BACK));
    const right = Number(has(RIGHT)) - Number(has(LEFT));
    if (!forward && !right) return;
    const distance = WALK_SPEED * (has(RUN) ? RUN_FACTOR : 1) * Math.min(delta, MAX_STEP_SECONDS);
    euler.setFromQuaternion(camera.quaternion);
    const [dx, dz] = walkStep(euler.y, forward, right, distance);
    camera.position.x += dx;
    camera.position.z += dz;
    lamp.current?.position.copy(camera.position);
  });

  const onLock = useCallback(() => useUiStore.getState().setWalkLocked(true), []);
  // Esc in a real browser releases the lock without a keydown reaching the page: back to orbit.
  const onUnlock = useCallback(() => {
    useUiStore.getState().setWalkLocked(false);
    exitWalk();
  }, []);

  return (
    <>
      <pointLight ref={lamp} intensity={HEADLAMP_INTENSITY} decay={0} />
      <PointerLockControls
        makeDefault
        domElement={gl.domElement}
        // drei locks on a click anywhere on the document unless given a selector; the canvas click
        // handler above does it instead, so this selector deliberately matches nothing.
        selector="#homeplan-no-auto-pointer-lock"
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAX_POLAR}
        onLock={onLock}
        onUnlock={onUnlock}
      />
    </>
  );
}
