import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "leaflet/dist/leaflet.css";

// StrictMode intentionally removed: it causes double-mount in dev
// which breaks Leaflet's "container already initialized" check
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
