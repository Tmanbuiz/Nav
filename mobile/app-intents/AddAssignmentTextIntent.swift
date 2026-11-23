import AppIntents
internal import ExpoAppIntents

/// Saves a church assignment text for ChurchRide without opening the app. Made for a
/// Shortcuts Message automation, so it also works while the phone is locked. The text waits in
/// the package's queue and the app imports it into the Inbox, for review, when it next runs.
/// Dispatch name and params must match src/services/intents.ts.
struct AddAssignmentTextIntent: AppIntent {
  static let title: LocalizedStringResource = "Add Assignment Text"
  static let openAppWhenRun: Bool = false

  @Parameter(title: "Text")
  var text: String

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return .result(dialog: "There was no text to save.")
    }
    await AppIntentDispatcher.shared.dispatch(
      name: "addAssignmentText",
      params: ["text": .string(String(trimmed.prefix(20_000)))]
    )
    return .result(dialog: "Saved for ChurchRide. It will be in your Inbox when you open the app.")
  }
}
