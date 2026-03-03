// ═══════════════════════════════════════════════════════════════
// ANOMALY DETECTION — Independent Bridge Monitor
// ═══════════════════════════════════════════════════════════════
//
// Runs independently from the validator network to provide
// defense-in-depth monitoring. Can trigger emergency pause
// if anomalies are detected.
//
// DETECTION CATEGORIES:
// 1. Supply mismatch (wSOL.DCC supply > locked SOL)
// 2. Abnormal volume spikes
// 3. Large single transactions
// 4. Rapid-fire transactions (possible exploit)
// 5. Validator fault patterns
// 6. Chain desynchronization
// 7. Balance drift (vault balance vs expected)

import { EventEmitter } from 'events';
import { Logger } from 'winston';

export interface MonitorConfig {
  // Supply monitoring
  maxSupplyDriftPercent: number;  // e.g., 0.01 = 1% tolerance
  
  // Volume monitoring 
  maxHourlyVolume: bigint;        // lamports
  volumeSpikeMultiplier: number;  // e.g., 10x normal volume
  
  // Transaction monitoring
  largeTransactionThreshold: bigint;
  maxTransactionsPerMinute: number;
  
  // Validator monitoring
  maxValidatorFaultRate: number;  // e.g., 0.1 = 10% fault rate
  minActiveValidators: number;
  
  // Chain monitoring
  maxBlockLatency: number;        // seconds
  maxChainDesyncBlocks: number;
}

export interface AnomalyAlert {
  id: string;
  severity: 'info' | 'warning' | 'critical' | 'emergency';
  category: string;
  message: string;
  data: Record<string, any>;
  timestamp: number;
  autoPause: boolean;  // Whether this should trigger emergency pause
}

export class AnomalyDetector extends EventEmitter {
  private config: MonitorConfig;
  private logger: Logger;
  
  // Sliding window data
  private hourlyVolume: bigint = 0n;
  private hourlyVolumeReset: number = Date.now();
  private recentTransactions: number[] = [];  // timestamps
  private alerts: AnomalyAlert[] = [];

  constructor(config: MonitorConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  /**
   * Check supply invariant: wSOL.DCC supply must <= locked SOL
   */
  checkSupplyInvariant(lockedSol: bigint, wsolSupply: bigint): void {
    if (wsolSupply > lockedSol) {
      const drift = Number(wsolSupply - lockedSol) / Number(lockedSol);
      
      this.raiseAlert({
        id: `supply_mismatch_${Date.now()}`,
        severity: 'emergency',
        category: 'supply_invariant',
        message: `CRITICAL: wSOL.DCC supply (${wsolSupply}) EXCEEDS locked SOL (${lockedSol})`,
        data: { lockedSol: lockedSol.toString(), wsolSupply: wsolSupply.toString(), drift },
        timestamp: Date.now(),
        autoPause: true,
      });
    } else if (lockedSol > 0n) {
      const drift = Number(lockedSol - wsolSupply) / Number(lockedSol);
      if (drift > this.config.maxSupplyDriftPercent) {
        this.raiseAlert({
          id: `supply_drift_${Date.now()}`,
          severity: 'warning',
          category: 'supply_drift',
          message: `Supply drift detected: ${(drift * 100).toFixed(2)}% difference`,
          data: { lockedSol: lockedSol.toString(), wsolSupply: wsolSupply.toString(), drift },
          timestamp: Date.now(),
          autoPause: false,
        });
      }
    }
  }

  /**
   * Monitor transaction volume for abnormal patterns
   */
  checkVolumeAnomaly(amount: bigint): void {
    // Reset hourly counter
    if (Date.now() - this.hourlyVolumeReset > 3600000) {
      this.hourlyVolume = 0n;
      this.hourlyVolumeReset = Date.now();
    }

    this.hourlyVolume += amount;

    if (this.hourlyVolume > this.config.maxHourlyVolume) {
      this.raiseAlert({
        id: `volume_spike_${Date.now()}`,
        severity: 'critical',
        category: 'abnormal_volume',
        message: `Hourly volume exceeded threshold: ${this.hourlyVolume}`,
        data: { 
          hourlyVolume: this.hourlyVolume.toString(), 
          threshold: this.config.maxHourlyVolume.toString() 
        },
        timestamp: Date.now(),
        autoPause: true,
      });
    }
  }

  /**
   * Monitor for suspiciously large single transactions
   */
  checkLargeTransaction(amount: bigint, transferId: string): void {
    if (amount >= this.config.largeTransactionThreshold) {
      this.raiseAlert({
        id: `large_tx_${transferId}`,
        severity: 'warning',
        category: 'large_transaction',
        message: `Large transaction detected: ${amount} lamports`,
        data: { amount: amount.toString(), transferId },
        timestamp: Date.now(),
        autoPause: false,
      });
    }
  }

  /**
   * Monitor transaction frequency (rapid-fire = possible exploit)
   */
  checkTransactionRate(): void {
    const now = Date.now();
    this.recentTransactions.push(now);

    // Keep only last minute of transactions
    this.recentTransactions = this.recentTransactions.filter(
      (t) => now - t < 60000
    );

    if (this.recentTransactions.length > this.config.maxTransactionsPerMinute) {
      this.raiseAlert({
        id: `rate_spike_${now}`,
        severity: 'critical',
        category: 'rapid_transactions',
        message: `Transaction rate spike: ${this.recentTransactions.length}/min (max: ${this.config.maxTransactionsPerMinute})`,
        data: {
          rate: this.recentTransactions.length,
          maxRate: this.config.maxTransactionsPerMinute,
        },
        timestamp: now,
        autoPause: true,
      });
    }
  }

  /**
   * Monitor validator health
   */
  checkValidatorHealth(
    activeValidators: number,
    faultRate: number
  ): void {
    if (activeValidators < this.config.minActiveValidators) {
      this.raiseAlert({
        id: `low_validators_${Date.now()}`,
        severity: 'critical',
        category: 'validator_health',
        message: `Active validators below minimum: ${activeValidators}/${this.config.minActiveValidators}`,
        data: { activeValidators, minRequired: this.config.minActiveValidators },
        timestamp: Date.now(),
        autoPause: true,
      });
    }

    if (faultRate > this.config.maxValidatorFaultRate) {
      this.raiseAlert({
        id: `validator_faults_${Date.now()}`,
        severity: 'warning',
        category: 'validator_faults',
        message: `High validator fault rate: ${(faultRate * 100).toFixed(1)}%`,
        data: { faultRate },
        timestamp: Date.now(),
        autoPause: false,
      });
    }
  }

  /**
   * Monitor chain synchronization
   */
  checkChainSync(
    solanaLatency: number,
    dccLatency: number,
    blockDifference: number
  ): void {
    if (solanaLatency > this.config.maxBlockLatency) {
      this.raiseAlert({
        id: `solana_latency_${Date.now()}`,
        severity: 'warning',
        category: 'chain_sync',
        message: `Solana latency high: ${solanaLatency}s`,
        data: { solanaLatency, threshold: this.config.maxBlockLatency },
        timestamp: Date.now(),
        autoPause: false,
      });
    }

    if (dccLatency > this.config.maxBlockLatency) {
      this.raiseAlert({
        id: `dcc_latency_${Date.now()}`,
        severity: 'warning',
        category: 'chain_sync',
        message: `DCC latency high: ${dccLatency}s`,
        data: { dccLatency, threshold: this.config.maxBlockLatency },
        timestamp: Date.now(),
        autoPause: false,
      });
    }

    if (blockDifference > this.config.maxChainDesyncBlocks) {
      this.raiseAlert({
        id: `chain_desync_${Date.now()}`,
        severity: 'critical',
        category: 'chain_desync',
        message: `Chains desynchronized by ${blockDifference} blocks`,
        data: { blockDifference },
        timestamp: Date.now(),
        autoPause: true,
      });
    }
  }

  private raiseAlert(alert: AnomalyAlert): void {
    this.alerts.push(alert);
    
    // Keep last 1000 alerts
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-1000);
    }

    this.logger.log(
      alert.severity === 'emergency' || alert.severity === 'critical' ? 'error' : 'warn',
      `[${alert.severity.toUpperCase()}] ${alert.message}`,
      alert.data
    );

    this.emit('alert', alert);

    if (alert.autoPause) {
      this.emit('auto_pause', alert);
    }
  }

  getRecentAlerts(limit: number = 50): AnomalyAlert[] {
    return this.alerts.slice(-limit);
  }

  getAlertCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const alert of this.alerts) {
      counts[alert.category] = (counts[alert.category] || 0) + 1;
    }
    return counts;
  }
}
