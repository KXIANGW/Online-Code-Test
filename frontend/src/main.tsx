import React from "react";
import ReactDOM from "react-dom/client";
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "./index.css";
import App from "./App";

// Point Monaco at the locally-bundled assets so CSP never needs cdn.jsdelivr.net.
// editor.worker covers all language-agnostic features; C++ and Python do not
// require dedicated language workers.
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

loader.config({ monaco });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
