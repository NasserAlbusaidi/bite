import {
	covers,
	crumbs,
	loaderCss,
	logo,
	type Script,
} from "../lib/bite-loader";

const CSS: Partial<Record<Script, string>> = {};
const cssFor = (script: Script) => {
	CSS[script] ??= loaderCss(script, script === "arabic" ? "bl-ar" : "bl-la");
	return CSS[script];
};

/**
 * The Bite logo being eaten, on a loop. Pure CSS animation, so it also runs in
 * the prerendered first-load screen before any JavaScript has loaded.
 */
export function BiteLoader({
	script = "latin",
	label,
	hint,
	action,
}: {
	script?: Script;
	/** Read by screen readers, and shown under the logo. */
	label: string;
	hint?: string;
	action?: React.ReactNode;
}) {
	const { d, viewBox } = logo(script);
	const id = script === "arabic" ? "bl-ar" : "bl-la";
	return (
		<div className="bite-loader" role="status" aria-live="polite">
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: generated keyframes, no user input */}
			<style dangerouslySetInnerHTML={{ __html: cssFor(script) }} />
			<svg
				className={`bite-loader__art ${id}`}
				data-script={script}
				viewBox={viewBox}
				aria-hidden="true"
				focusable="false"
			>
				<g className="bite-loader__eat">
					<path d={d} fillRule="evenodd" className="bite-loader__logo" />
					{covers(script).map((c, i) => (
						<circle
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed list, index is the identity
							key={i}
							className={`bite-loader__bite bl-c${i}`}
							cx={c.cx.toFixed(1)}
							cy={c.cy.toFixed(1)}
							r={c.r.toFixed(1)}
						/>
					))}
				</g>
				{crumbs(script).map((c, i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed list, index is the identity
						key={i}
						className={`bite-loader__crumb bl-k${i}`}
						cx={c.cx.toFixed(1)}
						cy={c.cy.toFixed(1)}
						r={c.r.toFixed(1)}
					/>
				))}
			</svg>
			<p className="bite-loader__label">{label}</p>
			{hint && <p className="bite-loader__hint">{hint}</p>}
			{action}
		</div>
	);
}
