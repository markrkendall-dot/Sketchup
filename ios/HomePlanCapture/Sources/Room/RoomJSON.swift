import Foundation
import RoomPlan
import simd

// room.json in our own explicit format (docs/scan/FORMAT.md), so nothing downstream depends on
// how Swift happens to encode Apple's types.

struct RoomJSON: Encodable {
    var format: Int = 1
    var story: Int
    var surfaces: [SurfaceJSON]
    var objects: [ObjectJSON]
    var sections: [SectionJSON]
}

struct SurfaceJSON: Encodable {
    var id: String
    var category: String
    var parentId: String?
    var confidence: String
    var dimensions: [Float]
    var transform: [Float]
    var doorOpen: Bool?
    var curved: Bool
    var polygon: [[Float]]?

    enum CodingKeys: String, CodingKey {
        case id, category, parentId, confidence, dimensions, transform, doorOpen, curved, polygon
    }

    // Hand written so that parentId is written as null, and doorOpen and polygon are left out
    // when they do not apply.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(category, forKey: .category)
        if let parentId { try c.encode(parentId, forKey: .parentId) } else { try c.encodeNil(forKey: .parentId) }
        try c.encode(confidence, forKey: .confidence)
        try c.encode(dimensions, forKey: .dimensions)
        try c.encode(transform, forKey: .transform)
        try c.encodeIfPresent(doorOpen, forKey: .doorOpen)
        try c.encode(curved, forKey: .curved)
        try c.encodeIfPresent(polygon, forKey: .polygon)
    }
}

struct ObjectJSON: Encodable {
    var id: String
    var category: String
    var parentId: String?
    var confidence: String
    var dimensions: [Float]
    var transform: [Float]
    var attributes: [String]

    enum CodingKeys: String, CodingKey {
        case id, category, parentId, confidence, dimensions, transform, attributes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(category, forKey: .category)
        if let parentId { try c.encode(parentId, forKey: .parentId) } else { try c.encodeNil(forKey: .parentId) }
        try c.encode(confidence, forKey: .confidence)
        try c.encode(dimensions, forKey: .dimensions)
        try c.encode(transform, forKey: .transform)
        try c.encode(attributes, forKey: .attributes)
    }
}

struct SectionJSON: Encodable {
    var label: String
    var center: [Float]
}

enum RoomExport {
    static func make(_ room: CapturedRoom) -> RoomJSON {
        // VERIFY: floors, sections and story are iOS 17 additions to CapturedRoom.
        let allSurfaces = room.walls + room.doors + room.windows + room.openings + room.floors
        return RoomJSON(
            story: room.story,
            surfaces: allSurfaces.map(surface),
            objects: room.objects.map(object),
            sections: room.sections.map { section in
                // VERIFY: Section.label is an enum (kitchen, bedroom ...); its case name is the string.
                SectionJSON(label: String(describing: section.label), center: vector(section.center))
            }
        )
    }

    static func surface(_ s: CapturedRoom.Surface) -> SurfaceJSON {
        var category: String
        var doorOpen: Bool?
        switch s.category {
        case .wall: category = "wall"
        case .door(let isOpen):
            category = "door"
            doorOpen = isOpen
        case .window: category = "window"
        case .opening: category = "opening"
        case .floor: category = "floor"
        @unknown default: category = String(describing: s.category)
        }
        // VERIFY: polygonCorners, curve and parentIdentifier are iOS 17 additions to Surface.
        let corners = s.polygonCorners
        return SurfaceJSON(
            id: s.identifier.uuidString,
            category: category,
            parentId: s.parentIdentifier?.uuidString,
            confidence: confidence(s.confidence),
            dimensions: vector(s.dimensions),
            transform: columnMajor(s.transform),
            doorOpen: doorOpen,
            curved: s.curve != nil,
            polygon: corners.isEmpty ? nil : corners.map(vector)
        )
    }

    static func object(_ o: CapturedRoom.Object) -> ObjectJSON {
        ObjectJSON(
            id: o.identifier.uuidString,
            // Object.Category has no associated values, so its case name ("storage",
            // "washerDryer" ...) is exactly the string FORMAT.md lists.
            category: String(describing: o.category),
            parentId: o.parentIdentifier?.uuidString,
            confidence: confidence(o.confidence),
            dimensions: vector(o.dimensions),
            transform: columnMajor(o.transform),
            // VERIFY: Object.attributes (iOS 17) is an array of attribute enums such as
            // ChairType.dining; String(describing:) gives the case name.
            attributes: o.attributes.map { String(describing: $0) }
        )
    }

    static func confidence(_ c: CapturedRoom.Confidence) -> String {
        switch c {
        case .low: return "low"
        case .medium: return "medium"
        case .high: return "high"
        @unknown default: return "low"
        }
    }

    static func vector(_ v: simd_float3) -> [Float] {
        [v.x, v.y, v.z].map(BundleWriter.finite)
    }

    /// 16 floats, column by column (three.js Matrix4.fromArray layout).
    static func columnMajor(_ m: simd_float4x4) -> [Float] {
        let c = [m.columns.0, m.columns.1, m.columns.2, m.columns.3]
        return c.flatMap { [$0.x, $0.y, $0.z, $0.w] }.map(BundleWriter.finite)
    }
}
