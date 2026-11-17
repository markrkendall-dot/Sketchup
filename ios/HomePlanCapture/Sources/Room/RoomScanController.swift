import ARKit
import RoomPlan
import SwiftUI
import UIKit

/// Drives one room scan: RoomPlan on our own ARSession, keyframes and LiDAR mesh collected
/// alongside, then the bundle written to Documents/<name>-room/.
///
/// How the mesh is collected. RoomPlan configures and runs the ARSession itself when
/// `captureSession.run(configuration:)` is called, and RoomCaptureSession.Configuration has no
/// scene reconstruction switch. So once RoomPlan has configured the session we look at
/// `arSession.configuration`: if scene reconstruction is already on we just read the mesh
/// anchors; if not, we re-run the session with a copy of RoomPlan's own configuration plus
/// `.mesh`, without resetting tracking. Apple does not document that RoomPlan tolerates this, so
/// it is behind the "Colour mesh" switch on the home screen, and the outcome is written to
/// capture-log.txt. Frames and anchors are read by polling `arSession.currentFrame` rather than
/// by becoming the ARSession's delegate, which RoomPlan may rely on itself.
@MainActor
final class RoomScanController: ObservableObject {
    enum Phase: Equatable {
        case starting
        case scanning
        case processing(String)
        case done(URL)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var keyframeCount = 0
    @Published private(set) var meshAnchorCount = 0

    let name: String
    let collectMesh: Bool
    let arSession = ARSession()

    private weak var captureView: RoomCaptureView?
    private var bundleURL: URL?
    private var keyframes: KeyframeRecorder?
    private let mesh = MeshCollector()
    private var timer: Timer?
    private var tick = 0
    private var meshCheckDone = false
    private var cancelled = false
    private var log: [String] = []

    // nonisolated so SwiftUI's StateObject can build it from a View initialiser.
    nonisolated init(name: String, collectMesh: Bool) {
        self.name = name
        self.collectMesh = collectMesh
    }

    func attach(_ view: RoomCaptureView) {
        captureView = view
    }

    func start() {
        guard phase == .starting, let view = captureView else { return }
        do {
            let folder = try Paths.newBundleFolder(name: name, kind: .room)
            bundleURL = folder
            keyframes = try KeyframeRecorder(framesDir: folder.appendingPathComponent("frames", isDirectory: true))
        } catch {
            phase = .failed("Could not create the scan folder: \(error.localizedDescription)")
            return
        }
        log.append("Scan \"\(name)\" started \(ISO8601DateFormatter().string(from: Date()))")
        log.append("Colour mesh switch: \(collectMesh ? "on" : "off")")

        var configuration = RoomCaptureSession.Configuration()
        configuration.isCoachingEnabled = true
        view.captureSession.run(configuration: configuration)
        phase = .scanning
        UIApplication.shared.isIdleTimerDisabled = true

        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let controller = self else { return }
            Task { @MainActor in controller.poll() }
        }
    }

    /// The Done button.
    func finish() {
        guard phase == .scanning else { return }
        if let frame = arSession.currentFrame { mesh.update(from: frame) }
        stopTimer()
        phase = .processing("Finishing the scan")
        // RoomPlan then calls RoomCaptureHostController.captureView(shouldPresent:error:),
        // which hands the data to captureEnded(data:error:).
        captureView?.captureSession.stop()
    }

    func cancel() {
        guard !cancelled else { return }
        cancelled = true
        stopTimer()
        if phase == .scanning || phase == .starting {
            captureView?.captureSession.stop()
            if let bundleURL { try? FileManager.default.removeItem(at: bundleURL) }
        }
        UIApplication.shared.isIdleTimerDisabled = false
    }

    /// Called when RoomPlan ends the session, after Done or on its own (for example a tracking failure).
    func captureEnded(data: CapturedRoomData, error: Error?) {
        guard !cancelled else { return }
        stopTimer()
        if let error { log.append("RoomPlan ended with: \(error.localizedDescription)") }
        Task { await process(data) }
    }

    private func poll() {
        guard phase == .scanning, let frame = arSession.currentFrame else { return }
        tick += 1
        keyframes?.consider(frame)
        if tick % 10 == 0 {
            mesh.update(from: frame)
            meshAnchorCount = mesh.anchorCount
            keyframeCount = keyframes?.count ?? 0
            if collectMesh && !meshCheckDone { ensureSceneReconstruction() }
        }
    }

    private func ensureSceneReconstruction() {
        guard let current = arSession.configuration else { return } // RoomPlan has not configured it yet
        meshCheckDone = true
        guard let world = current as? ARWorldTrackingConfiguration else {
            log.append("RoomPlan runs \(type(of: current)), not world tracking; no mesh added")
            return
        }
        if !world.sceneReconstruction.isEmpty {
            log.append("RoomPlan's session already has scene reconstruction (raw \(world.sceneReconstruction.rawValue))")
            return
        }
        guard ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) else {
            log.append("This device does not support scene reconstruction")
            return
        }
        guard let copy = world.copy() as? ARWorldTrackingConfiguration else { return }
        copy.sceneReconstruction = .mesh
        // No reset options: tracking, the world origin and RoomPlan's progress are kept.
        // VERIFY (runtime, not compile): that RoomPlan keeps scanning normally after this.
        arSession.run(copy, options: [])
        log.append("Added .mesh scene reconstruction to RoomPlan's ARSession configuration")
    }

    private func process(_ data: CapturedRoomData) async {
        guard let folder = bundleURL else { return }
        do {
            phase = .processing("Building the room model")
            let room = try await RoomBuilder(options: [.beautifyObjects]).capturedRoom(from: data)

            phase = .processing("Saving room files")
            log += try RoomBundleWriter.writeRoom(room, to: folder)

            let frames = await keyframes?.finish() ?? []
            log += try RoomBundleWriter.writeFrames(frames, to: folder)

            let anchors = mesh.snapshot()
            if anchors.isEmpty {
                log.append("No ARMeshAnchors were seen, so mesh.ply was not written")
            } else {
                phase = .processing("Colouring the mesh from \(frames.count) photos")
                do {
                    log += try await Task.detached(priority: .userInitiated) {
                        try RoomBundleWriter.writeMesh(anchors: anchors, keyframes: frames, to: folder)
                    }.value
                } catch {
                    log.append("mesh.ply failed: \(error.localizedDescription)")
                }
            }

            try BundleWriter.writeMeta(kind: .room, name: name, to: folder)
            log.append("Finished \(ISO8601DateFormatter().string(from: Date()))")
            BundleWriter.writeLog(log, to: folder)
            phase = .done(folder)
        } catch {
            log.append("Failed: \(error.localizedDescription)")
            BundleWriter.writeLog(log, to: folder)
            phase = .failed(error.localizedDescription)
        }
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }
}
