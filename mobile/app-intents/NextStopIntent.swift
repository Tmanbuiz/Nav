import AppIntents
internal import ExpoAppIntents

/// "Next stop in ChurchRide": says where to go next, read from the published run, so it
/// works without opening the app.
struct NextStopIntent: AppIntent {
  static let title: LocalizedStringResource = "Next Stop"
  static let openAppWhenRun: Bool = false

  @MainActor
  func perform() async throws -> some IntentResult & ProvidesDialog {
    let records = try await ChurchRideStops.records()
    let today = ChurchRideStops.today()
    let pending = ChurchRideStops.pending(from: records).filter { $0.date >= today }

    guard let next = pending.first else {
      let doneToday = records.contains { ($0.metadata["date"] ?? "") == today }
      let message = doneToday
        ? "That's everyone. There are no stops left today."
        : "There are no approved rides in ChurchRide for today."
      return .result(dialog: "\(message)")
    }

    if next.date > today {
      let when = next.dateSpoken.isEmpty ? next.date : next.dateSpoken
      return .result(dialog: "Your next rides are on \(when). First stop: \(ChurchRideStops.describe(next)).")
    }

    let kind = next.isPickup ? "pickup" : "drop-off"
    let remaining = pending.filter { $0.date == today }.count - 1
    let after = remaining == 0 ? "It's the last stop." : "\(remaining) more after that."
    return .result(dialog: "Next \(kind): \(ChurchRideStops.describe(next)). \(after)")
  }
}
