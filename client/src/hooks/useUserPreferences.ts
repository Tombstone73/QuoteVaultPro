import { useState, useEffect } from "react";

export type AfterSaveNavigation = "stay" | "back";

export interface UserPreferences {
    afterSaveNavigation: AfterSaveNavigation;
}

const DEFAULT_PREFERENCES: UserPreferences = {
    afterSaveNavigation: "stay",
};

const STORAGE_KEY = "titanos:user:preferences";

/**
 * Hook for accessing and managing user preferences.
 * 
 * Currently uses localStorage as a stub. In the future, this can be
 * extended to sync with a backend API for persistence across devices.
 */
export function useUserPreferences() {
    const [preferences, setPreferences] = useState<UserPreferences>(() => {
        if (typeof window === "undefined") return DEFAULT_PREFERENCES;

        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (!stored) return DEFAULT_PREFERENCES;

            const parsed = JSON.parse(stored) as Partial<UserPreferences>;
            // Merge with defaults to handle missing properties
            return {
                ...DEFAULT_PREFERENCES,
                ...parsed,
            };
        } catch (error) {
            console.error("Failed to parse user preferences:", error);
            return DEFAULT_PREFERENCES;
        }
    });

    // Persist preferences to localStorage when they change
    useEffect(() => {
        if (typeof window === "undefined") return;

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
        } catch (error) {
            console.error("Failed to save user preferences:", error);
        }
    }, [preferences]);

    const updatePreferences = (updates: Partial<UserPreferences>) => {
        setPreferences((prev) => ({ ...prev, ...updates }));
    };

    return {
        preferences,
        updatePreferences,
    };
}


