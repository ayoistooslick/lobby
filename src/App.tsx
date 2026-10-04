import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LanguageGate } from "./components/Language";
import PublicLayout from "./components/PublicLayout";
import RequireAuth from "./components/RequireAuth";
import { I18nProvider } from "./lib/i18n";
import About from "./pages/About";
import Auth from "./pages/Auth";
import CustomerQueue from "./pages/CustomerQueue";
import DashboardLayout from "./pages/DashboardLayout";
import DashboardQr from "./pages/DashboardQr";
import DashboardQueue from "./pages/DashboardQueue";
import DashboardSettings from "./pages/DashboardSettings";
import Landing from "./pages/Landing";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/about" element={<About />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="*" element={<NotFound />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<DashboardQueue />} />
              <Route path="qr" element={<DashboardQr />} />
              <Route path="settings" element={<DashboardSettings />} />
            </Route>
          </Route>

          <Route path="/q/:slug" element={<CustomerQueue />} />
        </Routes>
      </BrowserRouter>
      <LanguageGate />
    </I18nProvider>
  );
}
