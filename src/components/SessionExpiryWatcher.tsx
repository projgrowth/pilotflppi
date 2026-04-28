/**
 * SessionExpiryWatcher — listens for Supabase auth state changes. When the
 * session goes from "valid" to gone (token refresh failed, server-side
 * revocation, manual signout from another tab), we show a clear toast and
 * route the user to /login instead of leaving them with silent 401s on
 * every query.
 */
import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const PUBLIC_PATHS = new Set(["/", "/login"]);

export function SessionExpiryWatcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const hadSession = useRef<boolean>(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) hadSession.current = !!data.session;
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Transition from authenticated → unauthenticated mid-session.
      const wasAuthed = hadSession.current;
      const isAuthed = !!session;
      hadSession.current = isAuthed;

      if (
        wasAuthed &&
        !isAuthed &&
        (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")
      ) {
        if (!PUBLIC_PATHS.has(location.pathname)) {
          toast.error("Session expired — please sign in again.");
          navigate("/login", { replace: true });
        }
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate, location.pathname]);

  return null;
}
