import Capacitor
import Foundation
import Network

/// Raw TCP for ESC/POS printers (port 9100). One connection per job.
/// Needs NSLocalNetworkUsageDescription in the app's Info.plist (iOS 14+).
@objc(PrinterSocketPlugin)
public class PrinterSocketPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrinterSocketPlugin"
    public let jsName = "PrinterSocket"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise)
    ]

    // Serial: jobs to the same printer must not interleave on the wire.
    private let queue = DispatchQueue(label: "app.bite.printersocket")

    @objc func send(_ call: CAPPluginCall) {
        guard let host = call.getString("host"),
              let port = call.getInt("port"),
              let data = call.getString("data"),
              let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port))
        else {
            call.reject("host, port and data are required")
            return
        }
        guard let bytes = Data(base64Encoded: data) else {
            call.reject("data is not valid base64")
            return
        }
        let timeoutMs = call.getInt("timeoutMs") ?? 5000

        let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        var finished = false
        let finish: (String?) -> Void = { error in
            // Always called on `queue`, so no lock needed.
            if finished { return }
            finished = true
            conn.cancel()
            if let error { call.reject("Printer \(host):\(port) unreachable: \(error)") } else { call.resolve() }
        }

        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                conn.send(content: bytes, isComplete: true, completion: .contentProcessed { err in
                    finish(err.map { "\($0)" })
                })
            case .failed(let err):
                finish("\(err)")
            case .waiting(let err):
                // No route / refused: fail fast instead of waiting for the network to change.
                finish("\(err)")
            default:
                break
            }
        }
        queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) { finish("timed out after \(timeoutMs)ms") }
        conn.start(queue: queue)
    }
}
