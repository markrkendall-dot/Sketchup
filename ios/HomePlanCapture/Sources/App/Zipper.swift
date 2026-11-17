import Foundation

/// Zips a folder without third-party code. Asking NSFileCoordinator to read a directory with
/// `.forUploading` makes the system write a temporary .zip of it, valid only inside the block,
/// so we copy it out to our own temporary file.
enum Zipper {
    static func zip(folder: URL) throws -> URL {
        let fm = FileManager.default
        let destination = fm.temporaryDirectory.appendingPathComponent(folder.lastPathComponent + ".zip")
        try? fm.removeItem(at: destination)

        var coordinatorError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: folder, options: [.forUploading], error: &coordinatorError) { zipURL in
            do {
                try fm.copyItem(at: zipURL, to: destination)
            } catch {
                copyError = error
            }
        }
        if let coordinatorError { throw coordinatorError }
        if let copyError { throw copyError }
        return destination
    }

    /// Runs `zip(folder:)` off the main thread.
    static func zipInBackground(folder: URL) async throws -> URL {
        try await Task.detached(priority: .userInitiated) {
            try Zipper.zip(folder: folder)
        }.value
    }
}
