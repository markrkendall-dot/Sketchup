import RealityKit
import SwiftUI

/// Full screen object scan: guided capture, detail choice, reconstruction progress, share.
struct ObjectScanView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ObjectScanModel
    @State private var share: ShareItem?
    @State private var zipping = false
    @State private var zipError: String?

    init(name: String) {
        _model = StateObject(wrappedValue: ObjectScanModel(name: name))
    }

    var body: some View {
        // The ZStack keeps one identity while the phase changes, so onDisappear fires only
        // when the whole screen goes away.
        ZStack { content }
            .onAppear { model.start() }
            .onDisappear { model.cancel() }
            .sheet(item: $share) { item in
                ShareSheet(items: [item.url])
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .capturing:
            if let session = model.session {
                ObjectCaptureScreen(session: session) {
                    model.cancel()
                    dismiss()
                }
            } else {
                ProgressView("Starting the camera")
            }

        case .chooseDetail:
            VStack(spacing: 20) {
                Text("Photos taken").font(.title2)
                Picker("Detail", selection: $model.detail) {
                    ForEach(ObjectScanModel.Detail.allCases) { detail in
                        Text(detail.title).tag(detail)
                    }
                }
                .pickerStyle(.inline)
                Button("Build model") {
                    Task { await model.reconstruct() }
                }
                .buttonStyle(.borderedProminent)
                Button("Discard", role: .destructive) {
                    model.cancel()
                    dismiss()
                }
            }
            .padding()

        case .reconstructing(let fraction):
            VStack(spacing: 16) {
                ProgressView(value: fraction)
                Text("Building the model, \(Int(fraction * 100)) percent")
                Text("Keep the app open and the phone awake. This can take several minutes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                if let note = model.note { Text(note).font(.caption) }
            }
            .padding(32)

        case .done(let folder):
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(.green)
                Text("Saved \(folder.lastPathComponent)")
                if let note = model.note { Text(note).font(.caption) }
                if zipping {
                    ProgressView("Zipping")
                } else {
                    Button("Share zip") { shareZip(folder) }
                        .buttonStyle(.borderedProminent)
                }
                if let zipError { Text(zipError).font(.caption).foregroundStyle(.red) }
                Button("Close") { dismiss() }
            }
            .padding()

        case .failed(let message):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
                Text("Object scan failed")
                Text(message).font(.caption).multilineTextAlignment(.center)
                Button("Close") { dismiss() }
            }
            .padding()
        }
    }

    @MainActor
    private func shareZip(_ folder: URL) {
        zipping = true
        zipError = nil
        Task { @MainActor in
            do {
                share = ShareItem(url: try await Zipper.zipInBackground(folder: folder))
            } catch {
                zipError = error.localizedDescription
            }
            zipping = false
        }
    }
}

/// Apple's guided capture view plus the buttons that move the session through its states:
/// ready, detecting (place the box), capturing (walk around), then another pass or finish.
private struct ObjectCaptureScreen: View {
    // VERIFY: ObjectCaptureSession is an ObservableObject in iOS 17 (Apple's GuidedCapture
    // sample observes it this way).
    @ObservedObject var session: ObjectCaptureSession
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            ObjectCaptureView(session: session)
                .ignoresSafeArea()
            VStack {
                HStack {
                    Button("Cancel", action: onCancel)
                    Spacer()
                    // VERIFY: numberOfShotsTaken is the iOS 17 photo counter.
                    Text("\(session.numberOfShotsTaken) photos")
                        .font(.caption)
                        .monospacedDigit()
                }
                .padding()
                .background(.ultraThinMaterial)
                Spacer()
                controls
                    .padding(.bottom, 24)
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        switch session.state {
        case .ready:
            VStack {
                Text("Point at the object")
                Button("Continue") { _ = session.startDetecting() }
                    .buttonStyle(.borderedProminent)
            }
        case .detecting:
            VStack {
                Text("Adjust the box to fit the object")
                HStack {
                    Button("Reset box") { session.resetDetection() }
                        .buttonStyle(.bordered)
                    Button("Start capture") { session.startCapturing() }
                        .buttonStyle(.borderedProminent)
                }
            }
        case .capturing:
            if session.userCompletedScanPass {
                VStack(spacing: 8) {
                    Text("Pass complete")
                    Button("Another pass, higher or lower") { session.beginNewScanPass() }
                        .buttonStyle(.bordered)
                    Button("Flip the object, new pass") { session.beginNewScanPassAfterFlip() }
                        .buttonStyle(.bordered)
                    Button("Finish") { session.finish() }
                        .buttonStyle(.borderedProminent)
                }
                .padding()
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            } else {
                Button("Finish now") { session.finish() }
                    .buttonStyle(.bordered)
            }
        case .finishing:
            ProgressView("Finishing")
        default:
            EmptyView()
        }
    }
}
