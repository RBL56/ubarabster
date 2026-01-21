import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { api_base, observer as botObserver } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import './speed-bot.scss';

// Transaction Type
type Transaction = {
    id: number;
    ref: string;
    contract_type: string;
    stake: number;
    payout: number;
    profit: string;
    status: 'pending' | 'won' | 'lost' | 'running';
    timestamp: number;
};

const SpeedBot = observer(() => {
    // -- State --
    const [volatility, setVolatility] = useState('R_10');
    const [tradeType, setTradeType] = useState('DIGITMATCH');
    const [ticks, setTicks] = useState(1);
    const [stake, setStake] = useState(0.5);

    // Bulk
    const [bulkEnabled, setBulkEnabled] = useState(false);
    const [bulkTrades, setBulkTrades] = useState(1);

    // Entry
    const [entryEnabled, setEntryEnabled] = useState(false);
    const [entryPoint, setEntryPoint] = useState('single');
    const [digitRangeStart, setDigitRangeStart] = useState(0);
    const [digitRangeEnd, setDigitRangeEnd] = useState(9);

    // Prediction
    const [predictionMode, setPredictionMode] = useState('single');
    const [singleDigit, setSingleDigit] = useState(5);
    const [singleStake, setSingleStake] = useState(0.5);
    const [predPre, setPredPre] = useState<string | number>(5);
    const [predPost, setPredPost] = useState<string | number>(7);
    const [predictions, setPredictions] = useState<{ digit: number; stake: number; id: number }[]>([]);

    // Martingale
    const [martingaleEnabled, setMartingaleEnabled] = useState(true);
    const [martingaleMultiplier, setMartingaleMultiplier] = useState(1.2);

    // Limits
    const [stopLossTotalEnabled, setStopLossTotalEnabled] = useState(true);
    const [stopLossTotal, setStopLossTotal] = useState(-40);
    const [stopLossConsecutiveEnabled, setStopLossConsecutiveEnabled] = useState(true);
    const [stopLossConsecutive, setStopLossConsecutive] = useState(6);
    const [takeProfitEnabled, setTakeProfitEnabled] = useState(true);
    const [takeProfitTotal, setTakeProfitTotal] = useState(35);

    // Live Data
    const [digits, setDigits] = useState<{ value: number; color: string }[]>([]);
    const [ldpStats, setLdpStats] = useState<number[]>(Array(10).fill(0));
    const [entropy, setEntropy] = useState<string>('—');
    const [lastDigit, setLastDigit] = useState<string | number>('—');

    // Transactions
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [isTrading, setIsTrading] = useState(false);
    const [currentStake, setCurrentStake] = useState(0.5);
    const [consecutiveLosses, setConsecutiveLosses] = useState(0);
    const [totalProfit, setTotalProfit] = useState(0);
    const [totalWins, setTotalWins] = useState(0);
    const [totalLosses, setTotalLosses] = useState(0);
    const [lastResultDisplay, setLastResultDisplay] = useState<'WIN' | 'LOSS' | null>(null);
    const [debugStatus, setDebugStatus] = useState('Idle');

    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const digitHistoryRef = useRef<number[]>([]);
    const lastResultRef = useRef<'won' | 'lost' | null>(null);
    const activeContractIdRef = useRef<number | null>(null);
    const subscriptionIdRef = useRef<string | null>(null);
    const { connectionStatus } = useApiBase();
    const { client, run_panel, summary_card, transactions: transactionsStore } = useStore();

    // -- Helpers --
    const getSymbol = (vol: string) => {
        const map: Record<string, string> = {
            R_10: 'R_10',
            R_25: 'R_25',
            R_50: 'R_50',
            R_75: 'R_75',
            R_100: 'R_100',
            R_10_1s: '1HZ10V',
            R_15_1s: '1HZ15V',
            R_25_1s: '1HZ25V',
            R_30_1s: '1HZ30V',
            R_50_1s: '1HZ50V',
            R_75_1s: '1HZ75V',
            R_90_1s: '1HZ90V',
            R_100_1s: '1HZ100V',
            JD10: 'JD10',
            JD25: 'JD25',
            JD50: 'JD50',
            JD75: 'JD75',
            JD100: 'JD100',
        };
        return map[vol] || 'R_10';
    };

    const getPrecision = (symbol: string) => {
        if (symbol.includes('1HZ')) return 2;
        if (api_base.pip_sizes?.[symbol]) return api_base.pip_sizes[symbol];
        return 3;
    };

    const getContractType = () => {
        if (tradeType === 'DIGITDIFF') return 'DIGITDIFF';
        if (tradeType === 'DIGITEVEN') return 'DIGITEVEN';
        if (tradeType === 'DIGITODD') return 'DIGITODD';
        if (tradeType === 'DIGITOVER') return 'DIGITOVER';
        if (tradeType === 'DIGITUNDER') return 'DIGITUNDER';
        return 'DIGITMATCH';
    };

    const calculateEntropy = (stats: number[], total: number) => {
        if (total === 0) return '0.00';
        let ent = 0;
        for (const count of stats) {
            if (count > 0) {
                const p = count / total;
                ent -= p * Math.log2(p);
            }
        }
        return ent.toFixed(2);
    };

    const updateLdpStats = useCallback(() => {
        if (digitHistoryRef.current.length === 0) {
            setLdpStats(Array(10).fill(0));
            setEntropy('0.00');
            return;
        }
        const counts = Array(10).fill(0);
        digitHistoryRef.current.forEach(d => counts[d]++);
        setLdpStats(counts);
        setEntropy(calculateEntropy(counts, digitHistoryRef.current.length));
    }, []);

    const processTick = useCallback((quote: number, precision: number) => {
        const digitStr = quote.toFixed(precision).slice(-1);
        const digit = parseInt(digitStr, 10);
        const color = digit <= 3 ? 'red' : digit <= 6 ? 'orange' : 'green';
        return { digit, color };
    }, []);

    // -- Live Data Subscription --
    useEffect(() => {
        const symbol = getSymbol(volatility);
        let messageConfig: any;
        let isMounted = true;
        let activeSubscriptionId: string | null = null;
        let retryTimeout: NodeJS.Timeout;

        const cleanup = () => {
            isMounted = false;
            // Unsubscribe from stream
            if (activeSubscriptionId && api_base.api) {
                api_base.api.send({ forget: activeSubscriptionId }).catch(() => { });
                activeSubscriptionId = null;
                subscriptionIdRef.current = null;
            }
            // Remove listener
            if (messageConfig) {
                messageConfig.unsubscribe();
                messageConfig = null;
            }
            if (retryTimeout) clearTimeout(retryTimeout);
        };

        const initData = async () => {
            // Guard: waiting for API
            if (!api_base.api || connectionStatus !== 'opened') {
                // Retry logic if needed, but connectionStatus change will re-trigger
                return;
            }

            try {
                setDebugStatus('Initializing...');
                // Clear state for new symbol
                setDigits([]);
                setLdpStats(Array(10).fill(0));
                setEntropy('—');
                setLastDigit('—');
                digitHistoryRef.current = [];

                // Get Ticks History
                const res: any = await api_base.api.send({
                    ticks_history: symbol,
                    adjust_start_time: 1,
                    count: 1000,
                    end: 'latest',
                    style: 'ticks',
                });

                setDebugStatus('History received');

                if (isMounted && res.history && res.history.prices) {
                    const precision = getPrecision(symbol);
                    const historicalDigits: number[] = [];
                    const displayDigits: { value: number; color: string }[] = [];

                    res.history.prices.forEach((price: number) => {
                        const { digit, color } = processTick(price, precision);
                        historicalDigits.push(digit);
                        if (historicalDigits.length > 40) displayDigits.push({ value: digit, color });
                        else displayDigits.push({ value: digit, color });
                    });

                    digitHistoryRef.current = historicalDigits;
                    if (displayDigits.length > 0) {
                        setDigits(displayDigits.slice(-40));
                        setLastDigit(displayDigits[displayDigits.length - 1].value);
                    }
                    updateLdpStats();
                }

                if (isMounted) {
                    setDebugStatus('Subscribing to live ticks...');
                    const subRes: any = await api_base.api.send({
                        ticks: symbol,
                        subscribe: 1,
                    });
                    if (subRes.subscription) {
                        activeSubscriptionId = subRes.subscription.id;
                        subscriptionIdRef.current = activeSubscriptionId;
                        setDebugStatus('Ready (Live)');
                    } else if (subRes.error) {
                        setDebugStatus(`Sub Error: ${subRes.error.message}`);
                    }
                }
            } catch (err: any) {
                setDebugStatus(`Error: ${err.message || 'Unknown'}`);
                console.error('SpeedBot init error:', err);
            }
        };

        const handleTick = (response: any) => {
            if (!isMounted) return;

            const tick = response.tick || response.ohlc;
            if (!tick) return;

            const incomingSymbol = tick.symbol.toLowerCase().replace('_index', '');
            const targetSymbol = symbol.toLowerCase().replace('_index', '');

            if (incomingSymbol === targetSymbol) {
                const quote = tick.quote || tick.close;
                if (quote === undefined) return;

                setDebugStatus(`Live: ${quote}`);

                const precision = getPrecision(symbol);
                const { digit, color } = processTick(quote, precision);

                setLastDigit(digit);
                setDigits(prev => {
                    const updated = [...prev, { value: digit, color }];
                    if (updated.length > 40) return updated.slice(updated.length - 40);
                    return updated;
                });

                digitHistoryRef.current.push(digit);
                if (digitHistoryRef.current.length > 1000) digitHistoryRef.current.shift();

                updateLdpStats();
            }
        };

        // Initialize Listener
        if (api_base.api && connectionStatus === 'opened') {
            messageConfig = api_base.api.onMessage().subscribe(handleTick);
            initData();
        }

        return cleanup;
    }, [volatility, updateLdpStats, connectionStatus, processTick]);

    // -- Transaction Monitor --
    useEffect(() => {
        if (!api_base.api) return;

        const handleMessage = (response: any) => {
            if (response.proposal_open_contract) {
                const poc = response.proposal_open_contract;
                const contractId = poc.contract_id;

                setTransactions(prev =>
                    prev.map(tx => {
                        if (tx.id === contractId) {
                            // Update status
                            let status: Transaction['status'] = 'running';
                            if (poc.is_sold) {
                                status = poc.status === 'won' ? 'won' : 'lost';
                                if (tx.id === activeContractIdRef.current) {
                                    lastResultRef.current = status;
                                    activeContractIdRef.current = null;
                                    setIsTrading(false);

                                    if (!isAutoTrading) {
                                        showToast(`Trade ${status.toUpperCase()}! Profit: ${poc.profit}`);
                                        setLastResultDisplay(status === 'won' ? 'WIN' : 'LOSS');
                                    }

                                    // Explicitly request balance update to ensure it reflects in the header
                                    api_base.api.send({ balance: 1, subscribe: 1 });

                                    // Process Result (Martingale & Stats) - Runs for Manual & Auto
                                    if (status === 'won') {
                                        setConsecutiveLosses(0);
                                        setCurrentStake(stake);
                                        setLastResultDisplay('WIN');
                                    } else if (status === 'lost') {
                                        setConsecutiveLosses(prev => prev + 1);
                                        if (martingaleEnabled) {
                                            setCurrentStake(prev => Number((prev * martingaleMultiplier).toFixed(2)));
                                        }
                                        setLastResultDisplay('LOSS');
                                    }
                                }
                            }
                            const profit = poc.profit ? Number(poc.profit).toFixed(2) : '0.00';

                            // Emit bot.contract event to update main app results/transactions
                            botObserver.emit('bot.contract', poc);

                            return { ...tx, status, profit };
                        }
                        return tx;
                    })
                );
            }
        };

        const sub = api_base.api.onMessage().subscribe(handleMessage);
        return () => sub.unsubscribe();
    }, []);

    // -- UI Handlers --
    const handleTradeTypeChange = (val: string) => {
        setTradeType(val);
        const isEvenOdd = val === 'DIGITEVEN' || val === 'DIGITODD';
        if (isEvenOdd) {
            setEntryEnabled(true);
            if (val === 'DIGITEVEN') {
                setPredPre('Even');
                setPredPost('Even');
            }
            if (val === 'DIGITODD') {
                setPredPre('Odd');
                setPredPost('Odd');
            }
        } else {
            if (isNaN(Number(predPre))) setPredPre(5);
            if (isNaN(Number(predPost))) setPredPost(7);
        }
    };

    const addPrediction = () => {
        setPredictions(prev => [...prev, { digit: 0, stake: 0.5, id: Date.now() }]);
    };

    const removePrediction = (id: number) => {
        setPredictions(prev => prev.filter(p => p.id !== id));
    };

    const updatePrediction = (id: number, field: 'digit' | 'stake', value: number) => {
        setPredictions(prev => prev.map(p => (p.id === id ? { ...p, [field]: value } : p)));
    };

    const showToast = (msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 2200);
    };

    const checkEntryCondition = () => {
        if (!entryEnabled) return true;

        const lastDigits = digitHistoryRef.current;
        if (lastDigits.length === 0) return false;

        const latest = lastDigits[lastDigits.length - 1];

        if (entryPoint === 'single') {
            return latest === singleDigit;
        }
        if (entryPoint === 'double' && lastDigits.length >= 2) {
            const prev = lastDigits[lastDigits.length - 2];
            return (
                prev >= digitRangeStart &&
                prev <= digitRangeEnd &&
                latest >= digitRangeStart &&
                latest <= digitRangeEnd
            );
        }
        if (entryPoint === 'last_even') {
            return latest % 2 === 0;
        }
        if (entryPoint === 'last_odd') {
            return latest % 2 !== 0;
        }
        if (entryPoint === 'last_five_even' && lastDigits.length >= 5) {
            return lastDigits.slice(-5).every(d => d % 2 === 0);
        }
        if (entryPoint === 'even_percent') {
            const evens = ldpStats.reduce((acc, count, d) => (d % 2 === 0 ? acc + count : acc), 0);
            const total = ldpStats.reduce((acc, count) => acc + count, 0);
            return total > 0 && evens / total >= 0.6;
        }

        return false;
    };

    const handleDigitClick = (d: number) => {
        showToast(`Digit ${d} selected!`);

        if (predictionMode === 'single') {
            setSingleDigit(d);
        } else if (predictionMode === 'recovery') {
            if (!isNaN(Number(predPre))) setPredPre(d);
            else setPredPost(d);
        } else if (predictionMode === 'multi') {
            setPredictions(prev => [...prev, { digit: d, stake: 0.5, id: Date.now() }]);
        }
    };

    const executeTrade = async (req: any, tradeStake: number, contract_type: string) => {
        try {
            // 1. Get Proposal
            const propRes: any = await api_base.api.send(req);
            if (propRes.proposal) {
                const id = propRes.proposal.id;
                // 2. Buy
                const buyRes: any = await api_base.api.send({ buy: id, price: Number(propRes.proposal.ask_price) });
                if (buyRes.buy) {
                    const newTx: Transaction = {
                        id: buyRes.buy.contract_id,
                        ref: buyRes.buy.transaction_id,
                        contract_type: contract_type,
                        stake: tradeStake,
                        payout: propRes.proposal.payout,
                        profit: '0.00',
                        status: 'running',
                        timestamp: Date.now(),
                    };
                    setTransactions(prev => [newTx, ...prev]);
                    activeContractIdRef.current = buyRes.buy.contract_id;

                    // Emit events
                    botObserver.emit('bot.running');
                    botObserver.emit('contract.status', {
                        id: 'contract.purchase_received',
                        buy: buyRes.buy
                    });

                    // Subscribe to updates
                    api_base.api.send({ proposal_open_contract: 1, contract_id: buyRes.buy.contract_id, subscribe: 1 });

                    // Only show success toast for single trades to avoid spam
                    if (!isAutoTrading && (!bulkEnabled || bulkTrades === 1)) {
                        showToast('Trade placed successfully!');
                    }
                } else if (buyRes.error) {
                    showToast(buyRes.error.message);
                }
            } else if (propRes.error) {
                showToast(propRes.error.message);
            }
        } catch (e: any) {
            showToast('Trade error: ' + (e.message || e));
        }
    };

    const tradeOnce = async (customStake?: number, customBarrier?: number) => {
        if (!api_base.api) {
            showToast('API not ready');
            return;
        }

        if (isTrading) return;

        // Enforce Entry Condition for Manual Trades too
        if (entryEnabled && !checkEntryCondition()) {
            // For Specific Trades (customBarrier), user might expect forced execution?
            // But request said "use all bot config".
            showToast('Entry condition detection...');
            if (!checkEntryCondition()) {
                showToast('Entry condition not met!');
                return;
            }
        }

        const symbol = getSymbol(volatility);
        const contract_type = getContractType();
        // Base Stake: usage depends on mode. For 'multi', we use individual stakes.
        // For others, we use customStake (if auto martanigaling) or global 'stake'.
        // UPDATE: If Martingale is enabled, 'Manual Trade' should probably use 'currentStake' 
        // to continue the sequence, unless a specific customStake was passed (e.g. from specific card).
        // If it's a "Global Trade Once", customStake is undefined.
        const defaultStake = customStake || (martingaleEnabled ? currentStake : stake);

        const configs: { barrier?: number; stake: number }[] = [];

        // 1. Determine Trade Configurations
        // If customBarrier is provided, we are trading a SPECIFIC prediction (or single override)
        if (customBarrier !== undefined) {
            configs.push({ barrier: customBarrier, stake: defaultStake });
        }
        else if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contract_type)) {
            if (predictionMode === 'multi' && predictions.length > 0) {
                // Multi Mode: Trade ALL predictions with their specific stakes (unless customBarrier set)
                predictions.forEach(p => {
                    configs.push({ barrier: p.digit, stake: p.stake });
                });
            } else if (predictionMode === 'recovery') {
                // Recovery Mode Logic
                const val = consecutiveLosses > 0 ? Number(predPost) : Number(predPre);
                configs.push({ barrier: val, stake: defaultStake });
            } else {
                // Single / Default
                configs.push({ barrier: singleDigit, stake: defaultStake });
            }
        } else {
            // Non-Digit Trades (Even/Odd etc)
            configs.push({ stake: defaultStake });
        }

        const baseReq: any = {
            proposal: 1,
            basis: 'stake',
            contract_type: contract_type,
            currency: client.currency || 'USD',
            duration: ticks,
            duration_unit: 't',
            symbol: symbol,
        };

        setIsTrading(true);

        let count = 1;
        if (bulkEnabled) {
            // Restrict bulk trading to 'single' mode only for Digit Trades,
            // OR if we are forcing a single prediction trade (customBarrier)
            const isDigitTrade = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contract_type);
            if (!isDigitTrade || predictionMode === 'single' || customBarrier !== undefined) {
                count = bulkTrades;
            }
        }

        const totalTrades = count * configs.length;

        if (!isAutoTrading) {
            showToast(totalTrades > 1 ? `Placing ${totalTrades} trades...` : 'Placing trade...');
        }

        const promises = [];
        for (let i = 0; i < count; i++) {
            for (const cfg of configs) {
                const specificReq = { ...baseReq, amount: cfg.stake };
                if (cfg.barrier !== undefined) specificReq.barrier = cfg.barrier;
                promises.push(executeTrade(specificReq, cfg.stake, contract_type));
            }
        }

        await Promise.all(promises);
        setIsTrading(false);
    };

    const startAuto = () => {
        if (isAutoTrading) {
            setIsAutoTrading(false);
            showToast('Auto Trading Stopped');
            botObserver.emit('bot.stop');
            return;
        }

        // Reset stats
        setConsecutiveLosses(0);
        setCurrentStake(stake);
        setTotalProfit(0);
        setTotalWins(0);
        setTotalLosses(0);
        setLastResultDisplay(null);
        lastResultRef.current = null;
        activeContractIdRef.current = null;
        setIsTrading(false);

        setIsAutoTrading(true);
        showToast('Auto Trading Started');
        botObserver.emit('bot.running');
    };

    // -- Auto Engine Hook --
    // -- Result Processing (Manual & Auto) --
    useEffect(() => {
        // Handle Last Result Updates (Martingale & Stats)
        if (lastResultRef.current === 'won') {
            const profit = transactions[0]?.profit || 0; // Approx
            setConsecutiveLosses(0);
            setCurrentStake(stake);
            lastResultRef.current = null;
            setLastResultDisplay('WIN');
        } else if (lastResultRef.current === 'lost') {
            setConsecutiveLosses(prev => prev + 1);
            if (martingaleEnabled) {
                setCurrentStake(prev => Number((prev * martingaleMultiplier).toFixed(2)));
            }
            lastResultRef.current = null;
            setLastResultDisplay('LOSS');
        }
    }, [transactions, martingaleEnabled, martingaleMultiplier, stake]); // triggering on transactions update or just check loop? 
    // Actually, lastResultRef is mutable, so we need something to trigger the effect. 
    // The previous code used the auto-loop dependencies. 
    // The transaction monitor sets setIsTrading(false) and lastResultRef.
    // Let's use `isTrading` changing to false as a trigger or just listen to `lastResultRef.current` (not possible directly).
    // Better: Moving the logic inside the Transaction Monitor where `lastResultRef` is set.

    // -- Auto Engine Hook --
    useEffect(() => {
        if (!isAutoTrading) return;

        // Check limits
        if (stopLossTotalEnabled && totalProfit <= stopLossTotal) {
            setIsAutoTrading(false);
            showToast('Stop Loss Reached!');
            return;
        }
        if (takeProfitEnabled && totalProfit >= takeProfitTotal) {
            setIsAutoTrading(false);
            showToast('Take Profit Reached!');
            return;
        }
        if (stopLossConsecutiveEnabled && consecutiveLosses >= stopLossConsecutive) {
            setIsAutoTrading(false);
            showToast('Max Consecutive Losses Reached!');
            return;
        }

        // Check Entry and Execute
        if (!isTrading && checkEntryCondition()) {
            // For Auto, we use the Calculated Current Stake
            tradeOnce(currentStake);
        }
    }, [
        digits, // Trigger on new tick/data
        lastDigit,
        isAutoTrading,
        isTrading,
        currentStake,
        consecutiveLosses,
        totalProfit,
        stopLossTotal,
        stopLossTotalEnabled,
        takeProfitTotal,
        takeProfitEnabled,
        stopLossConsecutive,
        stopLossConsecutiveEnabled,
    ]);

    // Update total profit and counts whenever transactions change
    useEffect(() => {
        let wins = 0;
        let losses = 0;
        const total = transactions.reduce((acc, tx) => {
            if (tx.status === 'won') {
                wins++;
                return acc + (tx.payout - tx.stake);
            }
            if (tx.status === 'lost') {
                losses++;
                return acc - tx.stake;
            }
            return acc;
        }, 0);
        setTotalProfit(total);
        setTotalWins(wins);
        setTotalLosses(losses);
    }, [transactions]);

    const isEvenOdd = tradeType === 'DIGITEVEN' || tradeType === 'DIGITODD';

    const getLdpColor = (digit: number, count: number, total: number, max: number) => {
        const intensity = max > 0 ? count / max : 0;
        const hue = 120 - intensity * 100 * 1.2;
        return `hsl(${hue}, 75%, ${35 + intensity * 0.3 * 100}%)`;
    };

    const totalDigits = digitHistoryRef.current.length;
    const maxCount = ldpStats.length ? Math.max(...ldpStats) : 0;

    return (
        <div className='speed-bot-page'>
            <div className='container'>
                <div className='grid'>
                    {/* -- Config Section -- */}
                    <section className='card'>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>Bot configuration</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div
                                    style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: connectionStatus === 'opened' ? '#4caf50' : '#f44336',
                                        boxShadow: connectionStatus === 'opened' ? '0 0 8px #4caf50' : 'none',
                                        transition: 'all 0.3s ease',
                                    }}
                                ></div>
                                <span
                                    style={{
                                        fontSize: '11px',
                                        color: '#888',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.5px',
                                    }}
                                >
                                    {connectionStatus === 'opened' ? 'Live' : 'Offline'}
                                </span>
                            </div>
                        </div>
                        <div style={{ fontSize: '10px', opacity: 0.5, marginBottom: '10px' }}>
                            Status: {debugStatus}
                        </div>
                        <form onSubmit={e => e.preventDefault()}>
                            <label>
                                Volatility:
                                <select value={volatility} onChange={e => setVolatility(e.target.value)}>
                                    <optgroup label='Plain Volatility'>
                                        <option value='R_10'>Volatility 10</option>
                                        <option value='R_25'>Volatility 25</option>
                                        <option value='R_50'>Volatility 50</option>
                                        <option value='R_75'>Volatility 75</option>
                                        <option value='R_100'>Volatility 100</option>
                                    </optgroup>
                                    <optgroup label='Volatility (1s)'>
                                        <option value='R_10_1s'>Volatility 10 (1s)</option>
                                        <option value='R_15_1s'>Volatility 15 (1s)</option>
                                        <option value='R_25_1s'>Volatility 25 (1s)</option>
                                        <option value='R_30_1s'>Volatility 30 (1s)</option>
                                        <option value='R_50_1s'>Volatility 50 (1s)</option>
                                        <option value='R_75_1s'>Volatility 75 (1s)</option>
                                        <option value='R_90_1s'>Volatility 90 (1s)</option>
                                        <option value='R_100_1s'>Volatility 100 (1s)</option>
                                    </optgroup>
                                    <optgroup label='Jump Indices'>
                                        <option value='JD10'>Jump 10 Index</option>
                                        <option value='JD25'>Jump 25 Index</option>
                                        <option value='JD50'>Jump 50 Index</option>
                                        <option value='JD75'>Jump 75 Index</option>
                                        <option value='JD100'>Jump 100 Index</option>
                                    </optgroup>
                                </select>
                            </label>

                            <label>
                                Trade type:
                                <select value={tradeType} onChange={e => handleTradeTypeChange(e.target.value)}>
                                    <option value='DIGITMATCH'>Digit Matches</option>
                                    <option value='DIGITDIFF'>Digit Differs</option>
                                    <option value='DIGITEVEN'>Digit Even</option>
                                    <option value='DIGITODD'>Digit Odd</option>
                                    <option value='DIGITOVER'>Digit Over</option>
                                    <option value='DIGITUNDER'>Digit Under</option>
                                </select>
                                {tradeType !== 'DIGITMATCH' && (
                                    <span className='badge'>{tradeType.replace('DIGIT', '')}</span>
                                )}
                            </label>

                            <div className='row'>
                                <label>
                                    Ticks:
                                    <input
                                        type='number'
                                        value={ticks}
                                        min='1'
                                        onChange={e => setTicks(Number(e.target.value))}
                                    />
                                </label>
                                <label>
                                    Base Stake:
                                    <input
                                        type='number'
                                        step='0.01'
                                        value={stake}
                                        min='0.01'
                                        onChange={e => setStake(Number(e.target.value))}
                                    />
                                </label>
                            </div>

                            {/* Bulk */}
                            <div className='toggle' onClick={() => setBulkEnabled(!bulkEnabled)}>
                                <input type='checkbox' checked={bulkEnabled} readOnly />
                                <label>Bulk trading</label>
                                {bulkEnabled && <span className='badge'>Bulk ON</span>}
                            </div>
                            <label>
                                Bulk count:
                                <input
                                    type='number'
                                    value={bulkTrades}
                                    min='1'
                                    disabled={!bulkEnabled}
                                    onChange={e => setBulkTrades(Number(e.target.value))}
                                />
                            </label>

                            {/* Entry */}
                            <div className='toggle' onClick={() => setEntryEnabled(!entryEnabled)}>
                                <input type='checkbox' checked={entryEnabled} readOnly />
                                <label>Entry condition</label>
                                {entryEnabled && <span className='badge'>Entry ON</span>}
                            </div>
                            <label>
                                Entry condition:
                                <select
                                    value={entryPoint}
                                    disabled={!entryEnabled}
                                    onChange={e => setEntryPoint(e.target.value)}
                                >
                                    {!isEvenOdd ? (
                                        <>
                                            <option value='single'>Single digit</option>
                                            <option value='double'>Two consecutive digits</option>
                                        </>
                                    ) : (
                                        <>
                                            <option value='last_even'>Last digit is even</option>
                                            <option value='last_odd'>Last digit is odd</option>
                                            <option value='last_five_even'>Last 5 digits all even</option>
                                            <option value='even_percent'>Even % &gt;= 60% (last 1000 ticks)</option>
                                        </>
                                    )}
                                </select>
                            </label>

                            {entryEnabled && entryPoint === 'double' && (
                                <div className='row'>
                                    <label>
                                        Digit range start (0–9):
                                        <input
                                            type='number'
                                            min='0'
                                            max='9'
                                            value={digitRangeStart}
                                            onChange={e => setDigitRangeStart(Number(e.target.value))}
                                        />
                                    </label>
                                    <label>
                                        Digit range end (0–9):
                                        <input
                                            type='number'
                                            min='0'
                                            max='9'
                                            value={digitRangeEnd}
                                            onChange={e => setDigitRangeEnd(Number(e.target.value))}
                                        />
                                    </label>
                                </div>
                            )}

                            {/* Prediction Section - Hidden for Even/Odd */}
                            {!isEvenOdd && (
                                <>
                                    <div className='section-title'>Prediction section</div>
                                    <label>
                                        Prediction mode:
                                        <select
                                            value={predictionMode}
                                            onChange={e => setPredictionMode(e.target.value)}
                                        >
                                            <option value='single'>Single prediction</option>
                                            <option value='recovery'>Prediction with recovery</option>
                                            <option value='multi'>Multiple predictions</option>
                                        </select>
                                    </label>

                                    {predictionMode === 'single' && (
                                        <div className='row'>
                                            <label>
                                                Digit (0–9):
                                                <input
                                                    type='number'
                                                    min='0'
                                                    max='9'
                                                    value={singleDigit}
                                                    onChange={e => setSingleDigit(Number(e.target.value))}
                                                />
                                            </label>
                                            <label>
                                                Stake:
                                                <input
                                                    type='number'
                                                    step='0.01'
                                                    min='0'
                                                    value={singleStake}
                                                    onChange={e => setSingleStake(Number(e.target.value))}
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {predictionMode === 'recovery' && (
                                        <div className='row'>
                                            <label>
                                                Before loss:
                                                <input
                                                    type='text'
                                                    value={predPre}
                                                    onChange={e => setPredPre(e.target.value)}
                                                />
                                            </label>
                                            <label>
                                                After loss:
                                                <input
                                                    type='text'
                                                    value={predPost}
                                                    onChange={e => setPredPost(e.target.value)}
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {predictionMode === 'multi' && (
                                        <div>
                                            <div className='pred-grid'>
                                                {predictions.map((pred, i) => (
                                                    <div key={pred.id} className='pred-card'>
                                                        <label>
                                                            Digit #{i + 1} (0–9):
                                                            <input
                                                                type='number'
                                                                min='0'
                                                                max='9'
                                                                value={pred.digit}
                                                                onChange={e =>
                                                                    updatePrediction(
                                                                        pred.id,
                                                                        'digit',
                                                                        Number(e.target.value)
                                                                    )
                                                                }
                                                            />
                                                        </label>
                                                        <label>
                                                            Stake #{i + 1}:
                                                            <input
                                                                type='number'
                                                                step='0.01'
                                                                min='0'
                                                                value={pred.stake}
                                                                onChange={e =>
                                                                    updatePrediction(
                                                                        pred.id,
                                                                        'stake',
                                                                        Number(e.target.value)
                                                                    )
                                                                }
                                                            />
                                                        </label>
                                                        <button
                                                            type='button'
                                                            className='btn remove-pred-btn'
                                                            onClick={() => removePrediction(pred.id)}
                                                        >
                                                            ×
                                                        </button>
                                                        <button
                                                            type='button'
                                                            className='btn'
                                                            style={{
                                                                position: 'absolute',
                                                                bottom: '8px',
                                                                right: '8px',
                                                                background: '#2ea3f2',
                                                                color: '#fff',
                                                                padding: '4px 8px',
                                                                fontSize: '12px',
                                                                borderRadius: '4px'
                                                            }}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                tradeOnce(pred.stake, pred.digit);
                                                            }}
                                                        >
                                                            ▶
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            <div style={{ marginTop: '12px' }}>
                                                <button type='button' className='btn primary' onClick={addPrediction}>
                                                    + Add Prediction
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Martingale */}
                            <div className='section-title' style={{ color: '#fbbf24' }}>
                                Martingale Strategy
                            </div>
                            <div className='toggle' onClick={() => setMartingaleEnabled(!martingaleEnabled)}>
                                <input type='checkbox' checked={martingaleEnabled} readOnly />
                                <label>Use Martingale</label>
                            </div>
                            <label>
                                Martingale multiplier:
                                <input
                                    type='number'
                                    step='0.1'
                                    value={martingaleMultiplier}
                                    min='0.5'
                                    disabled={!martingaleEnabled}
                                    onChange={e => setMartingaleMultiplier(Number(e.target.value))}
                                />
                            </label>

                            {/* Stop Loss */}
                            <div className='section-title sl-title'>Stop Loss</div>
                            <div className='toggle' onClick={() => setStopLossTotalEnabled(!stopLossTotalEnabled)}>
                                <input type='checkbox' checked={stopLossTotalEnabled} readOnly />
                                <label>Max Total Loss</label>
                            </div>
                            <input
                                type='number'
                                step='0.01'
                                value={stopLossTotal}
                                disabled={!stopLossTotalEnabled}
                                onChange={e => setStopLossTotal(Number(e.target.value))}
                            />

                            <div
                                className='toggle'
                                style={{ marginTop: '1.2rem' }}
                                onClick={() => setStopLossConsecutiveEnabled(!stopLossConsecutiveEnabled)}
                            >
                                <input type='checkbox' checked={stopLossConsecutiveEnabled} readOnly />
                                <label>Max Consecutive Losses</label>
                            </div>
                            <input
                                type='number'
                                min='1'
                                value={stopLossConsecutive}
                                disabled={!stopLossConsecutiveEnabled}
                                onChange={e => setStopLossConsecutive(Number(e.target.value))}
                            />

                            {/* Take Profit */}
                            <div className='section-title tp-title'>Take Profit</div>
                            <div className='toggle' onClick={() => setTakeProfitEnabled(!takeProfitEnabled)}>
                                <input type='checkbox' checked={takeProfitEnabled} readOnly />
                                <label>Enable Take Profit</label>
                            </div>
                            <input
                                type='number'
                                step='0.01'
                                value={takeProfitTotal}
                                disabled={!takeProfitEnabled}
                                onChange={e => setTakeProfitTotal(Number(e.target.value))}
                            />
                        </form>
                    </section>

                    {/* -- Live Data Section -- */}
                    <section className='card'>
                        <h3>Live digits</h3>
                        <div className='digits'>
                            {digits.map((d, i) => (
                                <div key={i} className={clsx('digit', d.color)}>
                                    {d.value}
                                </div>
                            ))}
                        </div>

                        <div className='section-title'>Last Digit Stats (last {totalDigits} ticks)</div>
                        <div className='ldp-grid'>
                            {Array.from({ length: 10 }).map((_, d) => {
                                const count = ldpStats[d] || 0;
                                const percent = totalDigits > 0 ? ((count / totalDigits) * 100).toFixed(1) : 0;
                                const bgColor = getLdpColor(d, count, totalDigits, maxCount);
                                const isCursor = lastDigit === d;

                                return (
                                    <div
                                        key={`${d}-${isCursor ? digitHistoryRef.current.length : 'off'}`}
                                        className={clsx('ldp-cell', { 'cursor-active': isCursor })}
                                        style={{ backgroundColor: bgColor }}
                                        onClick={() => handleDigitClick(d)}
                                    >
                                        <div className='digit-num'>{d}</div>
                                        <div className='percent'>{percent}%</div>
                                        <div className='count'>{count}</div>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ textAlign: 'center', fontSize: '13px', color: '#9fb3c8', marginTop: '8px' }}>
                            Hot <span style={{ color: '#ff6b6b' }}>■■■■■■■■■■</span> → Cold{' '}
                            <span style={{ color: '#34d399' }}>■■</span>
                        </div>

                        <div className='metrics'>
                            <div className='metric'>
                                <div className='label'>Entropy</div>
                                <div className='value'>{entropy}</div>
                            </div>
                            <div className='metric'>
                                <div className='label'>Last digit</div>
                                <div className='value'>{lastDigit}</div>
                            </div>
                        </div>

                        <div className='bot-status' style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                            <div className='metric' style={{ background: '#1e293b' }}>
                                <div className='label'>Last Result</div>
                                <div className='value' style={{
                                    color: lastResultDisplay === 'WIN' ? '#00d085' : lastResultDisplay === 'LOSS' ? '#ff444f' : '#fff'
                                }}>
                                    {lastResultDisplay || '—'}
                                </div>
                            </div>
                            <div className='metric' style={{ background: '#1e293b' }}>
                                <div className='label'>Total Profit</div>
                                <div className='value' style={{ color: totalProfit >= 0 ? '#00d085' : '#ff444f' }}>
                                    {totalProfit >= 0 ? `+$${totalProfit.toFixed(2)}` : `-$${Math.abs(totalProfit).toFixed(2)}`}
                                </div>
                            </div>
                            <div className='metric' style={{ background: '#1e293b' }}>
                                <div className='label'>Wins</div>
                                <div className='value' style={{ color: '#00d085' }}>{totalWins}</div>
                            </div>
                            <div className='metric' style={{ background: '#1e293b' }}>
                                <div className='label'>Losses</div>
                                <div className='value' style={{ color: '#ff444f' }}>{totalLosses}</div>
                            </div>
                        </div>

                        {/* Transactions List */}
                        {transactions.length > 0 && (
                            <div className='transactions-list' style={{ marginTop: '20px', fontSize: '12px' }}>
                                <h4 style={{ color: '#c2c2c2', marginBottom: '10px' }}>Recent Transactions</h4>
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                        maxHeight: '200px',
                                        overflowY: 'auto',
                                    }}
                                >
                                    {transactions.map(tx => (
                                        <div
                                            key={tx.id}
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                padding: '8px',
                                                backgroundColor: '#1b2028',
                                                borderRadius: '4px',
                                                borderLeft: `3px solid ${tx.status === 'won' ? '#00d085' : tx.status === 'lost' ? '#ff444f' : '#fbbf24'}`,
                                            }}
                                        >
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <span style={{ color: '#fff' }}>{tx.contract_type}</span>
                                                <span style={{ color: '#8b9bb4' }}>Ref: {tx.ref}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '12px' }}>
                                                <span style={{ color: '#fff' }}>Stake: {tx.stake}</span>
                                                <div style={{ display: 'flex', gap: '6px' }}>
                                                    <span
                                                        style={{
                                                            fontWeight: 'bold',
                                                            color:
                                                                tx.status === 'won'
                                                                    ? '#00d085'
                                                                    : tx.status === 'lost'
                                                                        ? '#ff444f'
                                                                        : '#fbbf24',
                                                        }}
                                                    >
                                                        {tx.status === 'running'
                                                            ? 'RUNNING'
                                                            : tx.status === 'won'
                                                                ? 'WIN'
                                                                : 'LOSS'}
                                                    </span>
                                                    <span
                                                        style={{
                                                            fontWeight: 'bold',
                                                            color:
                                                                tx.status === 'won'
                                                                    ? '#00d085'
                                                                    : tx.status === 'lost'
                                                                        ? '#ff444f'
                                                                        : '#fbbf24',
                                                        }}
                                                    >
                                                        {tx.status === 'running'
                                                            ? '...'
                                                            : tx.status === 'won'
                                                                ? `+${tx.profit}`
                                                                : `-${tx.stake}`}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className='controls'>
                            <button className='btn primary' onClick={() => tradeOnce()}>
                                Trade Once
                            </button>
                            <button
                                className={clsx('btn', isAutoTrading ? 'danger' : 'success')}
                                onClick={startAuto}
                            >
                                {isAutoTrading ? 'Stop Auto Trading' : 'Start Auto Trading'}
                            </button>
                            <button
                                className='btn secondary'
                                onClick={() => setTransactions([])}
                                style={{ marginLeft: '10px', fontSize: '11px', padding: '4px 8px' }}
                            >
                                Clear Log
                            </button>
                        </div>
                    </section>
                </div>
            </div>
            {toastMessage && <div className='alert-toast'>{toastMessage}</div>}
        </div>
    );
});

export default SpeedBot;
