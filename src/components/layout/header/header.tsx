import { useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL, getAppId, standalone_routes } from '@/components/shared';
import Button from '@/components/shared_ui/button';
import Modal from '@/components/shared_ui/modal';
import Text from '@/components/shared_ui/text';
import useActiveAccount from '@/hooks/api/account/useActiveAccount';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import useTMB from '@/hooks/useTMB';
import { useFirebaseCountriesConfig } from '@/hooks/firebase/useFirebaseCountriesConfig';
import { clearAuthData, handleOidcAuthFailure } from '@/utils/auth-utils';
import { requestOidcAuthentication } from '@deriv-com/auth-client';
import { Localize, useTranslations } from '@deriv-com/translations';
import { Header, useDevice, Wrapper } from '@deriv-com/ui';
import { AppLogo } from '../app-logo';
import AccountSwitcher from './account-switcher';
import MobileMenu from './mobile-menu';

import './header.scss';

const AppHeader = observer(() => {
    const { isDesktop } = useDevice();
    const { activeLoginid } = useApiBase();
    const { client } = useStore() ?? {};
    const { hubEnabledCountryList } = useFirebaseCountriesConfig();

    const { data: activeAccount } = useActiveAccount({ allBalanceData: client?.all_accounts_balance });
    const { accounts, getCurrency, is_virtual, all_loginids, switchAccount } = client ?? {};
    const has_wallet = Object.keys(accounts ?? {}).some(id => accounts?.[id].account_category === 'wallet');

    const virtual_account = all_loginids?.find(id => accounts?.[id]?.is_virtual);
    const real_account = all_loginids?.find(id => !accounts?.[id]?.is_virtual);

    const currency = getCurrency?.();
    const { localize } = useTranslations();

    const { onRenderTMBCheck, isTmbEnabled } = useTMB();
    const [apiToken, setApiToken] = useState('');

    const [isApiModalOpen, setIsApiModalOpen] = useState(false);


    const handleApiTokenLogin = async () => {
        const token = apiToken.trim();
        if (!token) return;
        console.log('Starting API Token Login...');
        try {
            // Use dynamic app_id from config
            const app_id = getAppId();
            const server_url = 'ws.derivws.com';
            const socket_url = `wss://${server_url}/websockets/v3?app_id=${app_id}&l=EN&brand=deriv`;

            console.log(`Connecting to WebSocket: ${socket_url}`);
            const ws = new WebSocket(socket_url);

            ws.onopen = () => {
                console.log('WebSocket Connected. Sending authorize...');
                ws.send(JSON.stringify({ authorize: token }));
            };

            ws.onmessage = msg => {
                console.log('WebSocket Message Received:', msg.data);
                const response = JSON.parse(msg.data);
                if (response.error) {
                    console.error('Login Failed Error:', response.error);
                    alert(`Login Failed: ${response.error.message} (Code: ${response.error.code})`);
                    ws.close();
                } else if (response.msg_type === 'authorize') {
                    console.log('Authorization Success:', response);
                    const { authorize } = response;
                    const { loginid, landing_company_name, email, balance, country } = authorize;

                    // Set standard storage items expected by the app
                    localStorage.setItem('config.app_id', app_id.toString());
                    localStorage.setItem('active_loginid', loginid);
                    localStorage.setItem('authToken', token);
                    localStorage.setItem('is_manual_auth', 'true');
                    localStorage.setItem(
                        'accountsList',
                        JSON.stringify({
                            [loginid]: token,
                        })
                    );

                    // Populate clientAccounts with comprehensive data
                    const clientAccount = {
                        token: token,
                        currency: authorize.currency,
                        landing_company_name: landing_company_name,
                        is_virtual: !!authorize.is_virtual, // Ensure boolean
                        loginid: loginid,
                        email: email,
                        balance: balance,
                        residence: country,
                    };

                    localStorage.setItem(
                        'clientAccounts',
                        JSON.stringify({
                            [loginid]: clientAccount,
                        })
                    );

                    // Dispatch storage event to notify other components/tabs
                    window.dispatchEvent(new Event('storage'));

                    console.log('Session stored. Reloading...');
                    ws.close();

                    // Reload to initialize stores with new session
                    window.location.reload();
                }
            };
            ws.onclose = e => {
                console.log('WebSocket Closed:', e);
            };
            ws.onerror = e => {
                console.error('WebSocket Connection Error:', e);
                alert('WebSocket Connection Error. Please check your internet connection.');
            };
        } catch (error) {
            console.error('API Token Login Catch Error:', error);
            alert(`An error occurred: ${error}`);
        }
    };

    // No need for additional state management here since we're handling it in the layout component

    if (client?.should_hide_header) return null;
    return (
        <Header
            className={clsx('app-header', {
                'app-header--desktop': isDesktop,
                'app-header--mobile': !isDesktop,
            })}
        >
            <Wrapper variant='left'>
                {!isDesktop && <MobileMenu onOpenApiModal={() => setIsApiModalOpen(true)} />}
                <AppLogo />
            </Wrapper>
            <Wrapper variant='right'>
                {activeLoginid && (
                    <>
                        {isDesktop && (
                            <>
                                {has_wallet ? (
                                    <Button
                                        className='manage-funds-button'
                                        has_effect
                                        text={localize('Manage funds')}
                                        onClick={() => {
                                            let redirect_url = new URL(standalone_routes.wallets_transfer);
                                            const is_hub_enabled_country = hubEnabledCountryList.includes(
                                                client?.residence || ''
                                            );
                                            if (is_hub_enabled_country) {
                                                redirect_url = new URL(standalone_routes.recent_transactions);
                                            }
                                            if (is_virtual) {
                                                redirect_url.searchParams.set('account', 'demo');
                                            } else if (currency) {
                                                redirect_url.searchParams.set('account', currency);
                                            }
                                            window.location.assign(redirect_url.toString());
                                        }}
                                        primary
                                    />
                                ) : null}



                                <Button
                                    tertiary
                                    onClick={() => {
                                        client.logout();
                                    }}
                                    className='logout-button'
                                >
                                    <Localize i18n_default_text='Log out' />
                                </Button>
                            </>
                        )}
                        {is_virtual ? (
                            real_account && (
                                <Button
                                    secondary
                                    onClick={() => switchAccount?.(real_account)}
                                    className='quick-switch-button'
                                >
                                    <Localize i18n_default_text='Switch to Real' />
                                </Button>
                            )
                        ) : (
                            virtual_account && (
                                <Button
                                    secondary
                                    onClick={() => switchAccount?.(virtual_account)}
                                    className='quick-switch-button'
                                >
                                    <Localize i18n_default_text='Switch to Demo' />
                                </Button>
                            )
                        )}
                        <AccountSwitcher activeAccount={activeAccount} />
                    </>
                )}
                <div className='auth-actions'>
                    {!activeLoginid ? (
                        <>
                            <Button
                                primary
                                onClick={async () => {
                                    clearAuthData(false);
                                    const getQueryParams = new URLSearchParams(window.location.search);
                                    const currency = getQueryParams.get('account') ?? '';
                                    const query_param_currency =
                                        currency || sessionStorage.getItem('query_param_currency') || 'USD';

                                    try {
                                        const tmbEnabled = await isTmbEnabled();
                                        if (tmbEnabled) {
                                            await onRenderTMBCheck(true);
                                        } else {
                                            try {
                                                await requestOidcAuthentication({
                                                    redirectCallbackUri: `${window.location.origin}/callback`,
                                                    ...(query_param_currency
                                                        ? {
                                                            state: {
                                                                account: query_param_currency,
                                                            },
                                                        }
                                                        : {}),
                                                });
                                            } catch (err) {
                                                handleOidcAuthFailure(err);
                                                window.location.replace(generateOAuthURL());
                                            }
                                        }
                                    } catch (error) {
                                        console.error(error);
                                    }
                                }}
                            >
                                <Localize i18n_default_text='Log in' />
                            </Button>
                            <Button secondary onClick={() => setIsApiModalOpen(true)} className='api-token-button'>
                                <Localize i18n_default_text='API Token' />
                            </Button>
                            <Button
                                primary
                                onClick={() => {
                                    window.open(standalone_routes.signup);
                                }}
                            >
                                <Localize i18n_default_text='Sign up' />
                            </Button>
                        </>
                    ) : null}
                </div>
            </Wrapper>

            {isApiModalOpen && (
                <Modal
                    is_open={isApiModalOpen}
                    toggleModal={() => setIsApiModalOpen(false)}
                    has_close_icon
                    title='Login with API Token'
                    width='440px'
                >
                    <Modal.Body>
                        <div
                            className='api-token-modal-content'
                            style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem' }}
                        >
                            <Text size='xs' lineHeight='m'>
                                Enter your Deriv API token to login. You can create an API token from your Deriv account
                                settings.
                            </Text>
                            <Button
                                primary
                                onClick={async () => {
                                    clearAuthData(false);
                                    window.location.replace(generateOAuthURL());
                                }}
                                style={{ width: '100%' }}
                            >
                                <Localize i18n_default_text='Log in via Deriv (Fast & Real-time)' />
                            </Button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.8rem 0' }}>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border-normal)' }}></div>
                                <Text size='xs' color='less-prominent'>
                                    or use API Token
                                </Text>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border-normal)' }}></div>
                            </div>
                            <input
                                type='text'
                                placeholder='API Token'
                                value={apiToken}
                                onChange={e => setApiToken(e.target.value)}
                                style={{
                                    padding: '1rem',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-normal)',
                                    width: '100%',
                                    fontSize: '1.4rem',
                                }}
                            />
                            <a
                                href='https://app.deriv.com/account/api-token'
                                target='_blank'
                                rel='noopener noreferrer'
                                style={{
                                    color: 'var(--text-loss-danger)',
                                    fontSize: '1.2rem',
                                    textDecoration: 'none',
                                }}
                            >
                                Get your API token from Deriv API Token Settings
                            </a>
                        </div>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button
                            has_effect
                            text={localize('Cancel')}
                            onClick={() => setIsApiModalOpen(false)}
                            secondary
                            large
                        />
                        <Button
                            has_effect
                            text={localize('Login')}
                            onClick={handleApiTokenLogin}
                            primary
                            large
                            is_disabled={!apiToken}
                        />
                    </Modal.Footer>
                </Modal>
            )}



        </Header>
    );
});

export default AppHeader;
