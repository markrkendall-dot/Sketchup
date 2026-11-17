import Foundation

/// meta.json, shared by room and object bundles (FORMAT.md).
struct BundleMeta: Encodable {
    var format: Int = 1
    var kind: String
    var name: String
    var date: String
    var device: String
    var os: String
    var app: String
    /// Object bundles only: [width, height, depth] in metres.
    var bounds: [Float]?
    /// Object bundles only, extra to FORMAT.md: the box corners in the model's own frame,
    /// so the converter can move the model onto y = 0 if Object Capture did not.
    var boundsMin: [Float]?
    var boundsMax: [Float]?
}

enum BundleWriter {
    static func writeJSON<T: Encodable>(_ value: T, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
        try encoder.encode(value).write(to: url, options: .atomic)
    }

    static func writeMeta(
        kind: ScanBundle.Kind,
        name: String,
        to folder: URL,
        bounds: (min: SIMD3<Float>, max: SIMD3<Float>)? = nil
    ) throws {
        var meta = BundleMeta(
            kind: kind.rawValue,
            name: name,
            date: ISO8601DateFormatter().string(from: Date()),
            device: DeviceInfo.model,
            os: DeviceInfo.os,
            app: DeviceInfo.app
        )
        if let bounds {
            let size = bounds.max - bounds.min
            meta.bounds = [size.x, size.y, size.z].map(finite)
            meta.boundsMin = [bounds.min.x, bounds.min.y, bounds.min.z].map(finite)
            meta.boundsMax = [bounds.max.x, bounds.max.y, bounds.max.z].map(finite)
        }
        try writeJSON(meta, to: folder.appendingPathComponent("meta.json"))
    }

    /// A plain text record of what happened during capture (whether a mesh was collected and so on).
    static func writeLog(_ lines: [String], to folder: URL) {
        let text = lines.joined(separator: "\n") + "\n"
        try? text.data(using: .utf8)?.write(to: folder.appendingPathComponent("capture-log.txt"))
    }

    /// JSONEncoder refuses NaN and infinity, so replace them with 0.
    static func finite(_ value: Float) -> Float {
        value.isFinite ? value : 0
    }
}
