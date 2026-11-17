import ARKit
import Foundation
import RoomPlan

/// Writes the room files of a bundle (FORMAT.md). Each step reports what it did as a log line;
/// only room.json is essential, the rest are written on a best effort basis.
enum RoomBundleWriter {
    /// room.json, capturedRoom.json and room.usdz.
    static func writeRoom(_ room: CapturedRoom, to folder: URL) throws -> [String] {
        var log: [String] = []

        let roomJSON = RoomExport.make(room)
        try BundleWriter.writeJSON(roomJSON, to: folder.appendingPathComponent("room.json"))
        log.append("room.json: \(roomJSON.surfaces.count) surfaces, \(roomJSON.objects.count) objects, \(roomJSON.sections.count) sections")

        do {
            let data = try JSONEncoder().encode(room)
            try data.write(to: folder.appendingPathComponent("capturedRoom.json"), options: .atomic)
            log.append("capturedRoom.json written")
        } catch {
            log.append("capturedRoom.json failed: \(error.localizedDescription)")
        }

        do {
            try room.export(to: folder.appendingPathComponent("room.usdz"), exportOptions: .mesh)
            log.append("room.usdz written (.mesh)")
        } catch {
            log.append("room.usdz failed: \(error.localizedDescription)")
        }
        return log
    }

    static func writeFrames(_ keyframes: [Keyframe], to folder: URL) throws -> [String] {
        try BundleWriter.writeJSON(FramesJSON(keyframes), to: folder.appendingPathComponent("frames.json"))
        return ["frames.json: \(keyframes.count) keyframes"]
    }

    /// mesh.ply from the collected anchors. Slow for a big room (seconds), so call it off the
    /// main thread.
    static func writeMesh(anchors: [ARMeshAnchor], keyframes: [Keyframe], to folder: URL) throws -> [String] {
        let mesh = MeshCollector.merge(anchors)
        guard !mesh.positions.isEmpty, !mesh.faces.isEmpty else {
            return ["mesh.ply not written: the \(anchors.count) mesh anchors held no triangles"]
        }
        let colors = MeshColorizer.colors(for: mesh.positions, keyframes: keyframes)
        try PLYWriter.write(mesh: mesh, colors: colors, to: folder.appendingPathComponent("mesh.ply"))
        return ["mesh.ply: \(anchors.count) anchors, \(mesh.positions.count) vertices, \(mesh.faces.count / 3) triangles"]
    }
}
