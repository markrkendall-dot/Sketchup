import Foundation

enum DeviceInfo {
    /// Hardware identifier such as "iPhone16,1" (iPhone 15 Pro).
    static var model: String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }

    /// For example "iOS 17.5.1". Uses ProcessInfo so it is safe off the main thread.
    static var os: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "iOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }

    /// For example "HomePlanCapture 1.0 (1)".
    static var app: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        return "HomePlanCapture \(version) (\(build))"
    }
}
