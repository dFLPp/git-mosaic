import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createWebApi } from "./api.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root application element");

createRoot(root).render(
  <StrictMode>
    <App api={createWebApi()} />
  </StrictMode>,
);
