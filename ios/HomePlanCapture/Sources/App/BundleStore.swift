import Foundation

struct ScanBundle: Identifiable, Hashable {
    enum Kind: String {
        case room
        case object
    }

    let url: URL
    let kind: Kind
    let date: Date
    let bytes: Int64

    var id: URL { url }
    var name: String { url.lastPathComponent }
}

/// The list of bundles in Documents, for the home screen.
@MainActor
final class BundleStore: ObservableObject {
    @Published private(set) var bundles: [ScanBundle] = []

    func refresh() {
        let fm = FileManager.default
        let keys: Set<URLResourceKey> = [.isDirectoryKey, .creationDateKey]
        let items = (try? fm.contentsOfDirectory(
            at: Paths.documents,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )) ?? []

        bundles = items.compactMap { url -> ScanBundle? in
            guard let values = try? url.resourceValues(forKeys: keys), values.isDirectory == true else {
                return nil
            }
            let kind: ScanBundle.Kind
            if url.lastPathComponent.hasSuffix("-room") {
                kind = .room
            } else if url.lastPathComponent.hasSuffix("-object") {
                kind = .object
            } else {
                return nil
            }
            return ScanBundle(
                url: url,
                kind: kind,
                date: values.creationDate ?? .distantPast,
                bytes: Self.folderSize(url)
            )
        }
        .sorted { $0.date > $1.date }
    }

    func delete(_ bundle: ScanBundle) {
        try? FileManager.default.removeItem(at: bundle.url)
        let zip = FileManager.default.temporaryDirectory.appendingPathComponent(bundle.name + ".zip")
        try? FileManager.default.removeItem(at: zip)
        refresh()
    }

    private static func folderSize(_ url: URL) -> Int64 {
        guard let walker = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) else {
            return 0
        }
        var total: Int64 = 0
        for case let file as URL in walker {
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            total += Int64(size)
        }
        return total
    }
}
