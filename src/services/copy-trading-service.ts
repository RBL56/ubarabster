import { api_base } from '@/external/bot-skeleton';

interface ClientAccount {
    token: string;
    masked: string;
    loginid: string;
    balance: string;
    currency: string;
    isVirtual: boolean;
}

interface CopyTradingSettings {
    maxStakePercent: number;
    stakeMultiplier: number;
    copyToClients: boolean;
}

interface TradeTransaction {
    contract_type: string;
    amount?: number;
    buy_price?: number;
    basis?: string;
    symbol: string;
    duration?: number;
    duration_unit?: string;
    transaction_id?: string;
    contract_id?: string;
}

type NotificationCallback = (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

class CopyTradingService {
    private static instance: CopyTradingService;
    private isActive = false;
    private clients: ClientAccount[] = [];
    private settings: CopyTradingSettings = {
        maxStakePercent: 5,
        stakeMultiplier: 1,
        copyToClients: true,
    };
    private clientSockets = new Map<string, WebSocket>();
    private recentTxIds = new Set<string>();
    private lastRequestTime = 0;
    private readonly MIN_DELAY_MS = 600;
    private readonly WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=120181';
    private notificationCallback: NotificationCallback | null = null;

    private constructor() { }

    static getInstance(): CopyTradingService {
        if (!CopyTradingService.instance) {
            CopyTradingService.instance = new CopyTradingService();
        }
        return CopyTradingService.instance;
    }

    setNotificationCallback(callback: NotificationCallback) {
        this.notificationCallback = callback;
    }

    private notify(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') {
        if (this.notificationCallback) {
            this.notificationCallback(message, type);
        }
    }

    enableCopyTrading(clients: ClientAccount[], settings: CopyTradingSettings) {
        this.isActive = true;
        this.clients = clients;
        this.settings = settings;
        this.connectClients();
        console.log('[CopyTradingService] Copy trading enabled', { clients: clients.length, settings });
    }

    disableCopyTrading() {
        this.isActive = false;
        this.disconnectClients();
        console.log('[CopyTradingService] Copy trading disabled');
    }

    updateSettings(settings: Partial<CopyTradingSettings>) {
        this.settings = { ...this.settings, ...settings };
    }

    updateClients(clients: ClientAccount[]) {
        this.clients = clients;
        if (this.isActive) {
            this.disconnectClients();
            this.connectClients();
        }
    }

    private connectClients() {
        this.clients.forEach((client, index) => {
            if (!client.token || this.clientSockets.has(client.token)) return;

            const ws = new WebSocket(this.WS_URL);
            this.clientSockets.set(client.token, ws);

            ws.onopen = () => {
                ws.send(JSON.stringify({ authorize: client.token }));
            };

            ws.onmessage = (e) => {
                const data = JSON.parse(e.data);
                if (data.error) {
                    this.notify(`Client Error (${client.loginid}): ${data.error.message}`, 'error');
                    return;
                }

                if (data.authorize) {
                    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
                    this.notify(`Client Connected: ${data.authorize.loginid}`, 'success');
                }
            };

            ws.onerror = () => {
                this.notify(`Connection error for client ${client.loginid}`, 'error');
            };

            ws.onclose = () => {
                this.clientSockets.delete(client.token);
            };
        });
    }

    private disconnectClients() {
        this.clientSockets.forEach(ws => ws.close());
        this.clientSockets.clear();
    }

    async onMasterTrade(transaction: TradeTransaction) {
        if (!this.isActive || !this.settings.copyToClients) {
            return;
        }

        const txId = transaction.transaction_id || transaction.contract_id;
        if (!txId || this.recentTxIds.has(txId)) {
            return;
        }

        // Mark transaction as processed
        this.recentTxIds.add(txId);
        setTimeout(() => this.recentTxIds.delete(txId), 300000); // 5 min cleanup

        console.log('[CopyTradingService] Replicating trade', transaction);

        // Filter eligible clients (active, real accounts)
        const eligibleClients = this.clients.filter(c => {
            const ws = this.clientSockets.get(c.token);
            return ws && ws.readyState === WebSocket.OPEN && !c.isVirtual;
        });

        if (eligibleClients.length === 0) {
            this.notify('No eligible clients to copy trade to', 'warning');
            return;
        }

        // Copy to each client with staggered timing
        eligibleClients.forEach((client, idx) => {
            setTimeout(async () => {
                await this.copyTradeToClient(client, transaction);
            }, idx * 800);
        });
    }

    private async copyTradeToClient(client: ClientAccount, masterTx: TradeTransaction) {
        const ws = this.clientSockets.get(client.token);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            // Calculate stake with multiplier and limits
            const multiplier = this.settings.stakeMultiplier || 1;
            let safeAmount = (masterTx.amount || masterTx.buy_price || 10) * multiplier;

            const balanceVal = parseFloat(client.balance.split(' ')[0]) || 0;
            const maxStake = (balanceVal * this.settings.maxStakePercent) / 100;
            safeAmount = Math.min(safeAmount, maxStake);

            // Build proposal request
            const proposalReq = {
                proposal: 1,
                amount: safeAmount,
                basis: masterTx.basis || 'stake',
                contract_type: masterTx.contract_type,
                currency: client.currency || 'USD',
                symbol: masterTx.symbol,
                duration: masterTx.duration || 5,
                duration_unit: masterTx.duration_unit || 't',
            };

            const reqId = Date.now() + Math.random();

            // Rate limiting
            const now = Date.now();
            const delay = Math.max(0, this.lastRequestTime + this.MIN_DELAY_MS - now);
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay));
            }

            // Send proposal and wait for response
            await new Promise<void>((resolve) => {
                const onMsg = (e: MessageEvent) => {
                    const d = JSON.parse(e.data);
                    if (d.req_id === reqId) {
                        ws.removeEventListener('message', onMsg);
                        if (d.error) {
                            this.notify(
                                `Proposal failed for ${client.loginid}: ${d.error.message}`,
                                'error'
                            );
                            resolve();
                        } else if (d.proposal?.id) {
                            // Buy the contract
                            ws.send(
                                JSON.stringify({
                                    buy: d.proposal.id,
                                    price: d.proposal.ask_price || proposalReq.amount
                                })
                            );
                            this.notify(`Copied to ${client.loginid} ($${safeAmount.toFixed(2)})`, 'success');
                            resolve();
                        }
                    }
                };
                ws.addEventListener('message', onMsg);
                ws.send(JSON.stringify({ ...proposalReq, req_id: reqId }));
            });

            this.lastRequestTime = Date.now();
        } catch (error) {
            console.error('[CopyTradingService] Error copying trade:', error);
            this.notify(`Failed to copy trade to ${client.loginid}`, 'error');
        }
    }

    getStatus() {
        return {
            isActive: this.isActive,
            clientCount: this.clients.length,
            connectedClients: this.clientSockets.size,
            settings: this.settings,
        };
    }
}

export default CopyTradingService.getInstance();
