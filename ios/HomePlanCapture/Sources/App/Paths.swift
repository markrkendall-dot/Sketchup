import Foundation

/// Where bundles live. Documents is shown in the Files app because Info.plist sets
/// UIFileSharingEnabled and LSSupportsOpeningDocumentsInPlace.
enum Paths {
    static var documents: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// Scratch space that the Files app does not show (Object Capture photos).
    static var caches: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    /// Creates `Documents/<slug>-room/` or `Documents/<slug>-object/`, adding -2, -3 ... if taken.
    static func newBundleFolder(name: String, kind: ScanBundle.Kind) throws -> URL {
        let base = slug(name)
        let fm = FileManager.default
        var candidate = documents.appendingPathComponent("\(base)-\(kind.rawValue)", isDirectory: true)
        var n = 2
        while fm.fileExists(atPath: candidate.path) {
            candidate = documents.appendingPathComponent("\(base)-\(n)-\(kind.rawValue)", isDirectory: true)
            n += 1
        }
        try fm.createDirectory(at: candidate, withIntermediateDirectories: true)
        return candidate
    }

    /// Lower case ASCII letters, digits and single hyphens. "Kitchen 2926" becomes "kitchen-2926".
    static func slug(_ text: String) -> String {
        var out = ""
        for scalar in text.lowercased().unicodeScalars {
            let isLetterOrDigit = (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9")
            if isLetterOrDigit {
                out.unicodeScalars.append(scalar)
            } else if !out.isEmpty && !out.hasSuffix("-") {
                out += "-"
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "scan" : out
    }
}
