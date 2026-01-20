import Cookies from 'js-cookie';
import { Subject } from 'rxjs';
import CommonStore from '@/stores/common-store';
import { TAuthData } from '@/types/api-types';
import { clearAuthData } from '@/utils/auth-utils';
import { observer as globalObserver } from '../../utils/observer';
import { doUntilDone, socket_state } from '../tradeEngine/utils/helpers';
import {
    CONNECTION_STATUS,
    setAccountList,
    setAllAccountsBalance,
    setAuthData,
    setConnectionStatus,
    setIsAuthorized,
    setIsAuthorizing,
} from './observables/connection-status-stream';
import ApiHelpers from './api-helpers';
import { generateDerivApiInstance, V2GetActiveClientId, V2GetActiveToken } from './appId';
import chart_api from './chart-api';

type CurrentSubscription = {
    id: string;
    unsubscribe: () => void;
};

type SubscriptionPromise = Promise<{
    subscription: CurrentSubscription;
}>;

type TApiBaseApi = {
    connection: {
        readyState: keyof typeof socket_state;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
    };
    send: (data: unknown) => void;
    disconnect: () => void;
    authorize: (token: string) => Promise<{ authorize: TAuthData; error: unknown }>;
    getSelfExclusion: () => Promise<unknown>;
    onMessage: () => {
        subscribe: (callback: (message: unknown) => void) => {
            unsubscribe: () => void;
        };
    };
} & ReturnType<typeof generateDerivApiInstance>;

class APIBase {
    api: TApiBaseApi | null = null;
    token: string = '';
    account_id: string = '';
    pip_sizes = {};
    account_info = {};
    is_running = false;
    subscriptions: CurrentSubscription[] = [];
    time_interval: ReturnType<typeof setInterval> | null = null;
    has_active_symbols = false;
    is_stopping = false;
    active_symbols = [];
    current_auth_subscriptions: SubscriptionPromise[] = [];
    is_authorized = false;
    active_symbols_promise: Promise<void> | null = null;
    common_store: CommonStore | undefined;
    landing_company: string | null = null;
    bridge_subject = new Subject<any>();
    bridge_socket: WebSocket | null = null;

    unsubscribeAllSubscriptions = () => {
        this.current_auth_subscriptions?.forEach(subscription_promise => {
            subscription_promise.then(({ subscription }) => {
                if (subscription?.id) {
                    this.api?.send({
                        forget: subscription.id,
                    });
                }
            });
        });
        this.current_auth_subscriptions = [];
    };

    onsocketopen() {
        setConnectionStatus(CONNECTION_STATUS.OPENED);
    }

    onsocketclose() {
        setConnectionStatus(CONNECTION_STATUS.CLOSED);
        this.reconnectIfNotConnected();
    }

    async init(force_create_connection = false) {
        this.toggleRunButton(true);

        if (this.api) {
            this.unsubscribeAllSubscriptions();
        }

        if (!this.api || this.api?.connection.readyState !== 1 || force_create_connection) {
            if (this.api?.connection) {
                ApiHelpers.disposeInstance();
                setConnectionStatus(CONNECTION_STATUS.CLOSED);
                this.api.disconnect();
                this.api.connection.removeEventListener('open', this.onsocketopen.bind(this));
                this.api.connection.removeEventListener('close', this.onsocketclose.bind(this));
            }

            this.has_active_symbols = false;
            this.api = generateDerivApiInstance();
            this.api?.connection.addEventListener('open', this.onsocketopen.bind(this));
            this.api?.connection.addEventListener('close', this.onsocketclose.bind(this));

            // Unified message stream: combine Deriv API messages with Python Bridge messages
            if (this.api) {
                const originalOnMessage = this.api.onMessage.bind(this.api);
                this.api.onMessage = () => ({
                    subscribe: (callback: (message: any) => void) => {
                        const deriv_sub = originalOnMessage().subscribe(callback);
                        const bridge_sub = this.bridge_subject.subscribe(callback);
                        return {
                            unsubscribe: () => {
                                deriv_sub?.unsubscribe();
                                bridge_sub.unsubscribe();
                            },
                        };
                    },
                });

                // Monkey-patch api.send to intercept symbol requests and notify the Python bridge
                const originalSend = this.api.send.bind(this.api);
                this.api.send = (request: any) => {
                    const symbol = request.ticks || request.ticks_history;
                    if (symbol && typeof symbol === 'string') {
                        if (this.bridge_socket && this.bridge_socket.readyState === 1) {
                            // console.log(`[Python Bridge] Notifying symbol change: ${symbol}`);
                            this.bridge_socket.send(JSON.stringify({ action: 'change_symbol', symbol }));
                        }
                    }
                    return originalSend(request);
                };
            }
        }

        if (!this.has_active_symbols) {
            this.active_symbols_promise = this.getActiveSymbols();
        }

        this.initEventListeners();

        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = null;

        if (V2GetActiveToken()) {
            setIsAuthorizing(true);
            await this.authorizeAndSubscribe();
        }

        // Global message listener
        this.api?.onMessage().subscribe(this.handleMessage.bind(this));

        // Periodic connection health check (every 30 seconds)
        if (this.time_interval) clearInterval(this.time_interval);
        this.time_interval = setInterval(() => {
            this.reconnectIfNotConnected();
        }, 30000);

        chart_api.init(force_create_connection);
        this.initPythonBridge();
    }

    initPythonBridge() {
        if (this.bridge_socket && this.bridge_socket.readyState === 1) return;

        // Skip Python bridge initialization if not on localhost to prevent console spam on Vercel/Production
        const isLocal = /localhost(:\d+)?$/i.test(window.location.hostname);
        if (!isLocal) {
            // console.log('[Python Bridge] Skipping initialization on non-localhost environment');
            return;
        }

        try {
            this.bridge_socket = new WebSocket('ws://localhost:8770');
            this.bridge_socket.onmessage = (msg: MessageEvent) => {
                try {
                    const data = JSON.parse(msg.data);
                    this.handleMessage(data);
                    this.bridge_subject.next(data);
                } catch (e) {
                    // console.error('Error parsing bridge message', e);
                }
            };
            this.bridge_socket.onopen = () => {
                // eslint-disable-next-line no-console
                console.log('%c[Python Bridge] Connected to ws://localhost:8770', 'color: #4caf50; font-weight: bold;');
            };
            this.bridge_socket.onclose = () => {
                this.bridge_socket = null;
                setTimeout(() => this.initPythonBridge(), 5000);
            };
            this.bridge_socket.onerror = () => {
                // Silently handle error as it might be frequent if bridge is not running
            };
        } catch (e) {
            // Silently handle error
        }
    }

    handleMessage(response: any) {
        if (response.msg_type === 'balance') {
            console.log('[APIBase] ✓ Balance update received:', {
                balance: response.balance?.balance,
                currency: response.balance?.currency,
                loginid: response.balance?.loginid,
            });
            setAllAccountsBalance(response.balance);
        }
    }

    getConnectionStatus() {
        if (this.api?.connection) {
            const ready_state = this.api.connection.readyState;
            return socket_state[ready_state as keyof typeof socket_state] || 'Unknown';
        }
        return 'Socket not initialized';
    }

    terminate() {
        // eslint-disable-next-line no-console
        if (this.api) this.api.disconnect();
    }

    initEventListeners() {
        if (window) {
            window.addEventListener('online', this.reconnectIfNotConnected);
            window.addEventListener('focus', this.reconnectIfNotConnected);
        }
    }

    async createNewInstance(account_id: string) {
        if (this.account_id !== account_id) {
            await this.init();
        }
    }

    reconnectIfNotConnected = () => {
        const readyState = this.api?.connection?.readyState;
        const stateNames = {
            0: 'CONNECTING',
            1: 'OPEN',
            2: 'CLOSING',
            3: 'CLOSED'
        };

        console.log('[APIBase] Connection check:', {
            readyState,
            stateName: stateNames[readyState as keyof typeof stateNames] || 'UNKNOWN',
            needsReconnect: readyState !== undefined && readyState > 1
        });

        if (readyState !== undefined && readyState > 1) {
            console.log('%c[APIBase] Connection lost - attempting to reconnect...', 'color: #ff9800; font-weight: bold');

            // Add a small delay before reconnecting to avoid rapid reconnection attempts
            setTimeout(() => {
                this.init(true);
            }, 1000);
        } else if (readyState === 1) {
            console.log('[APIBase] Connection is healthy (OPEN)');
        }
    };

    async authorizeAndSubscribe() {
        const token = V2GetActiveToken();
        if (!token || !this.api) {
            console.log('[APIBase] No token or API instance, skipping authorization');
            return;
        }

        console.log('[APIBase] Starting authorization with token:', token.substring(0, 8) + '...');
        this.token = token;
        this.account_id = V2GetActiveClientId() ?? 'MANUAL';
        setIsAuthorizing(true);
        setIsAuthorized(false);

        try {
            // Add a timeout to the authorize call
            const authPromise = this.api.authorize(this.token);
            const timeoutPromise = new Promise(
                (_, reject) => setTimeout(() => reject(new Error('Authorization timed out')), 15000) // Increased to 15s
            );

            const { authorize, error } = (await Promise.race([authPromise, timeoutPromise])) as any;

            if (error) {
                console.error('[APIBase] Authorization error response:', error);
                if (error.code === 'InvalidToken') {
                    const is_tmb_enabled = window.is_tmb_enabled === true;
                    // Standard InvalidToken handling - trigger logout/re-login flow
                    if (Cookies.get('logged_state') === 'true' && !is_tmb_enabled) {
                        globalObserver.emit('InvalidToken', { error });
                    }
                }
                setIsAuthorizing(false);
                return error;
            }

            console.log('[APIBase] ✓ Authorization successful!');

            if (authorize.balance !== undefined) {
                setAllAccountsBalance({
                    balance: authorize.balance,
                    currency: authorize.currency,
                    loginid: authorize.loginid,
                    accounts: {
                        [authorize.loginid]: {
                            balance: authorize.balance,
                            currency: authorize.currency,
                        },
                    },
                } as any);
            }


            // Sync localStorage with authorized details if missing or mismatched
            const currentLoginId = localStorage.getItem('active_loginid');
            if (authorize.loginid && currentLoginId !== authorize.loginid) {
                console.log('[APIBase] Updating session for:', authorize.loginid);
                localStorage.setItem('active_loginid', authorize.loginid);
                localStorage.setItem('authToken', this.token);
                localStorage.setItem('accountsList', JSON.stringify({ [authorize.loginid]: this.token }));

                // Update client accounts data
                const clientAccount = {
                    token: this.token,
                    currency: authorize.currency,
                    landing_company_name: authorize.landing_company_name,
                    is_virtual: authorize.is_virtual,
                    loginid: authorize.loginid,
                    email: authorize.email,
                    balance: authorize.balance,
                    residence: authorize.country,
                };
                localStorage.setItem('clientAccounts', JSON.stringify({ [authorize.loginid]: clientAccount }));

                // We do NOT reload here to avoid potential loops.
                // The app should react to the store updates or we rely on the next refresh.
            }

            console.log('[APIBase] Login ID:', authorize?.loginid);
            console.log('[APIBase] Currency:', authorize?.currency);
            console.log('[APIBase] Initial Balance:', authorize?.balance);

            this.account_info = authorize;
            setAccountList(authorize?.account_list || []);
            setAuthData(authorize);
            setIsAuthorized(true);
            this.is_authorized = true;
            localStorage.setItem('client_account_details', JSON.stringify(authorize?.account_list));
            localStorage.setItem('client.country', authorize?.country);

            if (this.has_active_symbols) {
                this.toggleRunButton(false);
            } else {
                this.active_symbols_promise = this.getActiveSymbols();
            }

            // Subscribe to balance and other streams
            console.log('[APIBase] Setting up subscriptions...');
            await this.subscribe();

            // Explicitly request balance update
            console.log('[APIBase] Requesting balance update...');
        } catch (e: any) {
            console.error('[APIBase] Authorization failed with exception:', e);
            // Only clear and fail if it's NOT a timeout
            if (e.message !== 'Authorization timed out') {
                this.is_authorized = false;
                setIsAuthorized(false);
                globalObserver.emit('Error', e);
            } else {
                console.warn('[APIBase] Authorization timed out - this may be a network issue');
            }
        } finally {
            setIsAuthorizing(false);
        }
    }

    async getSelfExclusion() {
        if (!this.api || !this.is_authorized) return;
        await this.api.getSelfExclusion();
        // TODO: fix self exclusion
    }

    async subscribe() {
        const subscribeToStream = (streamName: string) => {
            return doUntilDone(
                () => {
                    const subscription = this.api?.send({
                        [streamName]: 1,
                        subscribe: 1,
                        ...(streamName === 'balance' ? { account: 'all' } : {}),
                    });
                    if (subscription) {
                        this.current_auth_subscriptions.push(subscription);
                    }
                    return subscription;
                },
                [],
                this
            );
        };

        const streamsToSubscribe = ['balance', 'transaction', 'proposal_open_contract'];

        await Promise.all(streamsToSubscribe.map(subscribeToStream));
    }

    getActiveSymbols = async () => {
        await doUntilDone(() => this.api?.send({ active_symbols: 'brief' }), [], this).then(
            ({ active_symbols = [], error = {} }) => {
                const pip_sizes = {};
                if (active_symbols.length) this.has_active_symbols = true;
                active_symbols.forEach(({ symbol, pip }: { symbol: string; pip: string }) => {
                    (pip_sizes as Record<string, number>)[symbol] = +(+pip).toExponential().substring(3);
                });
                this.pip_sizes = pip_sizes as Record<string, number>;
                this.toggleRunButton(false);
                this.active_symbols = active_symbols;
                return active_symbols || error;
            }
        );
    };

    toggleRunButton = (toggle: boolean) => {
        const run_button = document.querySelector('#db-animation__run-button');
        if (!run_button) return;
        (run_button as HTMLButtonElement).disabled = toggle;
    };

    setIsRunning(toggle = false) {
        this.is_running = toggle;
    }

    pushSubscription(subscription: CurrentSubscription) {
        this.subscriptions.push(subscription);
    }

    clearSubscriptions() {
        this.subscriptions.forEach(s => s.unsubscribe());
        this.subscriptions = [];

        // Resetting timeout resolvers
        const global_timeouts = globalObserver.getState('global_timeouts') ?? [];

        global_timeouts.forEach((_: unknown, i: number) => {
            clearTimeout(i);
        });
    }
}

export const api_base = new APIBase();
