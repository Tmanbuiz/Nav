import AppIntents
internal import ExpoAppIntents

/// "Picked up in ChurchRide" / "Dropped off in ChurchRide": marks today's current stop done
/// without opening the app. Siri remembers it at once, so "Next stop" moves on; the app applies
/// it to its own list when it next runs. Dispatch name and params must match
/// src/services/intents.ts.
struct MarkStopDoneIntent: AppIntent {
  static let title: LocalizedStringResource = "Mark Current Stop Done"
  static let openAppWhenRun: Bool = false

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let records = try await ChurchRideStops.records()
    let today = ChurchRideStops.today()
    let pending = ChurchRideStops.pending(from: records).filter { $0.date == today }

    guard let current = pending.first else {
      return .result(dialog: "There's no stop waiting today.")
    }

    await AppIntentDispatcher.shared.dispatch(
      name: "setTripStatus",
      params: [
        "assignmentId": .string(current.assignmentId),
        "leg": .string(current.leg),
        "status": .string("done"),
      ]
    )
    ChurchRideStops.markCompleted(current.id)

    let verb = current.isPickup ? "picked up" : "dropped off"
    if let next = pending.dropFirst().first {
      return .result(dialog: "Noted: \(current.name) \(verb). Next: \(ChurchRideStops.describe(next)).")
    }
    return .result(dialog: "Noted: \(current.name) \(verb). That was the last stop.")
  }
}
