import AppIntents

/// All App Shortcuts for this app. Phrases are compiled into the app and cannot be created
/// at runtime. Required parameters that are not in the launch phrase are collected by Siri
/// as follow-up questions.
///
/// System rules:
/// - Every phrase must include \(.applicationName) or the phrase is dropped at build time.
/// - At most 10 App Shortcuts per app. Apple recommends 2-5.
///
/// AddAssignmentTextIntent has no phrase on purpose: it is used from a Shortcuts automation.
struct AppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: NextStopIntent(),
      phrases: [
        "Next stop in \(.applicationName)",
        "What's my next stop in \(.applicationName)",
        "\(.applicationName) next stop"
      ],
      shortTitle: "Next Stop",
      systemImageName: "car.fill"
    )
    AppShortcut(
      intent: MarkStopDoneIntent(),
      phrases: [
        "Picked up in \(.applicationName)",
        "Dropped off in \(.applicationName)",
        "\(.applicationName) picked up",
        "Mark this stop done in \(.applicationName)"
      ],
      shortTitle: "Stop Done",
      systemImageName: "checkmark.circle.fill"
    )
  }
}
