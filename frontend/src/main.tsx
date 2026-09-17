import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import { CompanyProvider } from "./CompanyContext";
import App from "./App";
import { installSelectKeyboard } from "./selectKeyboard";
import "./index.css";

installSelectKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CompanyProvider>
          <App />
        </CompanyProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
