// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "LabelSuite",
  platforms: [.iOS("26.0"), .macOS(.v14)],
  products: [.library(name: "LabelSuite", targets: ["LabelSuite"]), .executable(name: "LabelSuiteApp", targets: ["LabelSuiteApp"])],
  targets: [
    .target(name: "LabelSuite"),
    .executableTarget(name: "LabelSuiteApp", dependencies: ["LabelSuite"]),
    .testTarget(name: "LabelSuiteTests", dependencies: ["LabelSuite"], resources: [.process("Fixtures")]),
  ]
)
