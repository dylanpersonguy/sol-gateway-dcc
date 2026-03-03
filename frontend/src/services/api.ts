import axios, { AxiosInstance } from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

class BridgeApi {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async createDeposit(params: {
    sender: string;
    recipientDcc: string;
    amount: number;
    splMint?: string;
  }) {
    const { data } = await this.client.post('/deposit', params);
    return data;
  }

  async createRedeem(params: {
    sender: string;
    solRecipient: string;
    amount: number;
    splMint?: string;
  }) {
    const { data } = await this.client.post('/redeem', params);
    return data;
  }

  async getTransfer(transferId: string) {
    const { data } = await this.client.get(`/transfer/${transferId}`);
    return data;
  }

  async getTransferHistory(address: string, page = 1, limit = 20) {
    const { data } = await this.client.get(`/transfer/history/${address}`, {
      params: { page, limit },
    });
    return data;
  }

  async getHealth() {
    const { data } = await this.client.get('/health');
    return data;
  }

  async getStats() {
    const { data } = await this.client.get('/stats');
    return data;
  }

  async getDepositLimits() {
    const { data } = await this.client.get('/deposit/limits');
    return data;
  }

  async getRedeemLimits() {
    const { data } = await this.client.get('/redeem/limits');
    return data;
  }
}

export const bridgeApi = new BridgeApi();
