import Foundation
internal import ExpoAppIntents

/// The day's run as ChurchRide publishes it to the "stop" catalog (see src/core/siri.ts),
/// read natively so Siri can answer while the app is closed. Keep the metadata keys in step
/// with that file.
enum ChurchRideStops {
  static let kind = "stop"

  /// Stops marked done through Siri, by stop ID, with when they were marked. The app applies
  /// them to its own data the next time it runs; until then they count as done here.
  private static let completedKey = "churchride.siri.completedStops"

  struct Stop {
    let id: String
    let assignmentId: String
    let leg: String
    let order: Int
    let name: String
    let address: String
    let window: String
    let date: String
    let dateSpoken: String

    var isPickup: Bool { leg == "to-church" }
  }

  /// Everything in the catalog, done or not.
  static func records() async throws -> [AppIntentEntityRecord] {
    try await AppIntentEntityStore.shared.entities(ofKind: kind)
  }

  /// Stops still to do, in driving order: pickups first, then drop-offs.
  static func pending(from records: [AppIntentEntityRecord]) -> [Stop] {
    let completed = completedOverrides()
    let stops: [Stop] = records.compactMap { record in
      let meta = record.metadata
      guard meta["status"] == "pending" else { return nil }
      // A change made in the app after Siri marked the stop wins over the Siri mark.
      let changedInApp = Double(meta["statusUpdatedAt"] ?? "") ?? 0
      if let markedAt = completed[record.id], markedAt > changedInApp { return nil }
      return Stop(
        id: record.id,
        assignmentId: meta["assignmentId"] ?? "",
        leg: meta["leg"] ?? "to-church",
        order: Int(meta["order"] ?? "") ?? Int.max,
        name: record.title,
        address: meta["address"] ?? record.subtitle ?? "",
        window: meta["windowSpoken"] ?? "",
        date: meta["date"] ?? "",
        dateSpoken: meta["dateSpoken"] ?? ""
      )
    }
    return stops.sorted { a, b in
      let aRank = a.isPickup ? 0 : 1
      let bRank = b.isPickup ? 0 : 1
      return aRank != bRank ? aRank < bRank : a.order < b.order
    }
  }

  static func markCompleted(_ id: String) {
    var map = completedOverrides()
    map[id] = Date().timeIntervalSince1970
    if map.count > 200 {
      let newest = map.sorted { $0.value > $1.value }.prefix(200)
      map = Dictionary(uniqueKeysWithValues: newest.map { ($0.key, $0.value) })
    }
    UserDefaults.standard.set(map, forKey: completedKey)
  }

  /// Today's date as the app writes it, "2026-11-29".
  static func today() -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone.current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: Date())
  }

  /// "Jane Example, 100 Example Street, between 9:30 and 9:45 AM"
  static func describe(_ stop: Stop) -> String {
    var parts = [stop.name]
    if !stop.address.isEmpty { parts.append(stop.address) }
    if stop.isPickup && !stop.window.isEmpty { parts.append(stop.window) }
    return parts.joined(separator: ", ")
  }

  private static func completedOverrides() -> [String: Double] {
    UserDefaults.standard.dictionary(forKey: completedKey) as? [String: Double] ?? [:]
  }
}
