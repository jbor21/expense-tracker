// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ExpenseKit",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "ExpenseKit", targets: ["Core", "Parsing", "Store", "Email"]),
    ],
    targets: [
        .target(name: "Core"),
        .target(
            name: "Parsing",
            dependencies: ["Core"],
            swiftSettings: [.enableUpcomingFeature("BareSlashRegexLiterals")]
        ),
        .target(name: "Store"),
        // Email + ingestion. Pure Foundation/URLSession — no Store/SwiftData and no
        // GoogleSignIn, so all networking + orchestration stays headlessly testable.
        .target(
            name: "Email",
            dependencies: ["Core", "Parsing"],
            swiftSettings: [.enableUpcomingFeature("BareSlashRegexLiterals")]
        ),
        .testTarget(name: "CoreTests", dependencies: ["Core"]),
        .testTarget(name: "ParsingTests", dependencies: ["Parsing", "Core"]),
        .testTarget(name: "StoreTests", dependencies: ["Store"]),
        .testTarget(name: "EmailTests", dependencies: ["Email", "Core", "Parsing"]),
    ]
)
