package app.bite.printersocket;

import android.util.Base64;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Raw TCP for ESC/POS printers (port 9100). One connection per job. */
@CapacitorPlugin(name = "PrinterSocket")
public class PrinterSocketPlugin extends Plugin {

    // One thread: jobs to the same printer must not interleave on the wire.
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void send(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String data = call.getString("data");
        int timeoutMs = call.getInt("timeoutMs", 5000);
        if (host == null || port == null || data == null) {
            call.reject("host, port and data are required");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("data is not valid base64");
            return;
        }
        io.execute(() -> {
            try (Socket socket = new Socket()) {
                socket.connect(new InetSocketAddress(host, port), timeoutMs);
                socket.setSoTimeout(timeoutMs);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                call.resolve();
            } catch (Exception e) {
                call.reject("Printer " + host + ":" + port + " unreachable: " + e.getMessage(), e);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        io.shutdown();
    }
}
