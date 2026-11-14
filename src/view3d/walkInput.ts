// Walk mode's shared state between the canvas (FirstPerson.tsx) and the page round it: the touch
// pad's push (Scene3D's WalkPad writes it, the frame loop reads it) and where the walker is (the
// frame loop writes it, "Save view" reads it). Plain module state: it changes every frame and
// nothing renders from it.

export const walkInput = {
  /** The touch pad's push, each -1 to 1 (0, 0 when it is let go). */
  forward: 0,
  right: 0,
};

/** The walker now: the level, the site point, and the eye's yaw and pitch (radians); null when not walking. */
export const walkNow: { pose: { levelId: string; at: { x: number; y: number }; yaw: number; pitch: number } | null } = { pose: null };
