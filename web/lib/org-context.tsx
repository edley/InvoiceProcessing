"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { setApiHeaders, getApiHeaders, setAccessToken } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type OrgInfo = {
  id: string;
  name: string;
  role: "admin" | "manager" | "viewer";
  permissions?: any;
};

type OrgContextValue = {
  orgs: OrgInfo[];
  currentOrg: OrgInfo | null;
  loading: boolean;
  setCurrentOrg: (org: OrgInfo) => void;
  refresh: () => Promise<void>;
};

const OrgContext = createContext<OrgContextValue>({
  orgs: [],
  currentOrg: null,
  loading: true,
  setCurrentOrg: () => {},
  refresh: async () => {},
});

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [currentOrg, setCurrentOrgState] = useState<OrgInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const setCurrentOrg = useCallback((org: OrgInfo) => {
    setCurrentOrgState(org);
    const { userId } = getApiHeaders();
    setApiHeaders(org.id, userId);
    localStorage.setItem("org_id", org.id);
    localStorage.setItem("org_role", org.role);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setAccessToken(session.access_token);
      localStorage.setItem("sb-access-token", session.access_token);

      // Set userId immediately so all subsequent API calls have it
      setApiHeaders(null, session.user.id);

      const res = await fetch(`${API}/api/orgs`, {
        headers: {
          "Authorization": `Bearer ${session.access_token}`,
          "X-User-Id": session.user.id,
        },
      });
      if (!res.ok) {
        setOrgs([]);
        setCurrentOrgState(null);
        return;
      }
      const body = await res.json();
      const items: any[] = body.items || [];

      const mapped: OrgInfo[] = items.map((o: any) => ({
        id: o.id,
        name: o.name,
        role: o.role as OrgInfo["role"],
        permissions: o.permissions,
      }));
      setOrgs(mapped);

      // DB is source of truth — always use first org from API as default
      const target = mapped.length > 0 ? mapped[0] : null;
      setCurrentOrgState(target);
      if (target) {
        setApiHeaders(target.id, session.user.id);
        localStorage.setItem("org_id", target.id);
        localStorage.setItem("org_role", target.role);
      } else {
        setApiHeaders(null, session.user.id);
        localStorage.removeItem("org_id");
        localStorage.removeItem("org_role");
      }
    } catch {
      // Ensure userId is at least set so API calls can try
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setAccessToken(session.access_token);
          localStorage.setItem("sb-access-token", session.access_token);
          setApiHeaders(null, session.user.id);
        }
      } catch {}
      setOrgs([]);
      setCurrentOrgState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const user = session.user;
        localStorage.setItem("user_id", user.id);
        setAccessToken(session.access_token);
        setApiHeaders(null, user.id);
        refresh();
      } else {
        setLoading(false);
      }
    });
  }, [refresh]);

  return (
    <OrgContext.Provider value={{ orgs, currentOrg, loading, setCurrentOrg, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  return useContext(OrgContext);
}
