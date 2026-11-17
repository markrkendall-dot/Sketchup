import SwiftUI

/// Full screen room scan: RoomPlan's camera view with Cancel and Done, then progress and a
/// share button for the finished bundle.
struct RoomScanView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var controller: RoomScanController
    @State private var share: ShareItem?
    @State private var zipping = false
    @State private var zipError: String?

    init(name: String, collectMesh: Bool) {
        _controller = StateObject(wrappedValue: RoomScanController(name: name, collectMesh: collectMesh))
    }

    var body: some View {
        ZStack {
            RoomCaptureHost(controller: controller)
                .ignoresSafeArea()

            VStack {
                topBar
                Spacer()
                if controller.phase == .scanning {
                    Button {
                        controller.finish()
                    } label: {
                        Text("Done").frame(minWidth: 160)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding(.bottom, 24)
                }
            }

            overlay
        }
        .sheet(item: $share) { item in
            ShareSheet(items: [item.url])
        }
        .onDisappear {
            controller.cancel()
        }
    }

    private var topBar: some View {
        HStack {
            if controller.phase == .scanning || controller.phase == .starting {
                Button("Cancel") {
                    controller.cancel()
                    dismiss()
                }
            }
            Spacer()
            Text("\(controller.keyframeCount) photos, \(controller.meshAnchorCount) mesh pieces")
                .font(.caption)
                .monospacedDigit()
        }
        .padding()
        .background(.ultraThinMaterial)
    }

    @ViewBuilder
    private var overlay: some View {
        switch controller.phase {
        case .starting, .scanning:
            EmptyView()
        case .processing(let message):
            card {
                ProgressView()
                Text(message)
                Text("Keep the app open.").font(.caption).foregroundStyle(.secondary)
            }
        case .done(let folder):
            card {
                Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(.green)
                Text("Saved \(folder.lastPathComponent)")
                if zipping {
                    ProgressView("Zipping")
                } else {
                    Button("Share zip") { shareZip(folder) }
                        .buttonStyle(.borderedProminent)
                }
                if let zipError { Text(zipError).font(.caption).foregroundStyle(.red) }
                Button("Close") { dismiss() }
            }
        case .failed(let message):
            card {
                Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.orange)
                Text("Scan failed")
                Text(message).font(.caption).multilineTextAlignment(.center)
                Button("Close") { dismiss() }
            }
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ZStack {
            Color.black.opacity(0.4).ignoresSafeArea()
            VStack(spacing: 16) {
                content()
            }
            .padding(24)
            .frame(maxWidth: 320)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
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
