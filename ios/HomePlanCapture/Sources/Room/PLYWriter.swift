import Foundation

/// Binary little endian PLY (FORMAT.md): vertex x y z float32, red green blue uint8,
/// faces as vertex_indices (uchar count, int32 indices).
enum PLYWriter {
    static func write(mesh: MeshData, colors: [UInt8], to url: URL) throws {
        let vertexCount = mesh.positions.count
        let faceCount = mesh.faces.count / 3
        precondition(colors.count == vertexCount * 3, "one rgb triple per vertex")

        let header = """
        ply
        format binary_little_endian 1.0
        comment HomePlanCapture ARKit reconstruction mesh, metres, ARKit world frame
        element vertex \(vertexCount)
        property float x
        property float y
        property float z
        property uchar red
        property uchar green
        property uchar blue
        element face \(faceCount)
        property list uchar int vertex_indices
        end_header

        """

        var bytes = [UInt8]()
        bytes.reserveCapacity(header.utf8.count + vertexCount * 15 + faceCount * 13)
        bytes.append(contentsOf: Array(header.utf8))

        for i in 0..<vertexCount {
            let p = mesh.positions[i]
            append(p.x.bitPattern, to: &bytes)
            append(p.y.bitPattern, to: &bytes)
            append(p.z.bitPattern, to: &bytes)
            bytes.append(colors[i * 3])
            bytes.append(colors[i * 3 + 1])
            bytes.append(colors[i * 3 + 2])
        }
        for f in 0..<faceCount {
            bytes.append(3)
            append(mesh.faces[f * 3], to: &bytes)
            append(mesh.faces[f * 3 + 1], to: &bytes)
            append(mesh.faces[f * 3 + 2], to: &bytes)
        }
        try Data(bytes).write(to: url, options: .atomic)
    }

    /// Four bytes, least significant first. Indices are below 2^31, so they read back as int32.
    private static func append(_ value: UInt32, to bytes: inout [UInt8]) {
        bytes.append(UInt8(truncatingIfNeeded: value))
        bytes.append(UInt8(truncatingIfNeeded: value >> 8))
        bytes.append(UInt8(truncatingIfNeeded: value >> 16))
        bytes.append(UInt8(truncatingIfNeeded: value >> 24))
    }
}
