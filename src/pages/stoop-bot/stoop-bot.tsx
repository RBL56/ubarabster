import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { contract_stages } from '@/constants/contract-stage';
import { api_base, observer as botObserver } from '@/external/bot-skeleton';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import './stoop-bot.scss';

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
    barrier?: number | string;
    entry_digit?: number;
    exit_digit?: number;
    batch_id?: number;
    batch_size?: number;
};


// Journal Entry Type
type JournalEntry = {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error' | 'trade';
    timestamp: number;
    is_demo?: boolean;
    volatility?: string;
    barrier?: number | string;
};

const StoopBot = observer(() => {
    const { connectionStatus, isAuthorized } = useApiBase();
    const { client, run_panel, dashboard } = useStore();

    const [toastMessage, setToastMessage] = useState<string | null>(null);

    const showToast = useCallback((msg: string) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(null), 2200);
    }, []);

    // -- State --
    const [volatility, setVolatility] = useState('1HZ50V'); // Default to 50 (1s) as per Unstoppable Differ
    const [tradeType, setTradeType] = useState('DIGITDIFF'); // Default to Differs
    const [ticks, setTicks] = useState(1);
    const [stake, setStake] = useState(0.5);

    // Bulk
    const [bulkEnabled, setBulkEnabled] = useState(false);
    const [bulkTrades, setBulkTrades] = useState(1);

    // Entry
    const [entryEnabled, setEntryEnabled] = useState(false);
    const [entryPoint, setEntryPoint] = useState('single');
    const [entryDigit, setEntryDigit] = useState(5);
    const [digitRangeStart, setDigitRangeStart] = useState(0);
    const [digitRangeEnd, setDigitRangeEnd] = useState(9);

    // Prediction
    const [predictionMode, setPredictionMode] = useState('single');
    const [singleDigit, setSingleDigit] = useState(5);
    const [singleStake, setSingleStake] = useState(0.5);
    const [predPre, setPredPre] = useState<string | number>(5);
    const [predPost, setPredPost] = useState<string | number>(7);
    const [recoveryContractType, setRecoveryContractType] = useState('DIGITOVER');
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
    const [ticksCount, setTicksCount] = useState(0);
    const [lastTickColor, setLastTickColor] = useState('');
    const [journal, setJournal] = useState<JournalEntry[]>([]);


    const [activeTab, setActiveTab] = useState<'summary' | 'transactions' | 'journal'>('transactions');

    const liveDigitsRef = useRef<HTMLDivElement>(null);
    const lastDigitRef = useRef<HTMLDivElement>(null);
    const liveDigitsBufferRef = useRef<{ value: number; color: string }[]>([]);
    const ldpCellsRef = useRef<(HTMLDivElement | null)[]>([]);

    const pendingBatchRef = useRef<Map<string, { id: number, size: number }>>(new Map());

    const digitHistoryRef = useRef<number[]>([]);
    const lastResultRef = useRef<'won' | 'lost' | null>(null);
    const activeContractIdsRef = useRef<Set<string>>(new Set());
    const subscriptionIdRef = useRef<string | null>(null);

    // Refs for stale closure fixes in transactional monitor & auto engine
    const isAutoTradingRef = useRef(isAutoTrading);
    const martingaleEnabledRef = useRef(martingaleEnabled);
    const martingaleMultiplierRef = useRef(martingaleMultiplier);
    const stakeRef = useRef(stake);
    const currentStakeRef = useRef(currentStake);
    const consecutiveLossesRef = useRef(consecutiveLosses);
    const isTradingRef = useRef(isTrading);
    const totalProfitRef = useRef(totalProfit);
    const stopLossTotalRef = useRef(stopLossTotal);
    const stopLossTotalEnabledRef = useRef(stopLossTotalEnabled);
    const takeProfitTotalRef = useRef(takeProfitTotal);
    const takeProfitEnabledRef = useRef(takeProfitEnabled);
    const stopLossConsecutiveRef = useRef(stopLossConsecutive);
    const stopLossConsecutiveEnabledRef = useRef(stopLossConsecutiveEnabled);
    const transactionsRef = useRef(transactions);

    // -- New Refs for Config to fix stale closures --
    const volatilityRef = useRef(volatility);
    const tradeTypeRef = useRef(tradeType);
    const ticksRef = useRef(ticks);
    const bulkEnabledRef = useRef(bulkEnabled);
    const bulkTradesRef = useRef(bulkTrades);
    const entryEnabledRef = useRef(entryEnabled);
    const entryPointRef = useRef(entryPoint);
    const entryDigitRef = useRef(entryDigit);
    const digitRangeStartRef = useRef(digitRangeStart);
    const digitRangeEndRef = useRef(digitRangeEnd);
    const predictionModeRef = useRef(predictionMode);
    const singleDigitRef = useRef(singleDigit);
    const singleStakeRef = useRef(singleStake);
    const predPreRef = useRef(predPre);
    const predPostRef = useRef(predPost);
    const recoveryContractTypeRef = useRef(recoveryContractType);
    const predictionsRef = useRef(predictions);
    const hasTriggeredEntryRef = useRef(false);

    // -- Run Mode & Mutex --
    const [runMode, setRunMode] = useState<'continuous' | 'once'>('continuous');
    const runModeRef = useRef(runMode);
    const [showRunMenu, setShowRunMenu] = useState(false); // For the dropdown
    const runMenuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (runMenuRef.current && !runMenuRef.current.contains(event.target as Node)) {
                setShowRunMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Stop bot when switching tabs
    useEffect(() => {
        if (dashboard.active_tab !== 'stoop-bot' && isAutoTradingRef.current) {
            console.log('[StoopBot] Tab changed, stopping auto-trader.');
            setIsAutoTrading(false);
            isAutoTradingRef.current = false;
            botObserver.emit('bot.stop');
            run_panel.setIsRunning(false);
            showToast('Auto Trading Stopped (Tab Switched)');
        }
    }, [dashboard.active_tab, run_panel, showToast]);

    useEffect(() => { volatilityRef.current = volatility; }, [volatility]);
    useEffect(() => { tradeTypeRef.current = tradeType; }, [tradeType]);
    useEffect(() => { ticksRef.current = ticks; }, [ticks]);
    useEffect(() => { bulkEnabledRef.current = bulkEnabled; }, [bulkEnabled]);
    useEffect(() => { bulkTradesRef.current = bulkTrades; }, [bulkTrades]);
    useEffect(() => { entryEnabledRef.current = entryEnabled; }, [entryEnabled]);
    useEffect(() => { entryPointRef.current = entryPoint; }, [entryPoint]);
    useEffect(() => { entryDigitRef.current = entryDigit; }, [entryDigit]);
    useEffect(() => { digitRangeStartRef.current = digitRangeStart; }, [digitRangeStart]);
    useEffect(() => { digitRangeEndRef.current = digitRangeEnd; }, [digitRangeEnd]);
    useEffect(() => { predictionModeRef.current = predictionMode; }, [predictionMode]);
    useEffect(() => { singleDigitRef.current = singleDigit; }, [singleDigit]);
    useEffect(() => { singleStakeRef.current = singleStake; }, [singleStake]);
    useEffect(() => { predPreRef.current = predPre; }, [predPre]);
    useEffect(() => { predPostRef.current = predPost; }, [predPost]);
    useEffect(() => { recoveryContractTypeRef.current = recoveryContractType; }, [recoveryContractType]);
    useEffect(() => { predictionsRef.current = predictions; }, [predictions]);
    useEffect(() => { runModeRef.current = runMode; }, [runMode]);

    useEffect(() => { isAutoTradingRef.current = isAutoTrading; }, [isAutoTrading]);
    useEffect(() => { martingaleEnabledRef.current = martingaleEnabled; }, [martingaleEnabled]);
    useEffect(() => { martingaleMultiplierRef.current = martingaleMultiplier; }, [martingaleMultiplier]);
    useEffect(() => { stakeRef.current = stake; }, [stake]);
    useEffect(() => { currentStakeRef.current = currentStake; }, [currentStake]);
    useEffect(() => { consecutiveLossesRef.current = consecutiveLosses; }, [consecutiveLosses]);
    useEffect(() => { isTradingRef.current = isTrading; }, [isTrading]);
    useEffect(() => { totalProfitRef.current = totalProfit; }, [totalProfit]);
    useEffect(() => { stopLossTotalRef.current = stopLossTotal; }, [stopLossTotal]);
    useEffect(() => { stopLossTotalEnabledRef.current = stopLossTotalEnabled; }, [stopLossTotalEnabled]);
    useEffect(() => { takeProfitTotalRef.current = takeProfitTotal; }, [takeProfitTotal]);
    useEffect(() => { takeProfitEnabledRef.current = takeProfitEnabled; }, [takeProfitEnabled]);
    useEffect(() => { stopLossConsecutiveRef.current = stopLossConsecutive; }, [stopLossConsecutive]);
    useEffect(() => { stopLossConsecutiveEnabledRef.current = stopLossConsecutiveEnabled; }, [stopLossConsecutiveEnabled]);
    useEffect(() => { transactionsRef.current = transactions; }, [transactions]);


    const addJournal = useCallback((msg: string, type: JournalEntry['type'] = 'info', barrier?: number | string) => {
        setJournal(prev => [{
            id: Date.now() + Math.random(),
            message: msg,
            type,
            timestamp: Date.now(),
            is_demo: client.is_virtual,
            volatility: volatilityRef.current,
            barrier
        }, ...prev].slice(0, 100)); // Keep last 100
    }, [client.is_virtual]); // volatilityRef.current is used, so no need to depend on volatility state

    const handleTradeCompletion = useCallback((poc: any, status: Transaction['status']) => {
        const contractId = String(poc.contract_id);
        if (!activeContractIdsRef.current.has(contractId)) return;

        lastResultRef.current = status;
        activeContractIdsRef.current.delete(contractId);

        if (activeContractIdsRef.current.size === 0) {
            setIsTrading(false);
            isTradingRef.current = false;
        }

        const profitStr = poc.profit !== undefined ? Number(poc.profit).toFixed(2) : '0.00';
        const exitDigit = status === 'won' || status === 'lost' ? poc.exit_tick_display_value?.slice(-1) : null;

        console.log(`[StoopBot] Trade completed: ${status.toUpperCase()} | Profit: ${profitStr} | Digit: ${exitDigit}`);
        addJournal(`Trade ${status.toUpperCase()}: Profit ${profitStr}${exitDigit ? `, Digit ${exitDigit}` : ''}`, status === 'won' ? 'success' : 'error');

        if (!isAutoTradingRef.current) {
            showToast(`Trade ${status.toUpperCase()}! ${exitDigit ? `Digit: ${exitDigit}` : ''} Profit: ${profitStr}`);
        }

        // Refresh balance
        if (api_base.api) {
            api_base.api.send({ balance: 1, subscribe: 1 });
        }

        // Process stats
        if (status === 'won') {
            setConsecutiveLosses(0);
            setCurrentStake(stakeRef.current);
            setLastResultDisplay('WIN');
        } else if (status === 'lost') {
            setConsecutiveLosses(prev => prev + 1);
            if (martingaleEnabledRef.current) {
                setCurrentStake(prev =>
                    Number((prev * martingaleMultiplierRef.current).toFixed(2))
                );
            }
            setLastResultDisplay('LOSS');
        }
    }, [showToast]);

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
            '1HZ50V': '1HZ50V',
        };
        return map[vol] || 'R_10';
    };

    const getPrecision = (symbol: string, packetPipSize?: number) => {
        // 1. Highest priority: explicit pip size from the packet (Live Ticks)
        if (packetPipSize !== undefined && packetPipSize > 0) {
            if (packetPipSize < 1) return Math.round(Math.abs(Math.log10(packetPipSize)));
            return packetPipSize;
        }

        // 2. Second priority: server-provided pip sizes (from active_symbols)
        if (api_base.pip_sizes?.[symbol]) {
            const pip = api_base.pip_sizes[symbol];
            if (pip < 1) return Math.round(Math.abs(Math.log10(pip)));
            return pip;
        }

        // 3. Fallbacks for known asset classes
        if (symbol.includes('1HZ')) return 2;
        if (symbol.includes('R_100')) return 2;
        if (symbol.includes('JD')) return 3; // Jump indices typically use 3 decimals for last digit

        // Better defaults based on common Deriv indices
        if (symbol === 'R_10' || symbol === 'R_25' || symbol === 'R_50') return 3;
        if (symbol === 'R_75') return 4;

        return 2; // Safe default
    };

    const getContractType = () => {
        const type = tradeTypeRef.current;
        if (type === 'DIGITDIFF') return 'DIGITDIFF';
        if (type === 'DIGITEVEN') return 'DIGITEVEN';
        if (type === 'DIGITODD') return 'DIGITODD';
        if (type === 'DIGITOVER') return 'DIGITOVER';
        if (type === 'DIGITUNDER') return 'DIGITUNDER';
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

    // -- MOVED LOGIC START --
    const checkEntryCondition = () => {
        if (!entryEnabledRef.current) return true;

        const lastDigits = digitHistoryRef.current;
        if (lastDigits.length === 0) return false;

        const latest = lastDigits[lastDigits.length - 1];

        if (entryPointRef.current === 'single') {
            return latest === entryDigitRef.current;
        }
        if (entryPointRef.current === 'double' && lastDigits.length >= 2) {
            const prev = lastDigits[lastDigits.length - 2];
            const start = digitRangeStartRef.current;
            const end = digitRangeEndRef.current;
            return (
                prev >= start &&
                prev <= end &&
                latest >= start &&
                latest <= end
            );
        }
        if (entryPointRef.current === 'last_even') {
            return latest % 2 === 0;
        }
        if (entryPointRef.current === 'last_odd') {
            return latest % 2 !== 0;
        }
        if (entryPointRef.current === 'last_five_even' && lastDigits.length >= 5) {
            return lastDigits.slice(-5).every(d => d % 2 === 0);
        }
        if (entryPointRef.current === 'even_percent') {
            const evens = ldpStats.reduce((acc, count, d) => (d % 2 === 0 ? acc + count : acc), 0);
            const total = ldpStats.reduce((acc, count) => acc + count, 0);
            return total > 0 && evens / total >= 0.6;
        }

        return false;
    };

    const executeTrade = async (req: any, tradeStake: number, contract_type: string, _prefetchedProposal?: any, batchId?: number, batchSize?: number) => {
        try {
            // Speed bot optimization: Buy by Parameters (Single round-trip)
            console.log(`[StoopBot] Executing direct buy for ${contract_type}:`, req);
            setDebugStatus(`Purchasing...`);
            addJournal(`Purchasing ${contract_type}...`, 'info', req.barrier);
            run_panel.setContractStage(contract_stages.PURCHASE_SENT);

            const buyRequest = {
                buy: 1,
                price: tradeStake,
                subscribe: 1,
                parameters: {
                    amount: tradeStake,
                    basis: 'stake',
                    contract_type: contract_type,
                    currency: req.currency || 'USD',
                    duration: req.duration,
                    duration_unit: req.duration_unit || 't',
                    symbol: req.symbol,
                    barrier: req.barrier,
                },
                passthrough: req.passthrough
            };

            const buyRes: any = await api_base.api.send(buyRequest);

            if (buyRes.buy) {
                console.log(`[StoopBot] Buy successful:`, buyRes.buy);
                setDebugStatus(`Success!`);
                addJournal(`Buy successful: Contract ID ${buyRes.buy.contract_id}`, 'trade', req.barrier);
                run_panel.setContractStage(contract_stages.PURCHASE_RECEIVED);

                // Update balance optimistically
                client.updateBalanceOnTrade(tradeStake);

                setTransactions(prev => {
                    const existing = prev.find(tx => String(tx.id) === String(buyRes.buy.contract_id));
                    if (existing) {
                        if (existing.batch_id) return prev;
                        return prev.map(tx => String(tx.id) === String(buyRes.buy.contract_id)
                            ? { ...tx, batch_id: batchId, batch_size: batchSize }
                            : tx
                        );
                    }

                    const newTx: Transaction = {
                        id: buyRes.buy.contract_id,
                        ref: buyRes.buy.transaction_id,
                        contract_type: contract_type,
                        stake: tradeStake,
                        payout: buyRes.buy.payout || 0, // Fallback to 0 if not present
                        profit: '0.00',
                        status: 'running',
                        timestamp: Date.now(),
                        barrier: req.barrier,
                        batch_id: batchId,
                        batch_size: batchSize
                    };
                    return [newTx, ...prev];
                });

                if (batchId) {
                    pendingBatchRef.current.set(String(buyRes.buy.contract_id), { id: batchId, size: batchSize || 1 });
                }
                activeContractIdsRef.current.add(String(buyRes.buy.contract_id));

                // Emit events
                botObserver.emit('bot.running');
                botObserver.emit('contract.status', {
                    id: 'contract.purchase_received',
                    buy: buyRes.buy
                });

                // Only show success toast for single trades to avoid spam
                if (!isAutoTrading && (!bulkEnabled || bulkTrades === 1)) {
                    showToast('Trade placed successfully!');
                }
            } else if (buyRes.error) {
                console.error(`[StoopBot] Buy error:`, buyRes.error);
                showToast(buyRes.error.message);
                setDebugStatus(`Buy error: ${buyRes.error.code}`);
            }
        } catch (e: any) {
            console.error('[StoopBot] Execution exception:', e);
            showToast('Trade error: ' + (e.message || e));
            setDebugStatus(`Exec exception`);
        }
    };

    const tradeOnce = async (customStake?: number, customBarrier?: number) => {
        try {
            // Sanitize arguments to prevent Event objects from being passed as stake
            const safeStake = typeof customStake === 'number' ? customStake : undefined;
            const safeBarrier = typeof customBarrier === 'number' ? customBarrier : undefined;

            if (!api_base.api) {
                showToast('API not ready');
                return;
            }

            if (isTrading) return;

            console.log('[StoopBot] tradeOnce check:', {
                is_virtual: client.is_virtual,
                is_logged_in: client.is_logged_in,
                isAuthorized,
                api_exists: !!api_base.api
            });

            if (!client.is_logged_in && !isAuthorized) {
                showToast('Please wait for authorization...');
                return;
            }

            if (!api_base.api) {
                showToast('API instance not found. Reconnecting...');
                api_base.init(true);
                return;
            }

            // Enforce Entry Condition for Manual Trades too
            if (entryEnabledRef.current && !checkEntryCondition()) {
                showToast('Waiting for entry condition...');
                setDebugStatus('Waiting for entry...');
                return;
            }

            const symbol = getSymbol(volatilityRef.current);
            const contract_type = getContractType();
            const defaultStake = safeStake || (martingaleEnabledRef.current ? currentStakeRef.current : stakeRef.current);

            const configs: { barrier?: number; stake: number }[] = [];

            // 1. Determine Trade Configurations
            if (safeBarrier !== undefined) {
                configs.push({ barrier: safeBarrier, stake: defaultStake });
            }
            else if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contract_type)) {
                if (predictionModeRef.current === 'multi' && predictionsRef.current.length > 0) {
                    predictionsRef.current.forEach(p => {
                        configs.push({ barrier: p.digit, stake: p.stake });
                    });
                } else if (predictionModeRef.current === 'recovery') {
                    const val = consecutiveLossesRef.current > 0 ? Number(predPostRef.current) : Number(predPreRef.current);
                    const contractType = consecutiveLossesRef.current > 0 ? recoveryContractTypeRef.current : contract_type;
                    configs.push({ barrier: val, stake: defaultStake, contract_type: contractType });
                } else {
                    configs.push({ barrier: singleDigitRef.current, stake: defaultStake });
                }
            } else {
                configs.push({ stake: defaultStake });
            }

            const baseReq: any = {
                proposal: 1,
                basis: 'stake',
                contract_type: contract_type,
                currency: client.currency || 'USD',
                duration: ticksRef.current,
                duration_unit: 't',
                symbol: symbol,
            };

            setIsTrading(true);
            isTradingRef.current = true;

            let count = 1;
            if (bulkEnabledRef.current) {
                count = bulkTradesRef.current;
            }

            const totalTrades = count * configs.length;
            console.log(`[StoopBot] Preparing to execute ${totalTrades} trades. Configs:`, configs);

            if (totalTrades === 0) {
                setDebugStatus('No trades to run (Config empty)');
                setIsTrading(false);
                isTradingRef.current = false;
                return;
            }

            if (!isAutoTrading) {
                showToast(totalTrades > 1 ? `Placing ${totalTrades} trades...` : 'Placing trade...');
            }

            setDebugStatus(`Preparing ${totalTrades} trade(s)...`);

            // Execution phase: Execute all buy orders simultaneously
            setDebugStatus(`Executing ${totalTrades} trade(s)...`);
            const batchId = totalTrades > 1 ? Date.now() : undefined;
            const promises: Promise<any>[] = [];

            for (let i = 0; i < count; i++) {
                for (const cfg of configs) {
                    const specificReq = {
                        ...baseReq,
                        amount: cfg.stake,
                        passthrough: { batch_idx: i, batch_id: batchId || Date.now() }
                    };
                    if (cfg.barrier !== undefined) specificReq.barrier = cfg.barrier;
                    if (cfg.contract_type) specificReq.contract_type = cfg.contract_type;

                    promises.push(executeTrade(specificReq, cfg.stake, specificReq.contract_type, undefined, batchId, totalTrades));
                }
            }

            await Promise.all(promises);

            // Phase 3: Auto-stop if bulk trading is on
            if (bulkEnabledRef.current && isAutoTradingRef.current) {
                console.log('[StoopBot] Bulk cycle complete. Stopping auto-trader.');
                addJournal('Bulk trading cycle complete. Auto-stop triggered.', 'info');
                setIsAutoTrading(false);
                botObserver.emit('bot.stop');
                run_panel.setIsRunning(false);
            }
        } catch (e: any) {
            console.error('[StoopBot] tradeOnce Critical Error:', e);
            showToast('System Error: ' + (e.message || e));
            setDebugStatus('System Error');
        } finally {
            if (activeContractIdsRef.current.size === 0) {
                setIsTrading(false);
                isTradingRef.current = false;
                setDebugStatus('Ready');
            }
        }
    };

    const startAuto = useCallback(() => {
        if (isAutoTrading) {
            setIsAutoTrading(false);
            showToast('Auto Trading Stopped');
            botObserver.emit('bot.stop');
            run_panel.setIsRunning(false);
            return;
        }

        if (!client.is_logged_in && !isAuthorized) {
            showToast('Please wait for authorization...');
            return;
        }

        if (!api_base.api) {
            showToast('API instance not found. Reconnecting...');
            api_base.init(true);
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
        activeContractIdsRef.current.clear();
        setIsTrading(false);
        hasTriggeredEntryRef.current = false;

        setIsAutoTrading(true);
        showToast('Auto Trading Started');
        botObserver.emit('bot.running');
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
    }, [isAutoTrading, client.is_virtual, client.is_logged_in, isAuthorized, showToast, stake, run_panel]);

    // -- MOVED LOGIC END --
    const runAutoEngine = useCallback(() => {
        if (!isAutoTradingRef.current || isTradingRef.current) return;

        // Check limits
        if (stopLossTotalEnabledRef.current && totalProfitRef.current <= stopLossTotalRef.current) {
            setIsAutoTrading(false);
            showToast('Stop Loss Reached!');
            return;
        }
        if (takeProfitEnabledRef.current && totalProfitRef.current >= takeProfitTotalRef.current) {
            setIsAutoTrading(false);
            showToast('Take Profit Reached!');
            return;
        }
        if (
            stopLossConsecutiveEnabledRef.current &&
            consecutiveLossesRef.current >= stopLossConsecutiveRef.current
        ) {
            setIsAutoTrading(false);
            showToast('Max Consecutive Losses Reached!');
            return;
        }

        // Check Entry and Execute
        const isEntryMet = checkEntryCondition();

        if (isEntryMet) {
            console.log('[StoopBot] Entry condition met. Executing trade.');

            setDebugStatus(runModeRef.current === 'once' ? 'Running (Once)' : 'Running (Continuous)');
            tradeOnce(currentStakeRef.current);

            if (runModeRef.current === 'once') {
                console.log('[StoopBot] Run Once complete. Stopping auto-trader.');
                setIsAutoTrading(false);
                isAutoTradingRef.current = false;
                botObserver.emit('bot.stop');
                run_panel.setIsRunning(false);
            }
        } else {
            setDebugStatus('Waiting for entry condition...');
        }
    }, []); // Empty deps because it uses refs

    const updateLdpStats = useCallback(() => {
        if (digitHistoryRef.current.length === 0) {
            setLdpStats(Array(10).fill(0));
            setEntropy('0.00');
            return;
        }
        const counts = Array(10).fill(0);
        digitHistoryRef.current.forEach(d => counts[d]++);

        const ent = calculateEntropy(counts, digitHistoryRef.current.length);
        setEntropy(ent);
    }, []);

    const updateLdpGrid = useCallback((lastDigit: number) => {
        const total = digitHistoryRef.current.length;
        if (total === 0) return;

        const counts = Array(10).fill(0);
        digitHistoryRef.current.forEach(d => counts[d]++);
        const maxVal = Math.max(...counts);

        counts.forEach((count, d) => {
            const cell = ldpCellsRef.current[d];
            if (cell) {
                const intensity = maxVal > 0 ? count / maxVal : 0;
                const hue = 120 - intensity * 100 * 1.2;
                const bgColor = `hsl(${hue}, 75%, ${35 + intensity * 0.3 * 100}%)`;
                cell.style.backgroundColor = bgColor;

                const percentVal = total > 0 ? (count / total) * 100 : 0;
                const percentEl = cell.querySelector('.percent-text');
                const countEl = cell.querySelector('.count');

                if (percentEl) percentEl.textContent = `${percentVal.toFixed(1)}%`;
                if (countEl) countEl.textContent = String(count);

                if (d === lastDigit) cell.classList.add('cursor-active');
                else cell.classList.remove('cursor-active');
            }
        });
    }, []);

    const processTick = useCallback((quote: number, precision: number) => {
        const digitStr = quote.toFixed(precision).slice(-1);
        const digit = parseInt(digitStr, 10);
        const color = digit <= 3 ? 'red' : digit <= 6 ? 'orange' : 'green';
        return { digit, color };
    }, []);

    const updateLiveDigits = useCallback((item: { value: number; color: string }) => {
        liveDigitsBufferRef.current.push(item);
        if (liveDigitsBufferRef.current.length > 40) {
            liveDigitsBufferRef.current.shift();
        }

        if (liveDigitsRef.current) {
            const newDigitHtml = `<div class="digit ${item.color}">${item.value}</div>`;
            liveDigitsRef.current.insertAdjacentHTML('beforeend', newDigitHtml);
            if (liveDigitsRef.current.children.length > 40) {
                liveDigitsRef.current.firstElementChild?.remove();
            }
        }
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
            if (activeSubscriptionId && api_base.api) {
                api_base.api.send({ forget: activeSubscriptionId }).catch(() => { });
                activeSubscriptionId = null;
                subscriptionIdRef.current = null;
            }
            if (messageConfig) {
                messageConfig.unsubscribe();
                messageConfig = null;
            }
            if (retryTimeout) clearTimeout(retryTimeout);
        };

        const initData = async () => {
            if (!api_base.api || connectionStatus !== 'opened') return;

            try {
                setDebugStatus('Initializing...');
                if (!api_base.has_active_symbols) {
                    setDebugStatus('Waiting for Market Data...');
                    await api_base.active_symbols_promise;
                }

                setDigits([]);
                liveDigitsBufferRef.current = [];
                if (liveDigitsRef.current) liveDigitsRef.current.innerHTML = '';

                setLdpStats(Array(10).fill(0));
                setEntropy('—');
                setLastDigit('—');
                if (lastDigitRef.current) lastDigitRef.current.textContent = '—';
                digitHistoryRef.current = [];

                const res: any = await api_base.api.send({
                    ticks_history: symbol,
                    adjust_start_time: 1,
                    count: 1000,
                    end: 'latest',
                    style: 'ticks',
                });

                if (isMounted && res.history && res.history.prices) {
                    const precision = getPrecision(symbol, res.pip_size || res.history.pip_size);
                    const historicalDigits: number[] = [];
                    const last40 = res.history.prices.slice(-40);

                    res.history.prices.forEach((price: number) => {
                        const { digit } = processTick(price, precision);
                        historicalDigits.push(digit);
                    });

                    last40.forEach((p: number) => {
                        const { digit, color } = processTick(p, precision);
                        updateLiveDigits({ value: digit, color });
                    });

                    digitHistoryRef.current = historicalDigits.slice(-1000);
                    if (digitHistoryRef.current.length > 0) {
                        const lastD = digitHistoryRef.current[digitHistoryRef.current.length - 1];
                        setLastDigit(lastD);
                        if (lastDigitRef.current) lastDigitRef.current.textContent = String(lastD);
                        updateLdpGrid(lastD);
                    }
                    updateLdpStats();
                }

                if (isMounted) {
                    setDebugStatus('Subscribing...');
                    const subRes: any = await api_base.api.send({ ticks: symbol, subscribe: 1 });
                    if (subRes.subscription) {
                        activeSubscriptionId = subRes.subscription.id;
                        subscriptionIdRef.current = activeSubscriptionId;
                        setDebugStatus('Ready (Live)');
                        addJournal(`Subscribed to ${symbol} (Live)`, 'info');
                    } else {
                        setDebugStatus('Ready (Polling)');
                    }
                }
            } catch (err: any) {
                setDebugStatus(`Error: ${err.message || 'Unknown'}`);
            }
        };

        const handleTick = (response: any) => {
            if (!isMounted) return;
            const msg = response.data || response;
            const tick = msg.tick || msg.ohlc || (msg.msg_type === 'tick' ? msg : null);
            if (!tick) return;

            const incomingSymbol = String(tick.symbol || msg.symbol || '').trim().toUpperCase();
            if (incomingSymbol === symbol.toUpperCase() || targetSymbol.includes(incomingSymbol)) {
                const quote = tick.quote ?? tick.close ?? tick.last_tick;
                if (quote === undefined) return;

                setTicksCount(prev => prev + 1);
                const precision = getPrecision(symbol, tick.pip_size);
                const { digit, color } = processTick(quote, precision);
                setLastTickColor(color);

                updateLiveDigits({ value: digit, color });
                if (lastDigitRef.current) {
                    lastDigitRef.current.textContent = String(digit);
                    lastDigitRef.current.classList.remove('tick-flash');
                    void lastDigitRef.current.offsetWidth;
                    lastDigitRef.current.classList.add('tick-flash');
                }

                digitHistoryRef.current.push(digit);
                if (digitHistoryRef.current.length > 1000) digitHistoryRef.current.shift();
                updateLdpStats();
                updateLdpGrid(digit);

                if (isAutoTradingRef.current) runAutoEngine();
            }
        };

        if (api_base.api && connectionStatus === 'opened') {
            messageConfig = api_base.api.onMessage().subscribe(handleTick);
            initData();
        }
        return cleanup;
    }, [volatility, updateLdpStats, connectionStatus, processTick, updateLiveDigits]);

    // -- Transaction Monitor --
    useEffect(() => {
        if (!api_base.api) return;
        const sub = api_base.api.onMessage().subscribe(response => {
            if (response.proposal_open_contract) {
                const poc = response.proposal_open_contract;
                const contractId = String(poc.contract_id);
                const isActive = activeContractIdsRef.current.has(contractId);
                const isKnown = isActive || transactionsRef.current.some(t => String(t.id) === contractId);

                if (isKnown && (poc.status === 'won' || poc.status === 'lost')) {
                    addJournal(`Result: ${contractId} ${poc.status.toUpperCase()}`, poc.status === 'won' ? 'success' : 'error');
                }

                let statusToProcess: Transaction['status'] | null = null;
                setTransactions(prev => {
                    const existingIndex = prev.findIndex(tx => String(tx.id) === contractId);
                    if (existingIndex === -1) {
                        if (isActive) {
                            const status = (poc.status === 'won' || Number(poc.profit) > 0) ? 'won' : (poc.status === 'lost' || Number(poc.profit) < 0) ? 'lost' : 'running';
                            const batchInfo = pendingBatchRef.current.get(contractId);
                            const newTx: Transaction = {
                                id: poc.contract_id,
                                ref: poc.transaction_id || poc.id,
                                contract_type: poc.contract_type,
                                stake: poc.buy_price || 0,
                                payout: poc.payout || 0,
                                profit: poc.profit || '0.00',
                                status,
                                timestamp: Date.now(),
                                batch_id: batchInfo?.id,
                                batch_size: batchInfo?.size
                            };
                            if (poc.is_sold || poc.status === 'won' || poc.status === 'lost') statusToProcess = status;
                            return [newTx, ...prev];
                        }
                        return prev;
                    }

                    const tx = prev[existingIndex];
                    let status = tx.status;
                    if (poc.is_sold || poc.status === 'won' || poc.status === 'lost') {
                        status = (poc.status === 'won' || Number(poc.profit) > 0) ? 'won' : 'lost';
                        if (isActive) statusToProcess = status;
                    } else if (poc.status === 'open') {
                        status = 'running';
                    }

                    const lastDigitFunc = (val: any) => {
                        const str = String(val);
                        return str ? parseInt(str.slice(-1), 10) : undefined;
                    };

                    const batchInfo = pendingBatchRef.current.get(contractId);
                    const updatedTx = {
                        ...tx,
                        status,
                        profit: poc.profit !== undefined ? Number(poc.profit).toFixed(2) : tx.profit,
                        exit_digit: lastDigitFunc(poc.exit_tick_display_value) ?? tx.exit_digit,
                        entry_digit: lastDigitFunc(poc.entry_tick_display_value) ?? tx.entry_digit,
                        batch_id: tx.batch_id || batchInfo?.id,
                        batch_size: tx.batch_size || batchInfo?.size
                    };
                    const next = [...prev];
                    next[existingIndex] = updatedTx;
                    return next;
                });

                if (statusToProcess) handleTradeCompletion(poc, statusToProcess);
                botObserver.emit('bot.contract', { ...poc, id: poc.contract_id });
                if (poc.is_sold) run_panel.setContractStage(contract_stages.CONTRACT_CLOSED);
            }
        });
        return () => sub.unsubscribe();
    }, [connectionStatus, run_panel]);

    // -- Polling Cleanup --
    useEffect(() => {
        const interval = setInterval(() => {
            Array.from(activeContractIdsRef.current).forEach(id => {
                api_base.api.send({ proposal_open_contract: 1, contract_id: Number(id) })
                    .then((res: any) => {
                        if (res.proposal_open_contract) {
                            const poc = res.proposal_open_contract;
                            if (poc.is_sold) {
                                let statusToProcess: Transaction['status'] | null = null;
                                setTransactions(prev => {
                                    const idx = prev.findIndex(tx => String(tx.id) === String(id));
                                    if (idx === -1) return prev;
                                    const status = (poc.status === 'won' || Number(poc.profit) > 0) ? 'won' : 'lost';
                                    statusToProcess = status;
                                    const next = [...prev];
                                    next[idx] = { ...prev[idx], status, profit: Number(poc.profit).toFixed(2) };
                                    return next;
                                });
                                if (statusToProcess) handleTradeCompletion(poc, statusToProcess);
                            }
                        }
                    });
            });
        }, 3000);
        return () => clearInterval(interval);
    }, [handleTradeCompletion]);

    useEffect(() => {
        let wins = 0, losses = 0;
        const total = transactions.reduce((acc, tx) => {
            if (tx.status === 'won') { wins++; return acc + (tx.payout - tx.stake); }
            if (tx.status === 'lost') { losses++; return acc - tx.stake; }
            return acc;
        }, 0);
        setTotalProfit(total);
        setTotalWins(wins);
        setTotalLosses(losses);
    }, [transactions]);

    const isEvenOdd = tradeType === 'DIGITEVEN' || tradeType === 'DIGITODD';

    return (
        <div className='stoop-bot-page'>
            <div className='container'>
                <div className='grid'>
                    <section className='card'>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>Stoop Bot configuration</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: connectionStatus === 'opened' ? '#4caf50' : '#f44336' }}></div>
                                <span style={{ fontSize: '11px', color: '#888' }}>{connectionStatus === 'opened' ? 'Live' : 'Offline'}</span>
                            </div>
                        </div>
                        <form onSubmit={e => e.preventDefault()}>
                            <label>Volatility:
                                <select value={volatility} onChange={e => setVolatility(e.target.value)}>
                                    <option value='1HZ50V'>Volatility 50 (1s) Index</option>
                                    <option value='R_10'>Volatility 10 Index</option>
                                    <option value='R_100'>Volatility 100 Index</option>
                                </select>
                            </label>
                            <label>Trade type:
                                <select value={tradeType} onChange={e => handleTradeTypeChange(e.target.value)}>
                                    <option value='DIGITDIFF'>Digit Differs</option>
                                    <option value='DIGITMATCH'>Digit Matches</option>
                                </select>
                            </label>
                            <div className='row'>
                                <label>Ticks: <input type='number' value={ticks} min='1' onChange={e => setTicks(Number(e.target.value))} /></label>
                                <label>Stake: <input type='number' step='0.01' value={stake} min='0.01' onChange={e => setStake(Number(e.target.value))} /></label>
                            </div>
                            <div className='toggle' onClick={() => setBulkEnabled(!bulkEnabled)}>
                                <input type='checkbox' checked={bulkEnabled} readOnly /> <label>Bulk trading</label>
                            </div>
                            <div className='toggle' onClick={() => setEntryEnabled(!entryEnabled)}>
                                <input type='checkbox' checked={entryEnabled} readOnly /> <label>Entry condition</label>
                            </div>
                        </form>
                    </section>
                    <section className='card'>
                        <h3>Live Data</h3>
                        <div className='live-digits-wrapper'><div className='digits' ref={liveDigitsRef}></div></div>
                        <div className='ldp-grid'>
                            {Array.from({ length: 10 }).map((_, d) => (
                                <div key={d} ref={el => (ldpCellsRef.current[d] = el)} className='ldp-cell' onClick={() => handleDigitClick(d)}>
                                    <div className='digit-num'>{d}</div>
                                    <div className='percent-text'>0.0%</div>
                                    <div className='count'>0</div>
                                </div>
                            ))}
                        </div>
                        <div className='activity-panel'>
                            <div className='run-btn-group' ref={runMenuRef}>
                                <button className={clsx('run-btn', 'main', isAutoTrading && 'running')} onClick={startAuto}>
                                    {isAutoTrading ? 'Stop' : runMode === 'once' ? 'Run Once' : 'Run Auto'}
                                </button>
                                <button className='run-btn arrow' onClick={() => setShowRunMenu(!showRunMenu)}>▼</button>
                                {showRunMenu && (
                                    <div className='run-mode-menu'>
                                        <div className={clsx('mode-item', runMode === 'continuous' && 'active')} onClick={() => { setRunMode('continuous'); setShowRunMenu(false); }}>Continuous</div>
                                        <div className={clsx('mode-item', runMode === 'once' && 'active')} onClick={() => { setRunMode('once'); setShowRunMenu(false); }}>Once</div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className='sb-tabs'>
                            {['summary', 'transactions', 'journal'].map(t => (
                                <div key={t} className={clsx('sb-tab', activeTab === t && 'active')} onClick={() => setActiveTab(t as any)}>{t}</div>
                            ))}
                        </div>
                        <div className='sb-content'>
                            {activeTab === 'transactions' && (
                                <div className='tx-list'>
                                    {transactions.map(tx => (
                                        <div key={tx.id} className='tx-row'>
                                            <span>{tx.contract_type}</span>
                                            <span>{tx.entry_digit} / {tx.exit_digit}</span>
                                            <span className={tx.status}>{tx.profit} USD</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
            {toastMessage && <div className='alert-toast'>{toastMessage}</div>}
        </div>
    );
});

export default StoopBot;
