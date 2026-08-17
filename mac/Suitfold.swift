import AppKit
import Combine
import CoreImage.CIFilterBuiltins
import Foundation
import IOKit.pwr_mgt
import SwiftUI

// suitfold, holding a table.
//
// The window is small on purpose. It shows a code, a link, and who is sitting
// down. The game itself is played in a browser, here and everywhere else - this
// is only the thing that holds the deck, and its whole reason to exist is that
// it is not a browser tab. It does not close because somebody hit the wrong
// button, it does not get throttled for being in the background, and it stops
// the Mac dropping off to sleep in the middle of a hand.

let port = 8123

// MARK: - the table process

/// The deck, in a process of its own.
@MainActor
final class Table: ObservableObject {
    @Published var running = false
    @Published var code = ""
    @Published var players: [Player] = []
    @Published var game = ""
    @Published var trouble: String?

    private var task: Process?
    private var sleepless: IOPMAssertionID = 0
    private var poll: Timer?

    struct Player: Identifiable, Decodable {
        var name: String
        var emoji: String
        var here: Bool
        var id: String { emoji + name }
    }

    /// The address other people on this network use to reach us.
    var lanAddress: String {
        "ws://\(Self.lanIP() ?? "localhost"):\(port)"
    }

    /// The app serves the front end itself, so the page and the table are always
    /// the same build and there is nothing to keep in step. It also means this
    /// works with the internet unplugged.
    var joinLink: String {
        let host = Self.lanIP() ?? "localhost"
        return "http://\(host):\(port)/?table=ws://\(host):\(port)#\(code)"
    }

    func start() {
        guard task == nil else { return }
        code = Self.freshCode()

        guard let binary = Bundle.main.url(forResource: "suitfold-table", withExtension: nil) else {
            trouble = "The table server is missing from the app bundle."
            return
        }

        let p = Process()
        p.executableURL = binary
        let web = Bundle.main.url(forResource: "web", withExtension: nil)?.path ?? ""
        p.environment = ProcessInfo.processInfo.environment.merging([
            "PORT": String(port),
            "SUITFOLD_WEB": web,
        ]) { _, new in new }
        p.terminationHandler = { [weak self] _ in
            Task { @MainActor in self?.stopped() }
        }
        do {
            try p.run()
        } catch {
            trouble = "Could not start the table: \(error.localizedDescription)"
            return
        }
        task = p
        running = true
        trouble = nil
        keepAwake(true)
        watch()
    }

    func stop() {
        task?.terminate()
        task = nil
        stopped()
    }

    private func stopped() {
        running = false
        players = []
        poll?.invalidate()
        poll = nil
        keepAwake(false)
    }

    /// Ask the table who is there. Cheap, and it is the only way the window
    /// knows anything - the app deliberately understands nothing about the game.
    private func watch() {
        poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
    }

    private func refresh() async {
        struct Health: Decodable {
            struct Table: Decodable {
                var code: String
                var players: Int
                var seats: [Player]
                var game: String
            }
            var tables: [Table]
        }
        guard let url = URL(string: "http://127.0.0.1:\(port)/health") else { return }
        guard let (data, _) = try? await URLSession.shared.data(from: url) else { return }
        guard let health = try? JSONDecoder().decode(Health.self, from: data) else { return }
        let mine = health.tables.first { $0.code == code }
        players = mine?.seats ?? []
        game = mine?.game ?? ""
    }

    /// A game should not end because the lid stayed open and the Mac got bored.
    private func keepAwake(_ on: Bool) {
        if on {
            IOPMAssertionCreateWithName(
                kIOPMAssertionTypeNoIdleSleep as CFString,
                IOPMAssertionLevel(kIOPMAssertionLevelOn),
                "suitfold is holding a table" as CFString,
                &sleepless
            )
        } else if sleepless != 0 {
            IOPMAssertionRelease(sleepless)
            sleepless = 0
        }
    }

    // MARK: - odds and ends

    /// Table codes get read aloud, so the alphabet drops anything that sounds
    /// or looks like something else. Same alphabet the web app uses.
    static func freshCode() -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<5).map { _ in alphabet.randomElement()! })
    }

    /// This Mac's address on the local network, so other people can reach it.
    static func lanIP() -> String? {
        var address: String?
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }

        for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let flags = Int32(ptr.pointee.ifa_flags)
            guard flags & IFF_UP == IFF_UP, flags & IFF_LOOPBACK == 0 else { continue }
            guard ptr.pointee.ifa_addr.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: ptr.pointee.ifa_name)
            // en0 is the wifi on every Mac that has ever shipped.
            guard name == "en0" || name == "en1" else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(
                ptr.pointee.ifa_addr,
                socklen_t(ptr.pointee.ifa_addr.pointee.sa_len),
                &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST
            )
            address = String(cString: host)
            break
        }
        return address
    }
}

// MARK: - the window

struct Board: View {
    @StateObject private var table = Table()
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 10) {
                Text("♠").font(.system(size: 20))
                Text("suitfold").font(.system(size: 20, weight: .medium, design: .serif))
                Spacer()
                if table.running {
                    Label(table.game.isEmpty ? "No game yet" : table.game, systemImage: "circle.fill")
                        .labelStyle(.titleAndIcon)
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }

            if table.running {
                VStack(alignment: .leading, spacing: 6) {
                    Text("TABLE CODE").font(.caption).foregroundStyle(.secondary)
                    Text(table.code)
                        .font(.system(size: 40, weight: .medium, design: .monospaced))
                        .tracking(6)
                }

                HStack(alignment: .top, spacing: 16) {
                    if let qr = qrCode(table.joinLink) {
                        Image(nsImage: qr).interpolation(.none).frame(width: 96, height: 96)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Anyone on this wifi can scan that, or use the link.")
                            .font(.caption).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button(copied ? "Copied" : "Copy the link") {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(table.joinLink, forType: .string)
                                copied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { copied = false }
                            }
                            Button("Sit down") {
                                if let url = URL(string: table.joinLink) { NSWorkspace.shared.open(url) }
                            }
                            .keyboardShortcut(.defaultAction)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("AT THE TABLE").font(.caption).foregroundStyle(.secondary)
                    if table.players.isEmpty {
                        Text("Nobody yet.").font(.callout).foregroundStyle(.secondary)
                    }
                    ForEach(table.players) { p in
                        HStack(spacing: 6) {
                            Text(p.emoji)
                            Text(p.name)
                            if !p.here {
                                Text("away").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Text("The table stays up while this app is open, even if everybody closes their browser. Your Mac will not go to sleep on its own.")
                    .font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Button("Close the table", role: .destructive) { table.stop() }
            } else {
                Text("Hold a table on this Mac. Everybody plays in a browser, but the deck lives here, so nobody's tab closing ends the game.")
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Open a table") { table.start() }
                    .keyboardShortcut(.defaultAction)
            }

            if let trouble = table.trouble {
                Text(trouble).font(.caption).foregroundStyle(.red)
            }
        }
        .padding(22)
        .frame(width: 420)
    }

    private func qrCode(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        guard let out = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        let rep = NSCIImageRep(ciImage: out)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}

@main
struct SuitfoldApp: App {
    var body: some Scene {
        Window("suitfold", id: "table") {
            Board()
        }
        .windowResizability(.contentSize)
    }
}
