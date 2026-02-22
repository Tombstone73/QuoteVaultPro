import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getDefaultSectionRoute, isSafeInternalRoute, toHref, type ReferrerRoute } from "@/lib/nav/smartBack";

export function useSmartBack() {
  const navigate = useNavigate();
  const location = useLocation();

  const defaultSectionRoute = useMemo(() => getDefaultSectionRoute(location.pathname), [location.pathname]);

  const referrer = useMemo(() => {
    const maybe = (location.state as any)?.referrer;
    if (!isSafeInternalRoute(maybe)) return null;
    const current = `${location.pathname}${location.search}${location.hash}`;
    const candidate = toHref(maybe as ReferrerRoute);
    if (candidate === current) return null;
    return maybe as ReferrerRoute;
  }, [location.hash, location.pathname, location.search, location.state]);

  const backHref = useMemo(() => {
    if (referrer) return toHref(referrer);
    return defaultSectionRoute;
  }, [defaultSectionRoute, referrer]);

  const canSmartBack = !!referrer || (typeof window !== "undefined" && window.history.length > 1);

  const onSmartBack = useCallback(() => {
    if (referrer) {
      navigate(toHref(referrer));
      return;
    }

    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate(defaultSectionRoute);
  }, [defaultSectionRoute, navigate, referrer]);

  return {
    backHref,
    canSmartBack,
    defaultSectionRoute,
    onSmartBack,
  };
}
