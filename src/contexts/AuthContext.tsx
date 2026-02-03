import React, { createContext, useContext, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import LoadingScreen from '@/components/loading-screen/loading-screen';
import { localize } from '@deriv-com/translations';

interface AuthContextType {
    isInitialized: boolean;
    hasToken: boolean;
    isLoadingUserData: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const store = useStore();
    const [hasToken, setHasToken] = useState(false);

    // Check for auth token in localStorage
    useEffect(() => {
        const checkToken = () => {
            const token = localStorage.getItem('authToken');
            const accountsList = localStorage.getItem('accountsList');
            setHasToken(!!(token && accountsList));
        };

        // Initial check
        checkToken();

        // Listen for storage changes (in case token is set in another tab or by callback)
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'authToken' || e.key === 'accountsList') {
                checkToken();
            }
        };

        window.addEventListener('storage', handleStorageChange);

        // Also poll for changes in the same tab (since storage event doesn't fire in same tab)
        const interval = setInterval(checkToken, 500);

        return () => {
            window.removeEventListener('storage', handleStorageChange);
            clearInterval(interval);
        };
    }, []);

    if (!store) {
        return <LoadingScreen message={localize('Initializing application...')} />;
    }

    const { client } = store;
    const isInitialized = client.is_client_initialized;
    const isLoggedIn = client.is_logged_in;
    const isLoadingUserData = hasToken && isLoggedIn && !isInitialized;

    // Show loading screen when we have a token but user data isn't loaded yet
    if (isLoadingUserData) {
        return <LoadingScreen message={localize('Loading account data...')} />;
    }

    return (
        <AuthContext.Provider value={{ isInitialized, hasToken, isLoadingUserData }}>
            {children}
        </AuthContext.Provider>
    );
});

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
