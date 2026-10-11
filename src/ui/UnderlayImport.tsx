import { useEffect, useRef, type ChangeEvent } from 'react';
import { switchTool } from '../editor2d/tools';
import { registerUnderlayPicker, type PickRequest } from '../editor2d/tools/underlayTool';
import { screenToWorld } from '../editor2d/viewport';
import { importImage, UNDERLAY_ACCEPT } from '../io/image';
import { placeUnderlay, replaceUnderlayImage } from '../model/underlay';
import { getPlan, usePlanStore } from '../store/planStore';
import { useUiStore } from '../store/uiStore';

/**
 * Import an image file under a level. A new image is centred in the current view at a provisional
 * scale (40' wide), 60% opaque and unlocked; a replacement keeps the old placement. Then the
 * underlay tool is activated with the image selected, ready for "Scale by two points".
 */
export async function loadUnderlayFile(file: File, req: PickRequest): Promise<void> {
  const ui = useUiStore.getState();
  ui.patchDraft({ error: false, message: `Loading ${file.name}...` });
  let img;
  try {
    img = await importImage(file);
  } catch (err) {
    useUiStore.getState().patchDraft({ message: null });
    window.alert(err instanceof Error ? err.message : String(err));
    return;
  }
  const level = getPlan().levels[req.levelId];
  if (!level) return;
  const { setUnderlay } = usePlanStore.getState();
  if (req.replace && level.underlay) {
    setUnderlay(level.id, replaceUnderlayImage(level.underlay, img.dataUrl, img.pixelWidth, img.pixelHeight));
  } else {
    const { viewport, canvasSize } = useUiStore.getState();
    const center = screenToWorld(viewport, { x: canvasSize.width / 2, y: canvasSize.height / 2 });
    setUnderlay(level.id, placeUnderlay(img.dataUrl, img.pixelWidth, img.pixelHeight, center));
  }
  if (useUiStore.getState().activeLevelId !== level.id) return;
  if (useUiStore.getState().activeTool !== 'underlay') switchTool('underlay');
  const after = useUiStore.getState();
  after.selectUnderlay(true);
  after.patchDraft({
    error: false,
    message: req.replace
      ? `Image replaced (${img.pixelWidth} x ${img.pixelHeight} px). Check its scale (Scale by two points).`
      : `Image loaded (${img.pixelWidth} x ${img.pixelHeight} px) at 40' wide for now. Next: Scale by two points in the panel.`,
  });
}

/**
 * The one hidden file input for underlay images. Tools and panel buttons open it through
 * requestUnderlayImage(); a change without a request (e.g. a test setting files directly) loads
 * under the active level.
 */
export function UnderlayFileInput() {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<PickRequest | null>(null);

  useEffect(() => {
    registerUnderlayPicker((req) => {
      pending.current = req;
      input.current?.click();
    });
    return () => registerUnderlayPicker(null);
  }, []);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const req = pending.current ?? { levelId: useUiStore.getState().activeLevelId, replace: false };
    pending.current = null;
    if (file) void loadUnderlayFile(file, req);
  };

  return (
    <input
      ref={input}
      className="underlay-file-input"
      type="file"
      accept={UNDERLAY_ACCEPT}
      aria-label="Underlay image file"
      hidden
      onChange={onChange}
    />
  );
}
