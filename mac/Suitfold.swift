import AppKit
import Combine
import CoreImage.CIFilterBuiltins
import Foundation
import IOKit.pwr_mgt
import SwiftUI
import UserNotifications
import WebKit

// suitfold, on a Mac.
//
// This is the same table as the website, in a window of its own. Not a control
// panel beside a browser: the game is here, and the deck is held by a process
// this app owns, which is the whole reason it exists. A browser tab gets
// throttled the moment it goes to the back, gets closed by accident, and takes
// the game with it. This does none of that, and it keeps the Mac awake while a
// hand is in progress.
//
// Everything the page can do, it can still do. The extras are the ones only a
// real application gets: notifications when somebody says your name, a badge on
// the dock, a window that comes back where you left it, and a table that
// survives the front end being reloaded.

let port = 8123

// MARK: - the table process

/// The deck, in a process of its own.
@MainActor
final class Table: ObservableObject {
    @Published var running = false
    @Published var ready = false
    @Published var code = ""
    @Published var players: [Player] = []
    @Published var game = ""
    @Published var trouble: String?

    private var task: Process?
    private var sleepless: IOPMAssertionID = 0
    private var poll: Timer?
    private var known = Set<String>()

    struct Player: Identifiable, Decodable {
        var name: String
        var emoji: String
        var here: Bool
        var id: String { emoji + name }
    }

    /// Where this Mac plays. Localhost is a secure context, so everything the
    /// browser gives the page it gives it here too.
    var mine: URL {
        URL(string: "http://127.0.0.1:\(port)/?table=ws://127.0.0.1:\(port)#\(code)")!
    }

    /// The link other people on this network use. The app serves the front end
    /// itself, so the page and the table are always the same build, and it all
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
        // The house key travels as a hash, baked in at build time, so the
        // phrase itself is nowhere in the app.
        let lock = Bundle.main.object(forInfoDictionaryKey: "SuitfoldKey") as? String ?? ""
        p.environment = ProcessInfo.processInfo.environment.merging([
            "PORT": String(port),
            "SUITFOLD_WEB": web,
            "SUITFOLD_KEY": lock,
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

    /// A fresh code, same table process. Everybody has to come back through the
    /// new link, which is the point of it.
    func newTable() {
        code = Self.freshCode()
        known = []
        players = []
    }

    private func stopped() {
        running = false
        ready = false
        players = []
        poll?.invalidate()
        poll = nil
        keepAwake(false)
    }

    /// Ask the table who is there. Cheap, and it is the only way this app knows
    /// anything at all - it deliberately understands nothing about the game.
    private func watch() {
        poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { @MainActor in await refresh() }
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
        if !ready { ready = true }

        let mine = health.tables.first { $0.code == code }
        let seats = mine?.seats ?? []

        // Somebody new sitting down is worth saying out loud, because the whole
        // point of holding a table is that you are not watching the window.
        for seat in seats where seat.here && !known.contains(seat.id) {
            known.insert(seat.id)
            if !players.isEmpty || seats.count > 1 {
                Notify.say("\(seat.emoji) \(seat.name) sat down", body: game.isEmpty ? "At your table" : "At your \(game) table")
            }
        }
        for seat in seats where !seat.here { known.remove(seat.id) }

        players = seats
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

// MARK: - saying things out loud

/// Notifications and the dock badge. A browser tab can do neither of these
/// while it is behind something else, which is exactly when you need them.
enum Notify {
    static func ask() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    static func say(_ title: String, body: String) {
        let note = UNMutableNotificationContent()
        note.title = title
        note.body = body
        note.sound = .default
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: note, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    /// The number on the dock icon. Zero clears it.
    static func badge(_ n: Int) {
        NSApp.dockTile.badgeLabel = n > 0 ? String(n) : nil
    }
}

// MARK: - the table, in a window

/// The web view that is the game. Everything the website does, it does.
struct Felt: NSViewRepresentable {
    let url: URL
    @Binding var reload: Int

    func makeCoordinator() -> Bridge { Bridge() }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // The page talks back through this: it is how a mention becomes a
        // notification and an unread count becomes a badge on the dock.
        config.userContentController.add(context.coordinator, name: "suitfold")
        // Tell the page it is running inside the app, so it can offer the
        // things only the app has and hide the ones it cannot do.
        let flag = WKUserScript(
            source: "window.__suitfoldDesktop = true",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(flag)

        let view = WKWebView(frame: .zero, configuration: config)
        view.setValue(false, forKey: "drawsBackground")
        view.allowsBackForwardNavigationGestures = false
        view.load(URLRequest(url: url))
        context.coordinator.view = view
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        if context.coordinator.reloadedAt != reload {
            context.coordinator.reloadedAt = reload
            view.load(URLRequest(url: url))
        }
    }

    /// What the page is allowed to ask the app for. Deliberately two things.
    final class Bridge: NSObject, WKScriptMessageHandler {
        weak var view: WKWebView?
        var reloadedAt = 0

        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            switch body["kind"] as? String {
            case "notify":
                // Only when the window is not the one you are looking at.
                guard !NSApp.isActive else { return }
                Notify.say(body["title"] as? String ?? "suitfold", body: body["body"] as? String ?? "")
            case "badge":
                Notify.badge(body["count"] as? Int ?? 0)
            default:
                break
            }
        }
    }
}

// MARK: - the app

@main
struct SuitfoldApp: App {
    @StateObject private var table = Table()
    @State private var reload = 0
    @State private var sharing = false

    var body: some Scene {
        Window("suitfold", id: "table") {
            Group {
                if let trouble = table.trouble {
                    Trouble(text: trouble) { table.stop(); table.start() }
                } else if table.running && table.ready {
                    Felt(url: table.mine, reload: $reload)
                } else {
                    Setting(table: table)
                }
            }
            .frame(minWidth: 900, minHeight: 640)
            .background(Color(nsColor: .windowBackgroundColor))
            .onAppear {
                Notify.ask()
                table.start()
            }
            .sheet(isPresented: $sharing) { Share(table: table) }
            .toolbar {
                ToolbarItem(placement: .principal) {
                    if table.running {
                        Button {
                            sharing = true
                        } label: {
                            Label(table.code, systemImage: "person.2.fill")
                        }
                        .help("The code and the link, for everybody else")
                    }
                }
            }
        }
        .defaultSize(width: 1180, height: 820)
        .commands {
            CommandGroup(after: .newItem) {
                Button("Invite people\u{2026}") { sharing = true }
                    .keyboardShortcut("i")
                Button("New table") {
                    table.newTable()
                    reload += 1
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                Divider()
                Button("Reload the table") { reload += 1 }
                    .keyboardShortcut("r")
            }
        }
    }
}

/// While the deck is being brought out. It takes about a second.
struct Setting: View {
    @ObservedObject var table: Table

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "suit.spade.fill")
                .font(.system(size: 34))
                .foregroundStyle(.tint)
            Text("Setting the table")
                .font(.title2)
            ProgressView().controlSize(.small)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct Trouble: View {
    let text: String
    let again: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 30))
                .foregroundStyle(.orange)
            Text(text).multilineTextAlignment(.center)
            Button("Try again", action: again)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The code, the link and a QR code, for getting everybody else in.
struct Share: View {
    @ObservedObject var table: Table
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Everybody else joins with this")
                .font(.headline)

            Text(table.code)
                .font(.system(size: 40, weight: .medium, design: .monospaced))
                .kerning(6)
                .textSelection(.enabled)

            if let qr = Self.qr(table.joinLink) {
                Image(nsImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 168, height: 168)
                    .help("Point a phone at this")
            }

            Text(table.joinLink)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(2)
                .truncationMode(.middle)

            Text("Anybody on this wifi can open that. Nothing leaves the house.")
                .font(.caption)
                .foregroundStyle(.secondary)

            if !table.players.isEmpty {
                Divider()
                HStack(spacing: 10) {
                    ForEach(table.players) { p in
                        Text("\(p.emoji) \(p.name)")
                            .font(.caption)
                            .opacity(p.here ? 1 : 0.4)
                    }
                }
            }

            HStack {
                Button(copied ? "Copied" : "Copy the link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(table.joinLink, forType: .string)
                    copied = true
                }
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(28)
        .frame(width: 380)
    }

    static func qr(_ text: String) -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let out = filter.outputImage else { return nil }
        let big = out.transformed(by: CGAffineTransform(scaleX: 8, y: 8))
        let rep = NSCIImageRep(ciImage: big)
        let image = NSImage(size: rep.size)
        image.addRepresentation(rep)
        return image
    }
}
