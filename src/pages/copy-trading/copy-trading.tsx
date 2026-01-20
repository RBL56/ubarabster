import React, { useCallback,useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Localize } from '@deriv-com/translations';
import './copy-trading.scss';

// Configuration
const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';
const BASE_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 60000;
const MIN_DELAY_MS = 600;

interface AccountState {
    socket: WebSocket | null;
    status: 'inactive' | 'connecting' | 'active' | 'retrying';
    loginid: string;
    balance: string;
    currency: string;
    isVirtual: boolean;
    reconnectAttempts: number;
}

interface ClientAccount extends AccountState {
    token: string;
    masked: string;
}

interface Notification {
    id: number;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
}

const CopyTrading = observer(() => {
    // -- State --
    const [master, setMaster] = useState<AccountState>({
        socket: null,
        status: 'inactive',
        loginid: '—',
        balance: '—',
        currency: '',
        isVirtual: false,
        reconnectAttempts: 0,
    });

    const [secondary, setSecondary] = useState<AccountState>({
        socket: null,
        status: 'inactive',
        loginid: '—',
        balance: '—',
        currency: '',
        isVirtual: false,
        reconnectAttempts: 0,
    });

    const [clients, setClients] = useState<ClientAccount[]>([]);
    const [isCopying, setIsCopying] = useState(false);
    const [copyToClients, setCopyToClients] = useState(true);
    const [copyToSecondary, setCopyToSecondary] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);

    // Risk Controls
    const [maxStakePercent, setMaxStakePercent] = useState(5);
    const [dailyLossLimit, setDailyLossLimit] = useState(10);
    const [stakeMultiplier, setStakeMultiplier] = useState(1);

    // Refs for real-time logic
    const masterSocketRef = useRef<WebSocket | null>(null);
    const secondarySocketRef = useRef<WebSocket | null>(null);
    const clientSocketsRef = useRef<Map<string, WebSocket>>(new Map());
    const recentTxRef = useRef<Set<string>>(new Set());
    const lastRequestTimeRef = useRef<number>(0);
    const dailyStartBalanceRef = useRef<Record<string, number>>({});

    // -- Utilities --
    const addNotification = useCallback((message: string, type: Notification['type'] = 'info') => {
        const id = Date.now();
        setNotifications(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 5000);
    }, []);

    const maskToken = (t: string) => {
        return t.length > 12 ? t.slice(0, 6) + '••••••••••••' + t.slice(-6) : '••••••••••••';
    };

    const getReconnectDelay = (attempts: number) => {
        return Math.min(BASE_RECONNECT_DELAY * Math.pow(1.8, attempts), MAX_RECONNECT_DELAY);
    };

    // -- WebSocket Handlers --

    const connectMaster = useCallback(
        (token: string) => {
            if (masterSocketRef.current) masterSocketRef.current.close();

            const ws = new WebSocket(WS_URL);
            masterSocketRef.current = ws;
            setMaster(prev => ({ ...prev, socket: ws, status: 'connecting' }));

            ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

            ws.onmessage = e => {
                const d = JSON.parse(e.data);
                if (d.error) {
                    addNotification(`Master Error: ${d.error.message}`, 'error');
                    return;
                }

                if (d.authorize) {
                    const acc = d.authorize;
                    setMaster(prev => ({
                        ...prev,
                        status: 'active',
                        loginid: acc.loginid,
                        balance: `${acc.balance.toFixed(2)} ${acc.currency}`,
                        currency: acc.currency,
                        isVirtual: !!acc.is_virtual,
                        reconnectAttempts: 0,
                    }));
                    dailyStartBalanceRef.current[acc.loginid] = acc.balance;
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    ws.send(JSON.stringify({ transaction: 1, subscribe: 1 }));
                    addNotification(`Master Connected: ${acc.loginid}`, 'success');
                }

                if (d.balance) {
                    setMaster(prev => ({ ...prev, balance: `${d.balance.balance.toFixed(2)} ${d.balance.currency}` }));
                }

                if (d.transaction && d.transaction.action_type === 'buy') {
                    handleMasterTrade(d.transaction);
                }
            };

            ws.onclose = () => {
                setMaster(prev => ({ ...prev, status: 'inactive', socket: null }));
                setIsCopying(false);
            };
        },
        [addNotification]
    );

    const connectSecondary = useCallback(
        (token: string) => {
            if (secondarySocketRef.current) secondarySocketRef.current.close();

            const ws = new WebSocket(WS_URL);
            secondarySocketRef.current = ws;
            setSecondary(prev => ({ ...prev, socket: ws, status: 'connecting' }));

            ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

            ws.onmessage = e => {
                const d = JSON.parse(e.data);
                if (d.error) {
                    addNotification(`Secondary Error: ${d.error.message}`, 'error');
                    return;
                }

                if (d.authorize) {
                    const acc = d.authorize;
                    setSecondary(prev => ({
                        ...prev,
                        status: 'active',
                        loginid: acc.loginid,
                        balance: `${acc.balance.toFixed(2)} ${acc.currency}`,
                        currency: acc.currency,
                        isVirtual: !!acc.is_virtual,
                        reconnectAttempts: 0,
                    }));
                    dailyStartBalanceRef.current[acc.loginid] = acc.balance;
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    addNotification(`Secondary Connected: ${acc.loginid}`, 'success');
                }

                if (d.balance) {
                    setSecondary(prev => ({
                        ...prev,
                        balance: `${d.balance.balance.toFixed(2)} ${d.balance.currency}`,
                    }));
                }
            };

            ws.onclose = () => {
                setSecondary(prev => ({ ...prev, status: 'inactive', socket: null }));
            };
        },
        [addNotification]
    );

    const connectClient = useCallback(
        (token: string, index: number) => {
            const existing = clientSocketsRef.current.get(token);
            if (existing) existing.close();

            const ws = new WebSocket(WS_URL);
            clientSocketsRef.current.set(token, ws);

            setClients(prev => {
                const next = [...prev];
                if (next[index]) next[index] = { ...next[index], status: 'connecting', socket: ws };
                return next;
            });

            ws.onopen = () => ws.send(JSON.stringify({ authorize: token }));

            ws.onmessage = e => {
                const d = JSON.parse(e.data);
                if (d.error) {
                    addNotification(`Client Error: ${d.error.message}`, 'error');
                    return;
                }

                if (d.authorize) {
                    const acc = d.authorize;
                    setClients(prev => {
                        const next = [...prev];
                        if (next[index]) {
                            next[index] = {
                                ...next[index],
                                status: 'active',
                                loginid: acc.loginid,
                                balance: `${acc.balance.toFixed(2)} ${acc.currency}`,
                                currency: acc.currency,
                                isVirtual: !!acc.is_virtual,
                                reconnectAttempts: 0,
                            };
                        }
                        return next;
                    });
                    dailyStartBalanceRef.current[acc.loginid] = acc.balance;
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    addNotification(`Client Connected: ${acc.loginid}`, 'success');
                }

                if (d.balance) {
                    setClients(prev => {
                        const next = [...prev];
                        if (next[index]) next[index].balance = `${d.balance.balance.toFixed(2)} ${d.balance.currency}`;
                        return next;
                    });
                }
            };

            ws.onclose = () => {
                setClients(prev => {
                    const next = [...prev];
                    if (next[index]) next[index].status = 'inactive';
                    return next;
                });
            };
        },
        [addNotification]
    );

    // -- Trade Logic --

    const proposalThenBuy = async (ws: WebSocket, account: any, masterTx: any, accountName = '') => {
        if (!ws || ws.readyState !== 1) return false;

        const multiplier = stakeMultiplier || 1;
        let safeAmount = (masterTx.amount || masterTx.buy_price || 10) * multiplier;

        const balanceVal = parseFloat(account.balance.split(' ')[0]) || 0;
        const maxStake = (balanceVal * maxStakePercent) / 100;
        safeAmount = Math.min(safeAmount, maxStake);

        const proposalReq = {
            proposal: 1,
            amount: safeAmount,
            basis: masterTx.basis || 'stake',
            contract_type: masterTx.contract_type,
            currency: account.currency || 'USD',
            symbol: masterTx.symbol,
            duration: masterTx.duration || 5,
            duration_unit: masterTx.duration_unit || 't',
        };

        const reqId = Date.now() + Math.random();

        return new Promise(resolve => {
            const onMsg = (e: MessageEvent) => {
                const d = JSON.parse(e.data);
                if (d.req_id === reqId) {
                    ws.removeEventListener('message', onMsg);
                    if (d.error) {
                        addNotification(
                            `Proposal failed for ${accountName || account.loginid}: ${d.error.message}`,
                            'error'
                        );
                        resolve(false);
                    } else if (d.proposal?.id) {
                        ws.send(
                            JSON.stringify({ buy: d.proposal.id, price: d.proposal.ask_price || proposalReq.amount })
                        );
                        addNotification(`Copied to ${account.loginid} ($${safeAmount.toFixed(2)})`, 'success');
                        resolve(true);
                    }
                }
            };
            ws.addEventListener('message', onMsg);
            ws.send(JSON.stringify({ ...proposalReq, req_id: reqId }));
        });
    };

    const handleMasterTrade = useCallback(
        (tx: any) => {
            if (!isCopying) return;
            const txId = tx.transaction_id || tx.contract_id;
            if (!txId || recentTxRef.current.has(txId)) return;

            recentTxRef.current.add(txId);
            setTimeout(() => recentTxRef.current.delete(txId), 300000);

            // Copy to Secondary
            if (master.isVirtual && copyToSecondary && secondarySocketRef.current?.readyState === 1) {
                proposalThenBuy(secondarySocketRef.current, secondary, tx, 'Your Real Account');
            }

            // Copy to Clients
            if (copyToClients) {
                const eligibleClients = clients.filter(c => c.status === 'active' && !c.isVirtual);
                eligibleClients.forEach((client, idx) => {
                    setTimeout(async () => {
                        const ws = clientSocketsRef.current.get(client.token);
                        if (ws) {
                            const now = Date.now();
                            const delay = Math.max(0, lastRequestTimeRef.current + MIN_DELAY_MS - now);
                            if (delay > 0) await new Promise(r => setTimeout(r, delay));
                            await proposalThenBuy(ws, client, tx);
                            lastRequestTimeRef.current = Date.now();
                        }
                    }, idx * 800);
                });
            }
        },
        [
            isCopying,
            master.isVirtual,
            copyToSecondary,
            copyToClients,
            clients,
            secondary,
            stakeMultiplier,
            maxStakePercent,
            addNotification,
        ]
    );

    // -- Lifecycle --
    useEffect(() => {
        const savedMaster = localStorage.getItem('master_token');
        const savedSecondary = localStorage.getItem('secondary_token');
        if (savedMaster) connectMaster(savedMaster);
        if (savedSecondary) connectSecondary(savedSecondary);

        return () => {
            masterSocketRef.current?.close();
            secondarySocketRef.current?.close();
            clientSocketsRef.current.forEach(ws => ws.close());
        };
    }, []);

    // -- render helpers --
    const getMasterStatusIcon = () => {
        if (master.status === 'active') return <i className='fas fa-check-circle'></i>;
        if (master.status === 'connecting') return <i className='fas fa-spinner fa-spin'></i>;
        return <i className='fas fa-times-circle'></i>;
    };

    const getSecondaryStatusIcon = () => {
        if (secondary.status === 'active') return <i className='fas fa-check-circle'></i>;
        if (secondary.status === 'connecting') return <i className='fas fa-spinner fa-spin'></i>;
        return <i className='fas fa-times-circle'></i>;
    };

    return (
        <div className='copy-trading-page'>
            <div className='container'>
                <div className='master-section'>
                    <div className='card'>
                        <div className='card-title'>
                            <i className='fas fa-crown'></i>
                            Master Account (Signal Source)
                            <span className={`account-type-badge ${master.isVirtual ? 'demo' : 'real'}`}>
                                {master.isVirtual ? 'DEMO' : 'REAL'}
                            </span>
                        </div>

                        <div
                            className={`status-indicator ${master.status === 'active' ? 'active' : master.status === 'connecting' ? 'connecting' : 'inactive'}`}
                        >
                            {getMasterStatusIcon()}{' '}
                            {master.status === 'active'
                                ? 'Connected'
                                : master.status === 'connecting'
                                  ? 'Connecting...'
                                  : 'Not Connected'}
                        </div>

                        <div style={{ margin: '12px 0 0', lineHeight: 1.5 }}>
                            <strong>LoginID:</strong> {master.loginid}
                            <br />
                            <strong>Balance:</strong> {master.balance}
                            <br />
                            <strong>Type:</strong> {master.isVirtual ? 'DEMO' : 'REAL'}
                        </div>

                        <div style={{ marginTop: '12px' }}>
                            <input
                                type='text'
                                id='masterTokenInput'
                                placeholder='Paste Master API Token...'
                                onKeyPress={e => {
                                    if (e.key === 'Enter') {
                                        const token = e.currentTarget.value.trim();
                                        if (token) {
                                            localStorage.setItem('master_token', token);
                                            connectMaster(token);
                                        }
                                    }
                                }}
                            />
                            <button
                                className='btn btn-primary'
                                style={{ width: '100%' }}
                                onClick={() => {
                                    const input = document.getElementById('masterTokenInput') as HTMLInputElement;
                                    const token = input.value.trim();
                                    if (token) {
                                        localStorage.setItem('master_token', token);
                                        connectMaster(token);
                                    } else {
                                        addNotification('Master token required', 'error');
                                    }
                                }}
                            >
                                <i className='fas fa-plug'></i> Connect Master Account
                            </button>
                        </div>
                    </div>

                    <div className='card secondary-account' style={{ display: master.isVirtual ? 'block' : 'none' }}>
                        <div className='card-title'>
                            <i className='fas fa-exchange-alt'></i>
                            Your Real Account (Execution Target)
                        </div>

                        <div
                            className={`status-indicator ${secondary.status === 'active' ? 'active' : secondary.status === 'connecting' ? 'connecting' : 'inactive'}`}
                        >
                            {getSecondaryStatusIcon()}{' '}
                            {secondary.status === 'active'
                                ? 'Connected'
                                : secondary.status === 'connecting'
                                  ? 'Connecting...'
                                  : 'Not Connected'}
                        </div>

                        <div style={{ margin: '12px 0 0', lineHeight: 1.5 }}>
                            <strong>LoginID:</strong> {secondary.loginid}
                            <br />
                            <strong>Balance:</strong> {secondary.balance}
                            <br />
                            <strong>Type:</strong> REAL
                        </div>

                        <div style={{ marginTop: '12px' }}>
                            <input
                                type='text'
                                id='secondaryTokenInput'
                                placeholder='Paste Real Account Token...'
                                onKeyPress={e => {
                                    if (e.key === 'Enter') {
                                        const token = e.currentTarget.value.trim();
                                        if (token) {
                                            localStorage.setItem('secondary_token', token);
                                            connectSecondary(token);
                                        }
                                    }
                                }}
                            />
                            <button
                                className='btn btn-warning'
                                style={{ width: '100%' }}
                                onClick={() => {
                                    const input = document.getElementById('secondaryTokenInput') as HTMLInputElement;
                                    const token = input.value.trim();
                                    if (token) {
                                        localStorage.setItem('secondary_token', token);
                                        connectSecondary(token);
                                    } else {
                                        addNotification('Secondary token required', 'error');
                                    }
                                }}
                            >
                                <i className='fas fa-plug'></i> Connect Real Account
                            </button>
                        </div>
                    </div>
                </div>

                <div className='card'>
                    <div className='card-title'>
                        <i className='fas fa-cogs'></i> Copy Trading Modes
                    </div>

                    <div className='mode-description'>
                        {master.status === 'active' ? (
                            <>
                                <strong>{master.isVirtual ? 'Demo' : 'Real'} Master Detected:</strong>
                                {master.isVirtual
                                    ? ' You can copy trades from your demo account to your real account and/or client accounts.'
                                    : ' Copy trading from your real account to client accounts only.'}
                            </>
                        ) : (
                            'Please connect your master account to see available copying options.'
                        )}
                    </div>

                    {master.status === 'active' && (
                        <div className='mode-section'>
                            <div className='mode-toggle'>
                                <input
                                    type='checkbox'
                                    id='copyToClientsCheckbox'
                                    checked={copyToClients}
                                    onChange={e => setCopyToClients(e.target.checked)}
                                />
                                <label htmlFor='copyToClientsCheckbox'>Copy to Client Accounts</label>
                            </div>

                            {master.isVirtual && (
                                <div className='mode-toggle'>
                                    <input
                                        type='checkbox'
                                        id='copyToSecondaryCheckbox'
                                        disabled={secondary.status !== 'active'}
                                        checked={copyToSecondary && secondary.status === 'active'}
                                        onChange={e => setCopyToSecondary(e.target.checked)}
                                    />
                                    <label htmlFor='copyToSecondaryCheckbox'>Copy to My Real Account</label>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', margin: '20px 0' }}>
                        <button
                            className='btn btn-primary'
                            disabled={isCopying || master.status !== 'active'}
                            onClick={() => {
                                setIsCopying(true);
                                addNotification('Copy trading engine started', 'success');
                            }}
                        >
                            <i className='fas fa-play'></i> Start Copying
                        </button>
                        <button
                            className='btn btn-danger'
                            disabled={!isCopying}
                            onClick={() => {
                                setIsCopying(false);
                                addNotification('Copy trading stopped', 'info');
                            }}
                        >
                            <i className='fas fa-stop'></i> Stop
                        </button>
                    </div>

                    <div style={{ marginTop: '16px', fontWeight: 500, fontSize: '1.4rem' }}>
                        Trading Status:{' '}
                        <span style={{ color: isCopying ? 'var(--success)' : 'var(--danger)' }}>
                            {isCopying ? 'Active' : 'Not active'}
                        </span>
                    </div>

                    <div className='risk-controls'>
                        <div className='risk-input'>
                            <label>Max Stake %</label>
                            <input
                                type='number'
                                value={maxStakePercent}
                                onChange={e => setMaxStakePercent(parseFloat(e.target.value))}
                                min='1'
                                max='20'
                                step='0.5'
                            />
                        </div>
                        <div className='risk-input'>
                            <label>Daily Loss Limit %</label>
                            <input
                                type='number'
                                value={dailyLossLimit}
                                onChange={e => setDailyLossLimit(parseFloat(e.target.value))}
                                min='1'
                                max='50'
                                step='1'
                            />
                        </div>
                        <div className='risk-input'>
                            <label>Stake Multiplier</label>
                            <input
                                type='number'
                                value={stakeMultiplier}
                                onChange={e => setStakeMultiplier(parseFloat(e.target.value))}
                                min='0.1'
                                max='5'
                                step='0.1'
                            />
                        </div>
                    </div>
                </div>

                <div className='card'>
                    <div className='card-title'>
                        <i className='fas fa-plus-circle'></i> Add Client Token
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
                        <input
                            type='text'
                            id='newTokenInput'
                            placeholder='Paste Deriv API token...'
                            style={{ flex: 1, minWidth: '280px' }}
                            onKeyPress={e => {
                                if (e.key === 'Enter') {
                                    const val = e.currentTarget.value.trim();
                                    if (val) {
                                        const newIndex = clients.length;
                                        setClients(prev => [
                                            ...prev,
                                            {
                                                token: val,
                                                masked: maskToken(val),
                                                status: 'connecting',
                                                socket: null,
                                                loginid: '—',
                                                balance: '—',
                                                currency: 'USD',
                                                isVirtual: false,
                                                reconnectAttempts: 0,
                                            },
                                        ]);
                                        connectClient(val, newIndex);
                                        e.currentTarget.value = '';
                                    }
                                }
                            }}
                        />
                        <button
                            className='btn btn-primary'
                            onClick={() => {
                                const input = document.getElementById('newTokenInput') as HTMLInputElement;
                                const val = input.value.trim();
                                if (val) {
                                    const newIndex = clients.length;
                                    setClients(prev => [
                                        ...prev,
                                        {
                                            token: val,
                                            masked: maskToken(val),
                                            status: 'connecting',
                                            socket: null,
                                            loginid: '—',
                                            balance: '—',
                                            currency: 'USD',
                                            isVirtual: false,
                                            reconnectAttempts: 0,
                                        },
                                    ]);
                                    connectClient(val, newIndex);
                                    input.value = '';
                                }
                            }}
                        >
                            Add & Connect
                        </button>
                    </div>
                </div>

                <div className='card'>
                    <div className='card-title'>
                        <i className='fas fa-users'></i> Client Accounts <span>({clients.length})</span>
                    </div>
                    <div>
                        {clients.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '50px', color: '#666', fontSize: '1.4rem' }}>
                                No clients added yet...
                            </div>
                        ) : (
                            clients.map((client, i) => (
                                <div key={i} className='token-item'>
                                    <div
                                        className={`token-status ${client.status === 'active' ? 'connected' : 'connecting'}`}
                                    ></div>
                                    <div style={{ flex: 1 }}>
                                        <div className='masked-token'>{client.masked}</div>
                                        <div className='client-info'>
                                            {client.loginid} • {client.balance} •{' '}
                                            <strong>{client.isVirtual ? 'DEMO' : 'REAL'}</strong>
                                        </div>
                                    </div>
                                    <button
                                        className='remove-btn'
                                        onClick={() => {
                                            const ws = clientSocketsRef.current.get(client.token);
                                            ws?.close();
                                            clientSocketsRef.current.delete(client.token);
                                            setClients(prev => prev.filter((_, idx) => idx !== i));
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {notifications.map(n => (
                <div key={n.id} className={`notification ${n.type}`}>
                    {n.message}
                </div>
            ))}
        </div>
    );
});

export default CopyTrading;
