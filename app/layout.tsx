"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Header from "@/components/Header";
import GlobalTaskCreate from "@/components/GlobalTaskCreate";
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
    const user = localStorage.getItem("oms_user");
    if (isLoginPage) { setIsLoading(false); return; }
    if (!user) router.push("/login");
    else setIsLoading(false);
  }, [isLoginPage, router]);

  const head = (
    <head>
      <title>Dev Task OMS</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
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
