import { useMemo } from "react";
import { encode } from "uqr";

/** SVG path for a QR code: one unit square per dark module. */
export function qrPath(value: string, border = 2) {
	const qr = encode(value, { ecc: "M", border });
	let d = "";
	for (let y = 0; y < qr.size; y++) {
		const row = qr.data[y] ?? [];
		for (let x = 0; x < qr.size; x++) {
			if (!row[x]) continue;
			// Merge a run of dark modules into one rectangle.
			let w = 1;
			while (row[x + w]) w++;
			d += `M${x} ${y}h${w}v1h-${w}z`;
			x += w - 1;
		}
	}
	return { d, size: qr.size };
}

/** A standalone SVG document, for "download" and for printing elsewhere. */
export function qrSvg(value: string, pixels = 1024): string {
	const { d, size } = qrPath(value, 4);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${pixels}" height="${pixels}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/**
 * A QR code. Always black on white, whatever the theme: scanners need the
 * contrast, so this is the one place raw colours are right.
 */
export function QrCode({
	value,
	size = 200,
	label,
	className,
}: {
	value: string;
	/** CSS pixels. */
	size?: number;
	/** Accessible name: what scanning it does. */
	label: string;
	className?: string;
}) {
	const { d, size: n } = useMemo(() => qrPath(value), [value]);
	return (
		<svg
			className={className}
			viewBox={`0 0 ${n} ${n}`}
			width={size}
			height={size}
			role="img"
			aria-label={label}
			shapeRendering="crispEdges"
		>
			<rect width={n} height={n} fill="#fff" />
			<path d={d} fill="#000" />
		</svg>
	);
}
