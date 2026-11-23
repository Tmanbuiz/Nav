internal import ExpoModulesCore
import Foundation
import Vision

/// Reads the text in a screenshot with Apple's Vision framework, on the phone. Nothing is uploaded.
/// JavaScript side: src/services/screenshot-text.ts.
final class ScreenshotText: Module {
  public func definition() -> ExpoModulesCore.ModuleDefinition {
    Name("ScreenshotText")

    // The image's text, one line per entry, top to bottom. No text gives an empty list.
    // Async functions run off the main thread, so reading a large picture doesn't freeze the app.
    AsyncFunction("readLinesAsync") { (url: URL) throws -> [String] in
      try ScreenshotText.readLines(at: url)
    }
  }

  static func readLines(at url: URL) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Keep names, numbers and addresses as they appear, instead of "correcting" them to dictionary words.
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(url: url, options: [:]).perform([request])

    // Vision measures from the bottom-left corner, so a larger y is higher on the screen.
    // Pieces at the same height form one line, read left to right.
    let pieces = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
    var lines: [[VNRecognizedTextObservation]] = []
    for piece in pieces {
      if let first = lines.last?.first,
        abs(first.boundingBox.midY - piece.boundingBox.midY) < first.boundingBox.height / 2
      {
        lines[lines.count - 1].append(piece)
      } else {
        lines.append([piece])
      }
    }

    return lines.compactMap { line in
      let text = line
        .sorted { $0.boundingBox.minX < $1.boundingBox.minX }
        .compactMap { $0.topCandidates(1).first?.string }
        .joined(separator: " ")
      return text.isEmpty ? nil : text
    }
  }
}
