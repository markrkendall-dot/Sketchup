import CoreGraphics
import Foundation
import ImageIO
import simd

/// Per-vertex colour for mesh.ply: each vertex takes the colour it has in the nearest keyframe
/// whose image it projects into. There is no occlusion test, so a vertex hidden behind something
/// in that photo picks up the colour of whatever hides it. Grey where no keyframe sees it.
enum MeshColorizer {
    static let grey: UInt8 = 128
    /// Ignore keyframes further than this from the vertex.
    static let maxDistance: Float = 8
    /// Photos are decoded at this size for sampling; plenty for vertex colours.
    static let sampleLongEdge = 960

    private struct Camera {
        let worldToCamera: simd_float4x4
        let position: SIMD3<Float>
        let fx, fy, cx, cy: Float
        let width, height: Float
        let url: URL

        /// Pixel position in the saved image, or nil if the point is behind or outside it.
        func project(_ p: SIMD3<Float>) -> SIMD2<Float>? {
            // ARKit camera: +X right, +Y up, looking along -Z. Image: x right, y down.
            let q = worldToCamera * SIMD4<Float>(p.x, p.y, p.z, 1)
            let depth = -q.z
            guard depth > 0.1 else { return nil }
            let u = fx * (q.x / depth) + cx
            let v = fy * (-q.y / depth) + cy
            guard u >= 1, v >= 1, u < width - 1, v < height - 1 else { return nil }
            return SIMD2<Float>(u, v)
        }
    }

    /// Returns 3 bytes (r, g, b) per position.
    static func colors(for positions: [SIMD3<Float>], keyframes: [Keyframe]) -> [UInt8] {
        let count = positions.count
        var rgb = [UInt8](repeating: grey, count: count * 3)
        guard !keyframes.isEmpty, count > 0 else { return rgb }

        let cameras = keyframes.map { k in
            Camera(
                worldToCamera: k.transform.inverse,
                position: SIMD3<Float>(k.transform.columns.3.x, k.transform.columns.3.y, k.transform.columns.3.z),
                fx: k.fx, fy: k.fy, cx: k.cx, cy: k.cy,
                width: Float(k.width), height: Float(k.height),
                url: k.url
            )
        }

        // 1. Nearest keyframe that sees each vertex.
        var best = [Int32](repeating: -1, count: count)
        var bestDistance = [Float](repeating: maxDistance * maxDistance, count: count)
        for (k, camera) in cameras.enumerated() {
            for i in 0..<count {
                let p = positions[i]
                let d2 = simd_distance_squared(p, camera.position)
                if d2 >= bestDistance[i] { continue }
                if camera.project(p) == nil { continue }
                bestDistance[i] = d2
                best[i] = Int32(k)
            }
        }

        // 2. Group vertices by keyframe, then decode each photo once and sample it.
        var buckets = [[Int32]](repeating: [], count: cameras.count)
        for i in 0..<count where best[i] >= 0 {
            buckets[Int(best[i])].append(Int32(i))
        }
        for (k, members) in buckets.enumerated() where !members.isEmpty {
            let camera = cameras[k]
            guard let image = loadRGBA(url: camera.url, maxPixel: sampleLongEdge) else { continue }
            let sx = Float(image.width) / camera.width
            let sy = Float(image.height) / camera.height
            for member in members {
                let i = Int(member)
                guard let uv = camera.project(positions[i]) else { continue }
                let px = min(image.width - 1, max(0, Int(uv.x * sx)))
                let py = min(image.height - 1, max(0, Int(uv.y * sy)))
                let o = (py * image.width + px) * 4
                rgb[i * 3] = image.pixels[o]
                rgb[i * 3 + 1] = image.pixels[o + 1]
                rgb[i * 3 + 2] = image.pixels[o + 2]
            }
        }
        return rgb
    }

    private struct RGBAImage {
        let pixels: [UInt8]
        let width: Int
        let height: Int
    }

    /// Decodes a JPEG at reduced size into RGBA bytes, top row first.
    private static func loadRGBA(url: URL, maxPixel: Int) -> RGBAImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
            kCGImageSourceCreateThumbnailWithTransform: false,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        let width = cgImage.width
        let height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(
                data: raw.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
            ) else { return false }
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? RGBAImage(pixels: pixels, width: width, height: height) : nil
    }
}
