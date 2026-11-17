import SwiftUI

@main
struct HomePlanCaptureApp: App {
    @StateObject private var store = BundleStore()

    var body: some Scene {
        WindowGroup {
            HomeView()
                .environmentObject(store)
        }
    }
}
