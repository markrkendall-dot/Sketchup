import RealityKit
import RoomPlan
import SwiftUI

struct HomeView: View {
    enum ActiveScan: Identifiable {
        case room(String)
        case object(String)

        var id: String {
            switch self {
            case .room(let name): return "room-" + name
            case .object(let name): return "object-" + name
            }
        }
    }

    @EnvironmentObject private var store: BundleStore
    @AppStorage("scanName") private var name = ""
    @AppStorage("collectMesh") private var collectMesh = true
    @State private var activeScan: ActiveScan?
    @State private var share: ShareItem?
    @State private var zipping: URL?
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Name, for example kitchen", text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        startRoom()
                    } label: {
                        Label("Scan room", systemImage: "cube.transparent")
                    }
                    Button {
                        startObject()
                    } label: {
                        Label("Scan object", systemImage: "cube")
                    }
                } header: {
                    Text("New scan")
                }

                Section {
                    Toggle("Colour mesh with room scans", isOn: $collectMesh)
                } footer: {
                    Text("Also records the LiDAR mesh (mesh.ply). Turn off if room scans misbehave.")
                }

                Section {
                    if store.bundles.isEmpty {
                        Text("No scans yet").foregroundStyle(.secondary)
                    }
                    ForEach(store.bundles) { bundle in
                        row(bundle)
                    }
                    .onDelete { offsets in
                        let doomed = offsets.map { store.bundles[$0] }
                        doomed.forEach { store.delete($0) }
                    }
                } header: {
                    Text("Saved scans")
                } footer: {
                    Text("Swipe left to delete. Scans are also in the Files app, On My iPhone, HomePlanCapture.")
                }
            }
            .navigationTitle("HomePlan Capture")
            .onAppear { store.refresh() }
            .refreshable { store.refresh() }
        }
        .fullScreenCover(item: $activeScan, onDismiss: { store.refresh() }) { scan in
            switch scan {
            case .room(let scanName):
                RoomScanView(name: scanName, collectMesh: collectMesh)
            case .object(let scanName):
                ObjectScanView(name: scanName)
            }
        }
        .sheet(item: $share) { item in
            ShareSheet(items: [item.url])
        }
        .alert(
            "HomePlan Capture",
            isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    private func row(_ bundle: ScanBundle) -> some View {
        HStack {
            Image(systemName: bundle.kind == .room ? "cube.transparent" : "cube")
                .foregroundStyle(.secondary)
            VStack(alignment: .leading) {
                Text(bundle.name)
                Text("\(bundle.date.formatted(date: .abbreviated, time: .shortened)), \(ByteCountFormatter.string(fromByteCount: bundle.bytes, countStyle: .file))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if zipping == bundle.url {
                ProgressView()
            } else {
                Button {
                    shareBundle(bundle)
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .buttonStyle(.borderless)
            }
        }
    }

    private var trimmedName: String {
        let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "scan" : t
    }

    private func startRoom() {
        guard RoomCaptureSession.isSupported else {
            message = "Room scanning needs an iPhone or iPad with LiDAR."
            return
        }
        activeScan = .room(trimmedName)
    }

    private func startObject() {
        guard ObjectCaptureSession.isSupported else {
            message = "Object scanning needs an iPhone or iPad with LiDAR running iOS 17 or later."
            return
        }
        activeScan = .object(trimmedName)
    }

    private func shareBundle(_ bundle: ScanBundle) {
        zipping = bundle.url
        Task { @MainActor in
            do {
                let zip = try await Zipper.zipInBackground(folder: bundle.url)
                share = ShareItem(url: zip)
            } catch {
                message = "Could not zip \(bundle.name): \(error.localizedDescription)"
            }
            zipping = nil
        }
    }
}
