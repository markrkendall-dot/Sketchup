import ARKit
import simd

/// A merged triangle mesh in the ARKit world frame.
struct MeshData {
    var positions: [SIMD3<Float>] = []
    var faces: [UInt32] = []       // three indices per triangle
}

/// Keeps the latest set of ARMeshAnchors the session has. They exist only if the ARSession runs
/// with scene reconstruction on (see RoomScanController.ensureSceneReconstruction).
final class MeshCollector {
    private var anchors: [UUID: ARMeshAnchor] = [:]

    var anchorCount: Int { anchors.count }

    /// Main thread. Replaces the set with the frame's mesh anchors, so anchors ARKit has merged
    /// away are dropped. An empty set (for example after the session pauses) keeps the last one.
    func update(from frame: ARFrame) {
        var current: [UUID: ARMeshAnchor] = [:]
        for case let anchor as ARMeshAnchor in frame.anchors {
            current[anchor.identifier] = anchor
        }
        if !current.isEmpty { anchors = current }
    }

    func snapshot() -> [ARMeshAnchor] {
        Array(anchors.values)
    }

    /// Copies every anchor's vertices into world coordinates and concatenates the triangles.
    /// Anchors do not share vertices, so seams are left as they are.
    static func merge(_ anchors: [ARMeshAnchor]) -> MeshData {
        var mesh = MeshData()
        for anchor in anchors {
            let geometry = anchor.geometry
            let vertices = geometry.vertices
            let faces = geometry.faces
            guard vertices.format == .float3, faces.indexCountPerPrimitive == 3 else { continue }

            let base = UInt32(mesh.positions.count)
            let vertexStart = vertices.buffer.contents().advanced(by: vertices.offset)
            mesh.positions.reserveCapacity(mesh.positions.count + vertices.count)
            for i in 0..<vertices.count {
                let p = vertexStart.advanced(by: i * vertices.stride).assumingMemoryBound(to: Float.self)
                let world = anchor.transform * SIMD4<Float>(p[0], p[1], p[2], 1)
                mesh.positions.append(SIMD3<Float>(world.x, world.y, world.z))
            }

            let indexCount = faces.count * 3
            let indexStart = faces.buffer.contents()
            mesh.faces.reserveCapacity(mesh.faces.count + indexCount)
            if faces.bytesPerIndex == 4 {
                let idx = indexStart.assumingMemoryBound(to: UInt32.self)
                for k in 0..<indexCount { mesh.faces.append(base + idx[k]) }
            } else if faces.bytesPerIndex == 2 {
                let idx = indexStart.assumingMemoryBound(to: UInt16.self)
                for k in 0..<indexCount { mesh.faces.append(base + UInt32(idx[k])) }
            }
        }
        return mesh
    }
}
