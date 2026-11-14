import { PointerLockControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { Euler, PerspectiveCamera, type PointLight } from 'three';
import { getViewPlan } from '../store/viewStore';
import { useUiStore } from '../store/uiStore';
import { getLevelElevations } from '../derive/levels';
import {
  EYE_EASE,
  EYE_HEIGHT,
  eyeElevation,
  levelAtFeet,
  MAX_STEP_SECONDS,
  RUN_FACTOR,
  stepLevel,
  WALK_SPEED,
  walkLevels,
  walkStart,
  walkStartLevel,
  walkMove,
  walkStep,
  walkWorld,
  surfaceAt,
} from './walk';
import { walkInput, walkNow } from './walkInput';

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
 * the pointer), WASD / arrows to walk at WALK_SPEED (Shift runs) on what is there: up stairs and
 * steps, down to what is below, stopped by rails, guards, the sides of stairs and (collision on,
 * C toggles it) the walls (walk.ts walkMove), the active level following the feet. Q / E or
 * PageDown / PageUp jump a level, Esc (or losing the pointer lock) back to orbit. When the
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
  /** The feet's elevation: the eye eases to EYE_HEIGHT over it (walk.ts walkMove moves them). */
  const feet = useRef(0);

  // Stand at the start point (the picked one or a saved viewpoint, the entry door, or the middle of
  // the house; walk.ts walkStart) at eye height on the start level, looking the way it says.
  const place = useCallback((): boolean => {
    const plan = getViewPlan();
    const ui = useUiStore.getState();
    const levels = walkLevels(plan, ui);
    const id = walkStartLevel(plan, ui);
    if (!id) return false;
    const { at, dir } = walkStart(plan, id, ui.viewMode, levels, ui.walkFrom);
    const floor = getLevelElevations(plan)[id]?.floorTop ?? 0;
    feet.current = surfaceAt(walkWorld(plan, ui.viewMode, levels), at, floor) ?? floor;
    const y = feet.current + EYE_HEIGHT;
    camera.position.set(at.x, y, at.y);
    camera.lookAt(at.x + dir.x, y, at.y + dir.y);
    const pitch = ui.walkFrom?.levelId === id ? ui.walkFrom.pitch : undefined;
    if (pitch) {
      euler.setFromQuaternion(camera.quaternion);
      euler.x = Math.max(Math.PI / 2 - MAX_POLAR, Math.min(Math.PI / 2 - MIN_POLAR, pitch));
      camera.quaternion.setFromEuler(euler);
    }
    levelId.current = id;
    ui.setWalkLevel(id);
    return true;
  }, [camera]);

  // A saved viewpoint picked while already walking: stand there.
  const jump = useUiStore((s) => s.walkJump);
  const firstJump = useRef(jump);
  useEffect(() => {
    if (jump === firstJump.current) return;
    firstJump.current = jump;
    place();
  }, [jump, place]);

  // Enter.
  useEffect(() => {
    if (!place()) return;
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
      walkInput.forward = 0;
      walkInput.right = 0;
      walkNow.pose = null;
    };
  }, [camera, gl, place]);

  const changeLevel = useCallback(
    (dir: -1 | 1) => {
      const plan = getViewPlan();
      const current = levelId.current;
      if (!current) return;
      const next = stepLevel(walkLevels(plan, useUiStore.getState()), current, dir, plan);
      if (!next) return;
      camera.position.y = eyeElevation(plan, next);
      feet.current = camera.position.y - EYE_HEIGHT;
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
      else if (e.code === 'KeyC') useUiStore.getState().setWalkCollision(!useUiStore.getState().walkCollision);
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
    let last = { x: 0, y: 0 };
    let lockRefused = false;
    // A finger looks round by dragging; the pointer lock is for a mouse.
    let touch = false;
    const onClick = () => {
      if (touch || lockRefused || document.pointerLockElement === el) return;
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
      touch = e.pointerType === 'touch';
      if (e.button !== 0 || document.pointerLockElement === el || drag !== null) return;
      drag = e.pointerId;
      last = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (drag !== e.pointerId || document.pointerLockElement === el) return;
      // From the positions, not movementX / Y, which a touch does not report everywhere. A finger
      // drags the scene (the view turns against it); a mouse turns the head (with it).
      const sign = e.pointerType === 'touch' ? -1 : 1;
      const speed = e.pointerType === 'touch' ? LOOK_SPEED * 2 : LOOK_SPEED;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      euler.setFromQuaternion(camera.quaternion);
      euler.y -= sign * dx * speed;
      euler.x -= sign * dy * speed;
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
    // The eye eases to the feet's height (a step up, a fall, a change of level).
    const eye = feet.current + EYE_HEIGHT;
    if (Math.abs(camera.position.y - eye) > 0.01) camera.position.y += (eye - camera.position.y) * Math.min(1, delta * EYE_EASE);
    lamp.current?.position.copy(camera.position);
    euler.setFromQuaternion(camera.quaternion);
    if (levelId.current) walkNow.pose = { levelId: levelId.current, at: { x: camera.position.x, y: camera.position.z }, yaw: euler.y, pitch: euler.x };
    const k = keys.current;
    const has = (codes: string[]) => codes.some((c) => k.has(c));
    const forward = Number(has(FORWARD)) - Number(has(BACK)) + walkInput.forward;
    const right = Number(has(RIGHT)) - Number(has(LEFT)) + walkInput.right;
    if (!forward && !right) return;
    const distance = WALK_SPEED * (has(RUN) ? RUN_FACTOR : 1) * Math.min(delta, MAX_STEP_SECONDS);
    const [dx, dz] = walkStep(euler.y, forward, right, distance);
    // Feet on what is there: up a step, down to what is below, stopped by rails and stair sides.
    const plan = getViewPlan();
    const ui = useUiStore.getState();
    const levels = walkLevels(plan, ui);
    const at = { x: camera.position.x, y: camera.position.z };
    const moved = walkMove(walkWorld(plan, ui.viewMode, levels, ui.walkCollision), { at, feet: feet.current }, { x: at.x + dx, y: at.y + dz });
    camera.position.x = moved.at.x;
    camera.position.z = moved.at.y;
    feet.current = moved.feet;
    const on = levelAtFeet(plan, levels, moved.feet, moved.at);
    if (on && on !== levelId.current) {
      levelId.current = on;
      ui.setWalkLevel(on);
    }
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
