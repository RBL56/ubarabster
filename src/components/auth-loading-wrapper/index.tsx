import React from 'react';
import { useOauth2 } from '@/hooks/auth/useOauth2';
import useTMB from '@/hooks/useTMB';
import { Loader } from '@deriv-com/ui';

type AuthLoadingWrapperProps = {
    children: React.ReactNode;
};

const AuthLoadingWrapper = ({ children }: AuthLoadingWrapperProps) => {
    const { isSingleLoggingIn } = useOauth2();
    const { isTmbEnabled } = useTMB();
    const [forceComplete, setForceComplete] = React.useState(false);

    const is_tmb_enabled = isTmbEnabled() || window.is_tmb_enabled === true;

    React.useEffect(() => {
        if (isSingleLoggingIn && !is_tmb_enabled) {
            const timeout = setTimeout(() => {
                console.log('[AuthLoadingWrapper] Safety timeout reached, forcing completion');
                setForceComplete(true);
            }, 5000);
            return () => clearTimeout(timeout);
        }
    }, [isSingleLoggingIn, is_tmb_enabled]);

    if (isSingleLoggingIn && !is_tmb_enabled && !forceComplete) {
        return <Loader isFullScreen />;
    }

    return <>{children}</>;
};

export default AuthLoadingWrapper;
