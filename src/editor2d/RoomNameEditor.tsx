import { useEffect, useRef, useState } from 'react';
import { duplicateRoomNotice, showNotice } from '../ui/fileActions';
import { usePlanStore } from '../store/planStore';
import { EMPTY_SELECTION, useUiStore, type RoomEdit } from '../store/uiStore';
import { worldToScreen } from './viewport';

/**
 * Inline name editor floating over the canvas (absolutely positioned in .canvas-host). Opened by
 * the room tool for a new room (which is only added to the plan on commit, so a cancelled one
 * leaves no undo step) or by double-clicking a label to rename. Enter or blur commits, Esc cancels.
 */
export function RoomNameEditor() {
  const edit = useUiStore((s) => s.roomEdit);
  if (!edit) return null;
  // Remount per edit so the text starts from the edited room's name.
  return <Editor key={`${edit.roomId ?? 'new'}:${edit.at.x},${edit.at.y}`} edit={edit} />;
}

function Editor({ edit }: { edit: RoomEdit }) {
  const v = useUiStore((s) => s.viewport);
  const [text, setText] = useState(edit.initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    // Focus after the pointer events that opened the editor have finished moving focus around.
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const close = () => {
    done.current = true;
    const ui = useUiStore.getState();
    if (ui.roomEdit === edit) ui.setRoomEdit(null);
    // Give the keyboard back to the canvas so tool hotkeys keep working.
    document.querySelector<SVGSVGElement>('svg.plan-canvas')?.focus({ preventScroll: true });
  };

  const commit = () => {
    if (done.current) return;
    const ui = useUiStore.getState();
    const plan = usePlanStore.getState();
    const name = text.trim();
    const levelId = ui.activeLevelId;
    if (name) {
      const dup = duplicateRoomNotice(levelId, name, edit.roomId);
      if (edit.roomId) plan.updateRoom(levelId, edit.roomId, { name });
      else {
        const id = plan.addRoom(levelId, { name, anchor: edit.anchor });
        if (id) ui.setSelection({ ...EMPTY_SELECTION, rooms: [id] });
      }
      // After the edit, which clears the status bar's notice.
      if (dup) showNotice(dup);
    }
    close();
  };

  const p = worldToScreen(v, edit.at);
  return (
    <input
      ref={ref}
      className="room-name-editor"
      aria-label="Room name"
      placeholder="Room name"
      value={text}
      spellCheck={false}
      autoComplete="off"
      style={{ left: p.x, top: p.y }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') close();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
