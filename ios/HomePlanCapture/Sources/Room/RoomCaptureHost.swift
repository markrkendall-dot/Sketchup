import ARKit
import RoomPlan
import SwiftUI
import UIKit

/// Puts RoomPlan's RoomCaptureView (its live scanning UI and coaching) into SwiftUI.
struct RoomCaptureHost: UIViewControllerRepresentable {
    let controller: RoomScanController

    func makeUIViewController(context: Context) -> RoomCaptureHostController {
        RoomCaptureHostController(controller: controller)
    }

    func updateUIViewController(_ viewController: RoomCaptureHostController, context: Context) {}
}

/// RoomCaptureViewDelegate inherits NSCoding, which UIViewController already provides, so the
/// view controller is the delegate.
final class RoomCaptureHostController: UIViewController, RoomCaptureViewDelegate {
    private let controller: RoomScanController

    init(controller: RoomScanController) {
        self.controller = controller
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("RoomCaptureHostController is not loaded from a storyboard")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // iOS 17: RoomPlan runs on an ARSession we own, so we can read its frames and anchors.
        // VERIFY: RoomCaptureView(frame:arSession:) is the iOS 17 initialiser.
        let captureView = RoomCaptureView(frame: view.bounds, arSession: controller.arSession)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        view.addSubview(captureView)
        controller.attach(captureView)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        controller.start()
    }

    // We build the final room ourselves with RoomBuilder, so RoomCaptureView does not need to
    // process and show its own result: return false.
    // VERIFY: delegate signatures as in iOS 16/17 RoomPlan; nonisolated so they compile whether
    // or not the SDK marks the protocol @MainActor.
    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        Task { @MainActor in
            self.controller.captureEnded(data: roomDataForProcessing, error: error)
        }
        return false
    }

    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {}
}
