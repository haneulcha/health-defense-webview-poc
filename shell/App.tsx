import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { GAME_HTML } from "./game-html";

/**
 * The React Native shell the game will actually ship inside.
 *
 * Its job in this PoC is to answer one question the browser cannot: does the
 * game behave the same inside a real WebView? Everything here is either
 * required to make that comparison fair, or is a WebView setting that would
 * otherwise make the game feel like a web page embedded in an app.
 */

/**
 * Set to a URL to load the dev server or the deployed build instead of the
 * inlined markup. Handy while iterating; the bundled string is what ships.
 * e.g. 'https://haneulcha.github.io/health-defense-webview-poc/'
 */
const REMOTE_URL: string | null = null;

interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Forwards page errors to the native side before the game loads.
 *
 * A WebView has no console. Without this, a JavaScript error inside the game
 * shows up as a blank rectangle and nothing else — which is exactly how the
 * first run of this shell failed. Attaching to the bridge means a crash names
 * itself on screen, on a device, with no debugger attached.
 */
const ERROR_FORWARDER = `
(function () {
  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }
  window.addEventListener('error', function (event) {
    post({
      type: 'web-error',
      message: event.message,
      line: event.lineno,
      stack: event.error && event.error.stack ? String(event.error.stack).slice(0, 300) : null,
    });
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    post({
      type: 'web-error',
      message: reason && reason.message ? reason.message : String(reason),
      stack: reason && reason.stack ? String(reason.stack).slice(0, 300) : null,
    });
  });
  true;
})();
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [bridgeLog, setBridgeLog] = useState<string[]>([]);
  const pingSentAt = useRef<number | null>(null);

  useEffect(() => {
    // The game is designed for a fixed portrait playfield; letting the device
    // rotate would rebuild the layout into an aspect the map was not drawn for.
    void ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
  }, []);

  const note = useCallback((line: string) => {
    setBridgeLog((previous) => [...previous.slice(-4), line]);
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: BridgeMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        note(
          `web → native: unparseable (${event.nativeEvent.data.slice(0, 40)})`,
        );
        return;
      }

      if (message.type === "ready") {
        note("web → native: ready");
        // Round-trip the other way as soon as the game says it is up.
        pingSentAt.current = Date.now();
        webViewRef.current?.postMessage(JSON.stringify({ type: "ping" }));
        return;
      }

      if (message.type === "web-error") {
        note(`web error: ${String(message.message)}`);
        if (message.stack) note(String(message.stack));
        return;
      }

      if (message.type === "pong") {
        const elapsed = pingSentAt.current
          ? Date.now() - pingSentAt.current
          : null;
        note(
          `native → web → native: pong${elapsed === null ? "" : ` in ${elapsed}ms`}`,
        );
        return;
      }

      note(`web → native: ${message.type}`);
    },
    [note],
  );

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
          <WebView
            ref={webViewRef}
            source={REMOTE_URL ? { uri: REMOTE_URL } : { html: GAME_HTML }}
            // Opaque background via style: a transparent WebView composites
            // against the native view every frame for no benefit here.
            style={styles.webView}
            onMessage={onMessage}
            injectedJavaScriptBeforeContentLoaded={ERROR_FORWARDER}
            // --- feel ---
            // Without these the game scrolls, glows, and rubber-bands like a web
            // page whenever a drag misses a tower.
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            // A double-tap during fast tower placement must not zoom the board.
            scalesPageToFit={false}
            setBuiltInZoomControls={false}
            textZoom={100}
            // --- media ---
            // iOS refuses audio without these even after the in-page unlock gate.
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            // --- performance ---
            // GPU-backed layer. Anything else routes the canvas through software
            // compositing and would invalidate every number the harness reports.
            androidLayerType="hardware"
            onRenderProcessGone={() => note("android: render process gone")}
            onContentProcessDidTerminate={() =>
              note("ios: content process gone")
            }
          />
        </SafeAreaView>

        {/* Bridge readout. This is a PoC instrument, not product UI — it exists
          so the round-trip can be seen working on a device with no debugger. */}
        <SafeAreaView style={styles.bridgePanel} edges={["bottom"]}>
          <Text style={styles.bridgeTitle}>
            bridge · {Platform.OS} · {REMOTE_URL ? "remote" : "bundled"}
          </Text>
          {bridgeLog.length === 0 ? (
            <Text style={styles.bridgeLine}>waiting for the game…</Text>
          ) : (
            bridgeLog.map((line, index) => (
              <Text key={`${line}-${index}`} style={styles.bridgeLine}>
                {line}
              </Text>
            ))
          )}
        </SafeAreaView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d1117" },
  safeArea: { flex: 1 },
  webView: { flex: 1, backgroundColor: "#0d1117" },
  bridgePanel: {
    backgroundColor: "#11161d",
    borderTopWidth: 1,
    borderTopColor: "#222c38",
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  bridgeTitle: { color: "#7d8590", fontSize: 10, marginBottom: 2 },
  bridgeLine: { color: "#8b949e", fontSize: 11 },
});
