import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppClean } from "./AppClean";
import { SharedConversation } from "./SharedConversation";
import "./simple.css";
import "./clean.css";

const shareMatch = window.location.pathname.match(
  /^\/share\/(shr_[a-f0-9]{48})\/?$/
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {shareMatch ? (
      <SharedConversation shareId={shareMatch[1]} />
    ) : (
      <AppClean />
    )}
  </StrictMode>
);
