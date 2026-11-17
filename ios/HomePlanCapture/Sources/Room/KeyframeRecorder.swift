import ARKit
import CoreImage
import Foundation
import ImageIO
import simd

/// One saved keyframe. Intrinsics are in pixels of the saved JPEG.
struct Keyframe {
    let index: Int
    let file: String            // "frames/0001.jpg", relative to the bundle
    let url: URL
    let time: Double            // seconds since the first frame seen
    let transform: simd_float4x4
    let fx: Float
    let fy: Float
    let cx: Float
    let cy: Float
    let width: Int
    let height: Int
}

/// Saves a JPEG whenever the camera has moved about 0.5 m or turned about 20 degrees since the
/// last keyframe. `consider(_:)` is called on the main thread with the current ARFrame; the frame
/// is not kept, only its pixel buffer for the few milliseconds the JPEG encode takes.
final class KeyframeRecorder {
    var minTranslation: Float = 0.5
    var minRotationDegrees: Float = 20
    var maxLongEdge: CGFloat = 1920
    var maxFrames = 400

    /// Keyframes written so far (main thread).
    private(set) var count = 0

    private let framesDir: URL
    private let queue = DispatchQueue(label: "HomePlanCapture.keyframes", qos: .userInitiated)
    private let ciContext = CIContext()

    // Main thread only.
    private var lastPose: simd_float4x4?
    private var startTime: TimeInterval?
    private var inFlight = false
    private var accepted = 0

    // `queue` only.
    private var saved: [Keyframe] = []

    init(framesDir: URL) throws {
        self.framesDir = framesDir
        try FileManager.default.createDirectory(at: framesDir, withIntermediateDirectories: true)
    }

    func consider(_ frame: ARFrame) {
        if startTime == nil { startTime = frame.timestamp }
        guard case .normal = frame.camera.trackingState else { return }
        guard !inFlight, accepted < maxFrames else { return }

        let pose = frame.camera.transform
        if let lastPose, !moved(from: lastPose, to: pose) { return }
        lastPose = pose
        accepted += 1
        inFlight = true

        let index = accepted
        let pixelBuffer = frame.capturedImage
        let intrinsics = frame.camera.intrinsics
        let resolution = frame.camera.imageResolution
        let time = frame.timestamp - (startTime ?? frame.timestamp)

        queue.async { [self] in
            let keyframe = encode(
                index: index, pixelBuffer: pixelBuffer, intrinsics: intrinsics,
                resolution: resolution, time: time, pose: pose
            )
            if let keyframe { saved.append(keyframe) }
            DispatchQueue.main.async { [self] in
                inFlight = false
                if keyframe != nil { count += 1 }
            }
        }
    }

    /// Waits for any JPEG still being written and returns every saved keyframe in order.
    func finish() async -> [Keyframe] {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                continuation.resume(returning: saved.sorted { $0.index < $1.index })
            }
        }
    }

    private func moved(from a: simd_float4x4, to b: simd_float4x4) -> Bool {
        let ta = SIMD3<Float>(a.columns.3.x, a.columns.3.y, a.columns.3.z)
        let tb = SIMD3<Float>(b.columns.3.x, b.columns.3.y, b.columns.3.z)
        if simd_distance(ta, tb) >= minTranslation { return true }
        let relative = simd_quatf(a).inverse * simd_quatf(b)
        var angle = relative.angle
        if angle > .pi { angle = 2 * .pi - angle }
        return angle * 180 / .pi >= minRotationDegrees
    }

    private func encode(
        index: Int, pixelBuffer: CVPixelBuffer, intrinsics: simd_float3x3,
        resolution: CGSize, time: Double, pose: simd_float4x4
    ) -> Keyframe? {
        let srcW = CGFloat(CVPixelBufferGetWidth(pixelBuffer))
        let srcH = CGFloat(CVPixelBufferGetHeight(pixelBuffer))
        let scale = min(1, maxLongEdge / max(srcW, srcH))
        let width = Int((srcW * scale).rounded())
        let height = Int((srcH * scale).rounded())

        // The image stays in the sensor's landscape orientation, as FORMAT.md says.
        var image = CIImage(cvPixelBuffer: pixelBuffer)
        if width != Int(srcW) || height != Int(srcH) {
            image = image
                .transformed(by: CGAffineTransform(scaleX: CGFloat(width) / srcW, y: CGFloat(height) / srcH))
                .cropped(to: CGRect(x: 0, y: 0, width: width, height: height))
        }
        guard
            let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let data = ciContext.jpegRepresentation(
                of: image,
                colorSpace: colorSpace,
                options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.85]
            )
        else { return nil }

        let name = String(format: "%04d.jpg", index)
        let url = framesDir.appendingPathComponent(name)
        do {
            try data.write(to: url)
        } catch {
            return nil
        }

        // ARKit intrinsics are for `imageResolution`; scale them to the saved size.
        let sx = Float(CGFloat(width) / resolution.width)
        let sy = Float(CGFloat(height) / resolution.height)
        return Keyframe(
            index: index,
            file: "frames/" + name,
            url: url,
            time: time,
            transform: pose,
            fx: intrinsics.columns.0.x * sx,
            fy: intrinsics.columns.1.y * sy,
            cx: intrinsics.columns.2.x * sx,
            cy: intrinsics.columns.2.y * sy,
            width: width,
            height: height
        )
    }
}

/// frames.json (FORMAT.md).
struct FramesJSON: Encodable {
    struct Entry: Encodable {
        var file: String
        var time: Double
        var transform: [Float]
        var intrinsics: [Float]
        var imageSize: [Int]
    }

    var format: Int = 1
    var frames: [Entry]

    init(_ keyframes: [Keyframe]) {
        frames = keyframes.map { k in
            Entry(
                file: k.file,
                time: k.time,
                transform: RoomExport.columnMajor(k.transform),
                intrinsics: [k.fx, k.fy, k.cx, k.cy],
                imageSize: [k.width, k.height]
            )
        }
    }
}
