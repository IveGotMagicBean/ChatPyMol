import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppClean } from "./AppClean";
import "./simple.css";
import "./clean.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppClean />
  </StrictMode>
);
