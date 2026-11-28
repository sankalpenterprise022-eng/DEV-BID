"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import GlobalTaskCreate from "@/components/GlobalTaskCreate";
import NotifyBanner from "@/components/NotifyBanner";
import { SESSION_KEY, fetchMe, handleSessionExpired, saveDisplayUser } from "@/lib/auth/clientSession";
// DISABLED (Urgent Tasks popup, same as DEV OMS): import UrgentTaskPopup from "@/components/UrgentTaskPopup";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLoginPage = pathname === "/login";
  const [isLoading, setIsLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (isLoginPage) { setIsLoading(false); return; }
    // The httpOnly session cookie decides; localStorage is only a display cache
    // (refreshed here, or cleared if the cookie is missing/expired).
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        if (!me) { handleSessionExpired(); return; }
        saveDisplayUser(me);
        setIsLoading(false);
      })
      .catch(() => {
        // Server unreachable: show cached UI if we had a session; APIs will 401 if not.
        if (cancelled) return;
        if (localStorage.getItem(SESSION_KEY)) setIsLoading(false);
        else router.push("/login");
      });
    return () => { cancelled = true; };
  }, [isLoginPage, router]);

  // Notification tap while the app tab is open but not controlled by the SW: sw.js posts the URL.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "OPEN_URL" && typeof e.data.url === "string" && e.data.url.startsWith(window.location.origin)) {
        window.location.href = e.data.url;
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  const head = (
    <head>
      <title>Dev Task OMS</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      {/* PWA: installable app + push (public/sw.js) */}
      <link rel="manifest" href="/manifest.webmanifest" />
      <meta name="theme-color" content="#0a2540" />
      <link rel="icon" href="/icons/icon-192.png" type="image/png" />
      <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Task OMS" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    </head>
  );

  if (!isMounted) {
    return (<html lang="en">{head}<body className="bg-[#f3f6f9]" suppressHydrationWarning /></html>);
  }

  return (
    <html lang="en">
      {head}
      <body className="bg-[#f3f6f9] h-dvh overflow-hidden" suppressHydrationWarning>
        {isLoading && !isLoginPage ? (
          <div className="h-dvh flex items-center justify-center bg-[#f3f6f9]">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-blue-600"></div>
          </div>
        ) : !isLoginPage ? (
          <div className="flex flex-col h-full">
            <Header />
            <NotifyBanner />
            <main className="flex-1 overflow-y-auto">{children}</main>
            {/* DISABLED (Urgent Tasks) - uncomment to re-enable: <UrgentTaskPopup /> */}
            <GlobalTaskCreate />
          </div>
        ) : (
          <main className="h-full">{children}</main>
        )}
      </body>
    </html>
  );
}
