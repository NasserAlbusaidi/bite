import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "./gallery.css";
import { Gallery } from "./Gallery";

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<Gallery />
		</StrictMode>,
	);
