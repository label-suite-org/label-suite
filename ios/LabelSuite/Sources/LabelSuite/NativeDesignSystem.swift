import SwiftUI

/// Centralized copy and semantic color tokens keep the native slice ready for localization and theme review.
public enum NativeCopy {
  public static let today = "Today"
  public static let campaigns = "Campaigns"
  public static let refresh = "Refresh"
  public static let retry = "Retry"
  public static let offlineSnapshot = "Offline · cached snapshot"
  public static let cachedSnapshot = "Cached Snapshot"
  public static let noActionableWork = "No actionable work right now."
  public static let readOnlyContext = "Read-only context"
  public static let operatorContext = "Operator context"
}

public enum NativeDesignSystem {
  /// Deep Fjord is used as the semantic accent; system foreground/background colors remain adaptive.
  public static let deepFjord = Color(red: 0.04, green: 0.34, blue: 0.36)
}
