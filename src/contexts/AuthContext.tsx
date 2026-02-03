import React, { createContext, useContext } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import LoadingScreen from '@/components/loading-screen/loading-screen';
import { localize } from '@deriv-com/translations';

interface AuthContextType {
    isInitialized: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = observer(({ children }) => {
    const store = useStore();

    if (!store) {
        return <LoadingScreen message={localize('Initializing application...')} />;
    }

    const { client } = store;
    const isInitialized = client.is_client_initialized;
    const isLoggedIn = client.is_logged_in;

    if (isLoggedIn && !isInitialized) {
        return <LoadingScreen message={localize('Loading account data...')} />;
    }

    return (
        <AuthContext.Provider value={{ isInitialized }}>
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
