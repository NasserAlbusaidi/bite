import { useEffect, useRef, useState } from "react";

type Detector = {
	detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** Longest side of the frame handed to the decoder. Plenty for a screen-sized code. */
const MAX_SIDE = 720;
const SCAN_EVERY_MS = 200;

/**
 * Live camera preview that reports the first QR code `accept` likes.
 * Uses the platform's BarcodeDetector where it exists (Android web view,
 * Chrome) and falls back to jsQR, loaded only when needed (iPad's web view).
 * The camera is released as soon as the component unmounts.
 */
export function QrScanner(props: {
	/** Return true to stop scanning: the code was the right kind. */
	accept: (text: string) => boolean;
	/** The camera could not be opened (no permission, no camera). */
	onUnavailable: (reason: string) => void;
	label: string;
}) {
	const video = useRef<HTMLVideoElement | null>(null);
	const [live, setLive] = useState(false);
	// Callers pass fresh closures on every render; the camera must not restart for that.
	const cb = useRef(props);
	cb.current = props;

	useEffect(() => {
		let stopped = false;
		let stream: MediaStream | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		async function start() {
			if (!navigator.mediaDevices?.getUserMedia)
				return cb.current.onUnavailable("no_camera_api");
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: { ideal: "environment" } },
					audio: false,
				});
			} catch (e) {
				return cb.current.onUnavailable(
					e instanceof Error ? e.name : "camera_error",
				);
			}
			const el = video.current;
			if (stopped || !el) {
				for (const t of stream.getTracks()) t.stop();
				return;
			}
			el.srcObject = stream;
			await el.play().catch(() => undefined);
			setLive(true);

			const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor })
				.BarcodeDetector;
			let detector: Detector | null = null;
			try {
				detector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
			} catch {
				detector = null;
			}
			type Decode = typeof import("jsqr")["default"];
			let jsqr: Decode | null = null;
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("2d", { willReadFrequently: true });

			const tick = async () => {
				if (stopped) return;
				let found: string | null = null;
				if (el.videoWidth > 0) {
					try {
						if (detector) {
							try {
								found = (await detector.detect(el))[0]?.rawValue ?? null;
							} catch {
								// Present but not working on this device: use jsQR from here on.
								detector = null;
							}
						}
						if (!detector && ctx) {
							jsqr ??= (await import("jsqr")).default;
							const scale = Math.min(
								1,
								MAX_SIDE / Math.max(el.videoWidth, el.videoHeight),
							);
							canvas.width = Math.round(el.videoWidth * scale);
							canvas.height = Math.round(el.videoHeight * scale);
							ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
							const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
							found = jsqr(img.data, img.width, img.height)?.data ?? null;
						}
					} catch {
						// A frame that fails to decode is not an error; try the next one.
					}
				}
				if (stopped) return;
				if (found && cb.current.accept(found)) return;
				timer = setTimeout(tick, SCAN_EVERY_MS);
			};
			void tick();
		}
		void start();

		return () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			for (const t of stream?.getTracks() ?? []) t.stop();
		};
	}, []);

	return (
		<div className={live ? "scanner live" : "scanner"}>
			<video ref={video} muted playsInline aria-label={props.label} />
			<span className="scanner__frame" aria-hidden="true" />
		</div>
	);
}
