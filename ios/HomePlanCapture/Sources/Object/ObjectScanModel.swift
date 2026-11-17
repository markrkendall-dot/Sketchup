import Foundation
import RealityKit
import SwiftUI
import UIKit

/// One object scan: guided Object Capture, then on-device reconstruction to object.usdz in
/// Documents/<name>-object/. The capture photos live in Caches and are deleted afterwards.
@MainActor
final class ObjectScanModel: ObservableObject {
    enum Phase: Equatable {
        case capturing
        case chooseDetail
        case reconstructing(Double)
        case done(URL)
        case failed(String)
    }

    enum Detail: String, CaseIterable, Identifiable {
        case reduced
        case medium

        var id: String { rawValue }
        var title: String { self == .reduced ? "Reduced (smaller, faster)" : "Medium (more detail)" }
        var request: PhotogrammetrySession.Request.Detail { self == .reduced ? .reduced : .medium }
    }

    @Published private(set) var phase: Phase = .capturing
    @Published private(set) var session: ObjectCaptureSession?
    @Published var detail: Detail = .reduced
    @Published private(set) var note: String?

    let name: String
    private let workURL: URL
    private var imagesURL: URL { workURL.appendingPathComponent("Images", isDirectory: true) }
    private var checkpointURL: URL { workURL.appendingPathComponent("Checkpoint", isDirectory: true) }
    private var stateTask: Task<Void, Never>?
    private var cancelled = false

    nonisolated init(name: String) {
        self.name = name
        workURL = Paths.caches.appendingPathComponent("ObjectCapture-\(UUID().uuidString)", isDirectory: true)
    }

    func start() {
        guard session == nil, phase == .capturing, !cancelled else { return }
        do {
            try FileManager.default.createDirectory(at: imagesURL, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: checkpointURL, withIntermediateDirectories: true)
        } catch {
            phase = .failed("Could not create a work folder: \(error.localizedDescription)")
            return
        }

        let newSession = ObjectCaptureSession()
        var configuration = ObjectCaptureSession.Configuration()
        configuration.checkpointDirectory = checkpointURL
        // VERIFY: start(imagesDirectory:configuration:) is not marked throws in iOS 17.
        newSession.start(imagesDirectory: imagesURL, configuration: configuration)
        session = newSession
        UIApplication.shared.isIdleTimerDisabled = true

        stateTask = Task { @MainActor [weak self] in
            for await state in newSession.stateUpdates {
                guard let self else { return }
                switch state {
                case .completed:
                    // On iOS the capture session must be released before reconstruction starts.
                    self.session = nil
                    self.phase = .chooseDetail
                    return
                case .failed(let error):
                    self.session = nil
                    if !self.cancelled { self.phase = .failed(error.localizedDescription) }
                    return
                default:
                    break
                }
            }
        }
    }

    func cancel() {
        guard !cancelled else { return }
        cancelled = true
        session?.cancel()
        session = nil
        stateTask?.cancel()
        UIApplication.shared.isIdleTimerDisabled = false
        if case .done = phase {} else {
            try? FileManager.default.removeItem(at: workURL)
        }
    }

    func reconstruct() async {
        guard phase == .chooseDetail else { return }
        phase = .reconstructing(0)
        UIApplication.shared.isIdleTimerDisabled = true
        // Give SwiftUI a moment to tear down ObjectCaptureView so the session is really freed.
        try? await Task.sleep(nanoseconds: 300_000_000)

        let folder: URL
        do {
            folder = try Paths.newBundleFolder(name: name, kind: .object)
        } catch {
            phase = .failed("Could not create the scan folder: \(error.localizedDescription)")
            return
        }
        let output = folder.appendingPathComponent("object.usdz")

        do {
            do {
                try await runPhotogrammetry(detail: detail.request, output: output)
            } catch where detail != .reduced && !cancelled {
                // VERIFY: on-device reconstruction may support only .reduced on some devices
                // or iOS versions; fall back rather than fail.
                note = "Medium detail failed (\(error.localizedDescription)); built at Reduced instead."
                try? FileManager.default.removeItem(at: output)
                phase = .reconstructing(0)
                try await runPhotogrammetry(detail: .reduced, output: output)
            }

            // Bounding box of the finished model.
            // VERIFY: Entity.load(contentsOf:withName:) is the iOS 17 synchronous loader.
            let entity = try Entity.load(contentsOf: output)
            let box = entity.visualBounds(relativeTo: nil)
            try BundleWriter.writeMeta(kind: .object, name: name, to: folder, bounds: (min: box.min, max: box.max))
            if let note { BundleWriter.writeLog([note], to: folder) }
            try? FileManager.default.removeItem(at: workURL)
            phase = .done(folder)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            if !cancelled { phase = .failed(error.localizedDescription) }
        }
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func runPhotogrammetry(detail: PhotogrammetrySession.Request.Detail, output: URL) async throws {
        var configuration = PhotogrammetrySession.Configuration()
        configuration.checkpointDirectory = checkpointURL
        let photogrammetry = try PhotogrammetrySession(input: imagesURL, configuration: configuration)
        try photogrammetry.process(requests: [.modelFile(url: output, detail: detail)])

        for try await message in photogrammetry.outputs {
            if cancelled {
                photogrammetry.cancel()
                throw CancellationError()
            }
            switch message {
            case .requestProgress(_, let fractionComplete):
                phase = .reconstructing(fractionComplete)
            case .requestError(_, let error):
                throw error
            case .processingCancelled:
                throw CancellationError()
            case .processingComplete:
                return
            default:
                break
            }
        }
    }
}
