"use client";
import { useState, useEffect } from "react";
import { fetchMe, handleSessionExpired, saveDisplayUser } from "@/lib/auth/clientSession";

interface BlockGuardProps {
  permission: string | string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function BlockGuard({ permission, children, fallback = null }: BlockGuardProps) {
  const [user, setUser] = useState<any>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const data = localStorage.getItem("oms_user");
    if (data) {
      const parsedUser = JSON.parse(data);
      setUser(parsedUser);

      // Fetch latest permissions from the server session (display only - the
      // APIs behind each page enforce permissions themselves).
      fetchMe()
        .then(me => {
          if (!me) return handleSessionExpired();
          saveDisplayUser(me);
          setUser({ username: me.username, permissions: me.permissions });
        })
        .catch(() => {});
    }
  }, []);

  if (!isMounted) return null;

  const usernameLower = user?.username?.trim().toLowerCase();
  const isSuperAdmin = ["admin", "chintan", "hitesh"].includes(usernameLower) || user?.permissions?.boss === true;

  // WHITELIST LOGIC: If the permission is 'true', or if the user is a super admin, they have access.
  const hasAccess = isSuperAdmin || (
    Array.isArray(permission)
      ? permission.some(p => user?.permissions?.[p] === true)
      : user?.permissions?.[permission] === true
  );

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
