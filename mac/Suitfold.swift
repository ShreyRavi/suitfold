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
// There is no website. This app is the whole thing, and everybody who plays
// has a copy: one person holds a table, the rest find it on the network and
// sit down. Nothing is published anywhere and nothing needs the internet.
//
// Every copy carries the front end and can run a table, so the two jobs are
// the same program in different moods. Holding one announces itself over
// Bonjour; joining one is picking a name off a list rather than typing an
// address at somebody.
//
// The deck lives in a process this app owns, which is the whole reason to be
// an app rather than a tab. A tab gets throttled the moment it goes to the
// back, gets closed by accident, and takes the game with it. This does none of
// that, keeps the Mac awake mid-hand, and can say something out loud when
// somebody needs you.

let port = 8123

/// Which of its two jobs the app is doing.
enum Doing: Equatable {
    /// Deciding, and looking around the network for somebody else's table.
    case choosing
    /// Holding a table of our own.
    case holding
    /// Sitting at somebody else's, at this address.
    case visiting(host: String, code: String)
}

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
    @Published var doing: Doing = .choosing

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

    /// Where this Mac plays.
    ///
    /// The page always comes from our own copy, so it is always the build this
    /// app shipped with. Only the table it talks to changes: ours when we are
    /// holding one, somebody else's when we are visiting. Localhost is a
    /// secure context, so the page gets everything a browser would give it.
    var mine: URL {
        switch doing {
        case .visiting(let host, let code):
            return URL(string: "http://127.0.0.1:\(port)/?table=ws://\(host):\(port)#\(code)")!
        default:
            return URL(string: "http://127.0.0.1:\(port)/?table=ws://127.0.0.1:\(port)#\(code)")!
        }
    }

    /// The link other people on this network use. The app serves the front end
    /// itself, so the page and the table are always the same build, and it all
    /// works with the internet unplugged.
    var joinLink: String {
        let host = Self.lanIP() ?? "localhost"
        return "http://\(host):\(port)/?table=ws://\(host):\(port)#\(code)"
    }

    /// Bring up our own copy of the server. Every app does this, holding a
    /// table or not: it is what serves the front end.
    func start() {
        guard task == nil else { return }

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

    /// Hold a table of our own, and tell the network about it.
    func hold(as name: String) {
        code = Self.freshCode()
        known = []
        players = []
        doing = .holding
        Beacon.shared.announce(code: code, who: name)
    }

    /// Sit down at somebody else's.
    func visit(host: String, code: String) {
        Beacon.shared.hush()
        self.code = code
        known = []
        players = []
        doing = .visiting(host: host, code: code)
    }

    /// Back to the list, holding nothing.
    func leave() {
        Beacon.shared.hush()
        doing = .choosing
        code = ""
        players = []
        game = ""
    }

    /// A fresh code for the table we are holding.
    func newTable(as name: String) {
        hold(as: name)
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

        guard case .holding = doing else {
            players = []
            return
        }
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

// MARK: - finding each other

/// A table found on the network.
struct Nearby: Identifiable, Equatable {
    var name: String
    var host: String
    var code: String
    var id: String { host + code }
}

/**
 Tables announce themselves and apps listen for them.

 This is the whole reason joining is not a chore. Without it every guest has to
 be told an address and a code by somebody reading numbers out loud; with it
 they open the app and their sister's table is sitting there in a list.

 It never leaves the local network. Nothing is registered anywhere, there is no
 directory, and an app that is not holding a table says nothing at all.
 */
@MainActor
final class Beacon: NSObject, ObservableObject {
    static let shared = Beacon()

    @Published var found: [Nearby] = []

    private var service: NetService?
    private var browser: NetServiceBrowser?
    private var resolving: [NetService] = []

    /// Tell the network we are holding a table.
    func announce(code: String, who: String) {
        hush()
        let s = NetService(domain: "local.", type: "_suitfold._tcp.", name: "\(who) - \(code)", port: Int32(port))
        // The code travels in the record so a guest never types one.
        s.setTXTRecord(NetService.data(fromTXTRecord: [
            "code": Data(code.utf8),
            "who": Data(who.utf8),
        ]))
        s.publish()
        service = s
    }

    /// Stop announcing. An app not holding a table is not a table.
    func hush() {
        service?.stop()
        service = nil
    }

    /// Start looking for other people's tables.
    func look() {
        found = []
        let b = NetServiceBrowser()
        b.delegate = self
        b.searchForServices(ofType: "_suitfold._tcp.", inDomain: "local.")
        browser = b
    }

    func stopLooking() {
        browser?.stop()
        browser = nil
        resolving = []
    }
}

extension Beacon: NetServiceBrowserDelegate, NetServiceDelegate {
    nonisolated func netServiceBrowser(_ b: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        Task { @MainActor in
            service.delegate = self
            self.resolving.append(service)
            service.resolve(withTimeout: 5)
        }
    }

    nonisolated func netServiceBrowser(_ b: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        Task { @MainActor in
            self.found.removeAll { $0.name == service.name }
        }
    }

    nonisolated func netServiceDidResolveAddress(_ service: NetService) {
        Task { @MainActor in
            guard let host = Self.ipv4(of: service) else { return }
            // Our own table is not somewhere to go.
            if host == Table.lanIP() { return }
            var code = ""
            var who = service.name
            if let data = service.txtRecordData() {
                let record = NetService.dictionary(fromTXTRecord: data)
                if let c = record["code"], let text = String(data: c, encoding: .utf8) { code = text }
                if let w = record["who"], let text = String(data: w, encoding: .utf8) { who = text }
            }
            guard !code.isEmpty else { return }
            let table = Nearby(name: who, host: host, code: code)
            if !self.found.contains(table) { self.found.append(table) }
            self.resolving.removeAll { $0 === service }
        }
    }

    /// The dotted address out of whatever the resolver handed back.
    static func ipv4(of service: NetService) -> String? {
        for case let data as Data in service.addresses ?? [] {
            let host = data.withUnsafeBytes { raw -> String? in
                guard let sa = raw.baseAddress?.assumingMemoryBound(to: sockaddr.self) else { return nil }
                guard sa.pointee.sa_family == UInt8(AF_INET) else { return nil }
                var name = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                guard getnameinfo(sa, socklen_t(data.count), &name, socklen_t(name.count), nil, 0, NI_NUMERICHOST) == 0
                else { return nil }
                return String(cString: name)
            }
            if let host { return host }
        }
        return nil
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
                } else if !table.running || !table.ready {
                    Setting(table: table)
                } else if table.doing == .choosing {
                    Chooser(table: table)
                } else {
                    Felt(url: table.mine, reload: $reload)
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
                    .disabled(table.doing != .holding)
                Button("New table") {
                    table.newTable(as: myName())
                    reload += 1
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(table.doing != .holding)
                Divider()
                Button("Back to the list") {
                    table.leave()
                    Beacon.shared.look()
                }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(table.doing == .choosing)
                Button("Reload the table") { reload += 1 }
                    .keyboardShortcut("r")
            }
        }
    }
}

/// What this Mac calls itself, for announcing a table. Just a starting point;
/// the name you play under is the one you type at the table.
func myName() -> String {
    let host = Host.current().localizedName ?? "Somebody"
    return host.replacingOccurrences(of: "'s MacBook Pro", with: "")
        .replacingOccurrences(of: "'s MacBook Air", with: "")
        .replacingOccurrences(of: "'s Mac", with: "")
        .replacingOccurrences(of: "'s iMac", with: "")
}

/**
 The first thing you see: hold a table, or sit at one somebody else is holding.

 The list fills itself in. Nobody reads an address out loud, nobody types a
 code, and if the network will not cooperate there is a box at the bottom for
 doing it the hard way.
 */
struct Chooser: View {
    @ObservedObject var table: Table
    @ObservedObject private var beacon = Beacon.shared
    @State private var manual = ""

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Image(systemName: "suit.spade.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(.tint)
                Text("suitfold").font(.system(size: 26, weight: .medium))
                Text("A card table for the family")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 46)
            .padding(.bottom, 26)

            Button {
                table.hold(as: myName())
            } label: {
                Label("Hold a table", systemImage: "plus.circle.fill")
                    .frame(maxWidth: 260)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)

            Text("Everybody else can sit down at it")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.top, 6)

            Divider().padding(.vertical, 24).frame(width: 320)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 7) {
                    Text("TABLES NEARBY")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(.secondary)
                    if beacon.found.isEmpty {
                        ProgressView().controlSize(.small).scaleEffect(0.7)
                    }
                }

                if beacon.found.isEmpty {
                    Text("Nothing yet. They show up here on their own once somebody is holding one on this network.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 320, alignment: .leading)
                } else {
                    ForEach(beacon.found) { table_ in
                        Button {
                            table.visit(host: table_.host, code: table_.code)
                        } label: {
                            HStack {
                                Image(systemName: "person.2.fill").foregroundStyle(.tint)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(table_.name).fontWeight(.medium)
                                    Text(table_.code)
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                            }
                            .frame(width: 300)
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }

            Spacer()

            // For a network that will not do Bonjour, or somebody on a VPN.
            HStack(spacing: 6) {
                TextField("or an address, like 192.168.1.5", text: $manual)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 230)
                    .onSubmit(byHand)
                Button("Join", action: byHand).disabled(manual.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(.bottom, 22)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { beacon.look() }
        .onDisappear { beacon.stopLooking() }
    }

    /// An address typed in, with or without a code on the end of it.
    private func byHand() {
        let said = manual.trimmingCharacters(in: .whitespaces)
        guard !said.isEmpty else { return }
        // Accept a bare address, or a whole link pasted out of a message.
        let host = said
            .replacingOccurrences(of: "http://", with: "")
            .replacingOccurrences(of: "ws://", with: "")
            .split(separator: "/").first.map(String.init)?
            .split(separator: ":").first.map(String.init) ?? said
        let code = said.contains("#") ? String(said.split(separator: "#").last ?? "") : ""
        table.visit(host: host, code: code.uppercased())
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
