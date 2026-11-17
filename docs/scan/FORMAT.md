# Scan bundle format (version 1)

What the iPhone app `ios/HomePlanCapture` writes and what `scripts/scan/` reads. The app writes
this explicit format itself, so nothing depends on how Swift happens to encode Apple's types.

All lengths are metres. All positions and transforms are in one ARKit world frame per bundle:
right handed, +Y up, gravity aligned, origin where the session started. A transform is 16 numbers
in column-major order (columns: local right, local up, local normal, position), the same layout as
three.js `Matrix4.fromArray`.

## Room bundle: `<name>-room/`

| File | Contents |
|---|---|
| `meta.json` | `{ "format": 1, "kind": "room", "name", "date" (ISO 8601), "device", "os", "app" }` |
| `room.json` | The parametric room, below |
| `capturedRoom.json` | Apple's `CapturedRoom` as `JSONEncoder` writes it. Kept as a record, not read |
| `room.usdz` | RoomPlan `.mesh` export. Kept as a record, not read |
| `mesh.ply` | ARKit reconstruction mesh, binary little endian PLY: vertex `x y z` float32, `red green blue` uint8, faces as `vertex_indices` (uchar count, int32) |
| `frames.json` | Keyframes, below |
| `frames/0001.jpg` ... | The keyframe photos, long edge at most 1920 px |

### `room.json`

```json
{
  "format": 1,
  "story": 0,
  "surfaces": [
    {
      "id": "UUID",
      "category": "wall | door | window | opening | floor",
      "parentId": "UUID or null",
      "confidence": "low | medium | high",
      "dimensions": [width, height, depth],
      "transform": [16 numbers],
      "doorOpen": true,
      "curved": false,
      "polygon": [[x, y, z], ...]
    }
  ],
  "objects": [
    {
      "id": "UUID",
      "category": "storage | refrigerator | stove | oven | dishwasher | sink | washerDryer | toilet | bathtub | bed | sofa | chair | table | television | fireplace | stairs",
      "parentId": "UUID or null",
      "confidence": "low | medium | high",
      "dimensions": [width, height, depth],
      "transform": [16 numbers],
      "attributes": ["string", ...]
    }
  ],
  "sections": [{ "label": "kitchen", "center": [x, y, z] }]
}
```

`dimensions` are along the local right, up and normal axes, and the transform's position is the
centre of the box. `doorOpen` is present on doors only. `polygon` is present only where RoomPlan
gives corners for a non-rectangular wall or floor (local coordinates). A door, window or opening
names its wall in `parentId`.

### `frames.json`

```json
{
  "format": 1,
  "frames": [
    {
      "file": "frames/0001.jpg",
      "time": 1.25,
      "transform": [16 numbers],
      "intrinsics": [fx, fy, cx, cy],
      "imageSize": [width, height]
    }
  ]
}
```

`transform` is the ARKit camera transform (camera looks along its local -Z, +Y is up in the
landscape-right sensor image). `intrinsics` are in pixels of the saved image.

## Object bundle: `<name>-object/`

| File | Contents |
|---|---|
| `meta.json` | `{ "format": 1, "kind": "object", "name", "date", "device", "os", "app", "bounds": [width, height, depth] }` |
| `object.usdz` | Textured model from Object Capture, metres, +Y up, sitting on y = 0 |
