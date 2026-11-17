import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { openLocalDb } from "./runtime.js";
import { App } from "./ui/App.js";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

openLocalDb().then(
	(db) => {
		createRoot(root).render(
			<StrictMode>
				<App db={db} />
			</StrictMode>,
		);
	},
	(err: unknown) => {
		// Without the local DB the till can't take a sale safely. Say so loudly.
		root.textContent = `Local database failed to open: ${err instanceof Error ? err.message : String(err)}`;
	},
);
