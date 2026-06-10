import React from "react";
import ReactDOM from "react-dom/client";
import { configureMonaco } from "./utils/monacoSetup";
import "./index.css";
import App from "./App";

configureMonaco();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
