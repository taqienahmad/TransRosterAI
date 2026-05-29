export type ForecastMethod = 
  | 'naive'
  | 'moving-average'
  | 'weighted-moving-average'
  | 'linear-regression'
  | 'exponential-smoothing'
  | 'holt-linear'
  | 'holt-winters'
  | 'seasonal-index'
  | 'decomposition';

export type ForecastMode = 'single' | 'hybrid' | 'auto';

export interface EventAdjustment {
  date: string;
  type: 'campaign' | 'payday' | 'holiday' | 'other';
  impact: number; // e.g., 0.3 for +30%
  description?: string;
  event_window_pattern?: number[]; // [H-2, H-1, H, H+1, H+2] multipliers
}

export interface ForecastResult {
  date: string;
  baseline: number;
  finalForecast: number;
  methodUsed: ForecastMethod;
  modeUsed: ForecastMode;
  eventImpact?: number;
  eventApplied?: EventAdjustment;
}

export interface HistoricalData {
  date: string;
  value: number;
}

export interface ForecastEngineParams {
  alpha?: number;
  beta?: number;
  gamma?: number;
  windowSize?: number;
  seasonalLength?: number;
}

export class ForecastingEngine {
  /**
   * Calculates Mean Absolute Percentage Error.
   */
  static calculateMAPE(actual: number[], forecast: number[]): number {
    if (actual.length !== forecast.length || actual.length === 0) return 0;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] !== 0) {
        sum += Math.abs((actual[i] - forecast[i]) / actual[i]);
        count++;
      }
    }
    return count > 0 ? (sum / count) * 100 : 0;
  }

  /**
   * Simple Time Series Decomposition: Trend + Seasonality + Residual
   */
  static decompose(history: HistoricalData[], period: number = 7) {
    if (history.length < period * 2) return null;

    const values = history.map(h => h.value);
    
    // 1. Calculate Trend (Moving Average)
    const trend = values.map((_, i) => {
      if (i < Math.floor(period / 2) || i > values.length - Math.ceil(period / 2)) return null;
      let sum = 0;
      for (let j = i - Math.floor(period / 2); j <= i + Math.floor(period / 2); j++) {
        sum += values[j];
      }
      return sum / period;
    });

    // 2. Detrend (Values - Trend)
    const detrended = values.map((v, i) => trend[i] === null ? null : v - (trend[i] as number));

    // 3. Calculate Seasonality (Weekday-based)
    const seasonalityMap = new Array(7).fill(0);
    const seasonalityCounts = new Array(7).fill(0);
    detrended.forEach((v, i) => {
      if (v !== null) {
        const day = new Date(history[i].date).getDay();
        seasonalityMap[day] += v;
        seasonalityCounts[day]++;
      }
    });
    
    const seasonality = seasonalityMap.map((v, i) => seasonalityCounts[i] > 0 ? v / seasonalityCounts[i] : 0);
    
    // 4. Residual (Actual - Trend - Seasonality)
    const residual = values.map((v, i) => {
        if (trend[i] === null) return null;
        const day = new Date(history[i].date).getDay();
        return v - (trend[i] as number) - seasonality[day];
    });

    return { trend, seasonality, residual };
  }

  /**
   * Enhanced Time Series Decomposition with Segmented Analysis
   * Separates: Weekday vs Weekend, Campaigns, Paydays, Twin Dates
   */
  static generateSegmentedForecast(
    history: HistoricalData[],
    targetDateStr: string,
    events: EventAdjustment[] = []
  ): number {
    const targetDate = new Date(targetDateStr);
    const day = targetDate.getDay();
    const isWeekend = day === 0 || day === 6;
    const dayOfMonth = targetDate.getDate();
    const month = targetDate.getMonth() + 1;
    const isTwinDate = dayOfMonth === month;
    const isPayday = dayOfMonth >= 25 || dayOfMonth <= 2;
    
    const eventDates = events.map(e => e.date);
    const isCampaign = eventDates.includes(targetDateStr);

    // Filter history based on segments
    const filterBySegment = (h: HistoricalData[]) => {
      return h.filter(item => {
        const d = new Date(item.date);
        const itemDay = d.getDay();
        const itemIsWeekend = itemDay === 0 || itemDay === 6;
        const itemIsCampaign = eventDates.includes(item.date);
        const itemDayOfMonth = d.getDate();
        const itemIsPayday = itemDayOfMonth >= 25 || itemDayOfMonth <= 2;
        const itemIsTwinDate = itemDayOfMonth === (d.getMonth() + 1);

        // Priority matching:
        if (isCampaign) return itemIsCampaign;
        if (isTwinDate) return itemIsTwinDate;
        if (isPayday) return itemIsPayday;
        return itemIsWeekend === isWeekend;
      });
    };

    const segmentHistory = filterBySegment(history);
    
    // If we have enough targeted history, use its average/trend
    if (segmentHistory.length >= 4) {
      const values = segmentHistory.map(h => h.value);
      // Simple projection: weighted average of the last few similar days
      let sum = 0, weightSum = 0;
      values.forEach((v, i) => {
        const w = i + 1;
        sum += v * w;
        weightSum += w;
      });
      return sum / weightSum;
    }

    // Fallback: Use standard decomposition
    return this.decompositionForecast(history, targetDate);
  }

  /**
   * Detects Trend, Seasonality, and Volatility in historical data.
   */
  static analyzeData(history: HistoricalData[]) {
    if (history.length < 14) return { trend: 'stable', seasonality: 'low', volatility: 'low' };

    // Volatility - Coefficient of Variation
    const values = history.map(h => h.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / values.length);
    const cv = stdDev / mean;
    const volatility = cv > 0.4 ? 'high' : cv > 0.15 ? 'medium' : 'low';

    // Trend - Linear regression slope
    const n = history.length;
    let sX = 0, sY = 0, sXY = 0, sXX = 0;
    history.forEach((h, i) => { sX += i; sY += h.value; sXY += i * h.value; sXX += i * i; });
    const slope = (n * sXY - sX * sY) / (n * sXX - sX * sX);
    const trend = Math.abs(slope / mean) < 0.01 ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';

    // Seasonality - Autocorrelation at lag 7
    let autocorr = 0;
    const lag = 7;
    for (let i = lag; i < history.length; i++) {
      autocorr += (history[i].value - mean) * (history[i - lag].value - mean);
    }
    autocorr = autocorr / (values.length - lag) / (stdDev * stdDev);
    const seasonality = autocorr > 0.6 ? 'strong' : autocorr > 0.3 ? 'medium' : 'low';

    return { trend, seasonality, volatility, cv, slope };
  }

  /**
   * Adjusts parameters based on detected data characteristics.
   */
  static getOptimizedParams(history: HistoricalData[], manualParams: ForecastEngineParams): Required<ForecastEngineParams> {
    const analysis = this.analyzeData(history);
    
    // Default values
    let alpha = manualParams.alpha ?? 0.3;
    let beta = manualParams.beta ?? 0.1;
    let gamma = manualParams.gamma ?? 0.2;
    let windowSize = manualParams.windowSize ?? 7;
    let seasonalLength = manualParams.seasonalLength ?? 7;

    // Adjustments: High volatility -> increase alpha
    if (analysis.volatility === 'high') alpha = Math.min(0.8, alpha + 0.2);
    // Strong trend -> increase beta
    if (analysis.trend !== 'stable') beta = Math.min(0.5, beta + 0.1);
    // Strong seasonality -> increase gamma
    if (analysis.seasonality === 'strong') gamma = Math.min(0.6, gamma + 0.1);

    return { alpha, beta, gamma, windowSize, seasonalLength };
  }

  /**
   * Applies Event Intelligence with window patterns (H-2 to H+2).
   */
  static applyEventIntelligence(baseline: number, targetDateStr: string, events: EventAdjustment[]): { final: number, impact: number, event?: EventAdjustment } {
    const targetDate = new Date(targetDateStr);
    
    for (const event of events) {
      const eventDate = new Date(event.date);
      const diffDays = Math.round((targetDate.getTime() - eventDate.getTime()) / (1000 * 3600 * 24));

      // Window check (-2 to +2)
      if (Math.abs(diffDays) <= 2) {
        const pattern = event.event_window_pattern || [0.1, 0.4, 1.0, 0.6, 0.2]; // Default: H-2 (10%), H-1 (40%), H (100%), H+1 (60%), H+2 (20%)
        const index = diffDays + 2;
        const multiplier = pattern[index] || 0;
        const effectiveImpact = event.impact * multiplier;
        return { 
          final: Math.max(0, baseline * (1 + effectiveImpact)), 
          impact: effectiveImpact,
          event 
        };
      }
    }

    return { final: baseline, impact: 0 };
  }

  /**
   * Core Forecasting Engine with Hybrid Logic.
   */
  static generateForecast(
    history: HistoricalData[],
    targetDateStr: string,
    mode: ForecastMode,
    method: ForecastMethod,
    params: ForecastEngineParams,
    events: EventAdjustment[] = []
  ): ForecastResult {
    const opt = this.getOptimizedParams(history, params);
    const analysis = this.analyzeData(history);
    
    const lastHistDate = new Date(history[history.length - 1].date);
    const targetDate = new Date(targetDateStr);
    const k = Math.max(1, Math.round((targetDate.getTime() - lastHistDate.getTime()) / (1000 * 3600 * 24)));
    
    let resolvedMethod = method;
    let baseline = 0;

    // STEP 2: Method Selection
    if (mode === 'auto') {
      if (history.length >= 14) {
        resolvedMethod = 'decomposition';
      } else {
        resolvedMethod = analysis.seasonality === 'strong' ? 'holt-winters' : 'exponential-smoothing';
      }
    } else if (mode === 'hybrid') {
      // In hybrid mode, we use holt-linear (level + trend) and then apply seasonal index manually
      resolvedMethod = 'holt-linear'; 
    }

    // STEP 3: Baseline Generation
    switch (resolvedMethod) {
      case 'naive': baseline = this.naive(history, targetDate); break;
      case 'moving-average': baseline = this.movingAverage(history, opt.windowSize); break;
      case 'weighted-moving-average': baseline = this.weightedMovingAverage(history, opt.windowSize); break;
      case 'linear-regression': 
        baseline = this.linearRegression(history, history.length + k); 
        break;
      case 'exponential-smoothing': baseline = this.exponentialSmoothing(history, opt.alpha); break;
      case 'holt-linear': baseline = this.holtLinear(history, opt.alpha, opt.beta, k); break;
      case 'holt-winters': baseline = this.holtWinters(history, opt.alpha, opt.beta, opt.gamma, k); break;
      case 'seasonal-index': baseline = this.seasonalIndex(history, targetDate); break;
      case 'decomposition': baseline = this.generateSegmentedForecast(history, targetDateStr, events); break;
    }

    // STEP 4: Hybrid Refinement (distribution)
    if (mode === 'hybrid') {
      const sIndexMultiplier = this.getSeasonalIndexOnly(history, targetDate);
      baseline = baseline * sIndexMultiplier;
    }

    // STEP 5: Event Intelligence Layer
    const intel = this.applyEventIntelligence(baseline, targetDateStr, events);

    return {
      date: targetDateStr,
      baseline: Number(baseline.toFixed(2)),
      finalForecast: Number(intel.final.toFixed(2)),
      methodUsed: resolvedMethod,
      modeUsed: mode,
      eventImpact: intel.impact,
      eventApplied: intel.event
    };
  }

  // Helper implementations...

  static holtWinters(history: HistoricalData[], alpha: number, beta: number, gamma: number, k: number): number {
    const L = 7;
    if (history.length < L * 2) return this.holtLinear(history, alpha, beta, k);
    let level = history.slice(0, L).reduce((a, b) => a + b.value, 0) / L;
    let trend = (history[L].value - history[0].value) / L;
    const seasonal = history.slice(0, L).map(h => h.value / level);
    for (let i = L; i < history.length; i++) {
        const lastLevel = level;
        const sIdx = i % L;
        level = alpha * (history[i].value / seasonal[sIdx]) + (1 - alpha) * (level + trend);
        trend = beta * (level - lastLevel) + (1 - beta) * trend;
        seasonal[sIdx] = gamma * (history[i].value / level) + (1 - gamma) * seasonal[sIdx];
    }
    return Math.max(0, (level + k * trend) * seasonal[(history.length + k - 1) % L]);
  }

  static getSeasonalIndexOnly(history: HistoricalData[], targetDate: Date): number {
    if (history.length < 7) return 1;
    const dAvg: Record<number, { s: number, c: number }> = {};
    let tS = 0;
    history.forEach(h => {
      const d = new Date(h.date).getDay();
      if (!dAvg[d]) dAvg[d] = { s: 0, c: 0 };
      dAvg[d].s += h.value; dAvg[d].c += 1; tS += h.value;
    });
    const avg = tS / history.length;
    const dayData = dAvg[targetDate.getDay()];
    if (!dayData) return 1;
    return (dayData.s / dayData.c) / avg;
  }

  static naive(history: HistoricalData[], targetDate: Date): number {
    if (history.length === 0) return 0;
    const targetDay = targetDate.getDay();
    const sameDayLastWeek = history.filter(h => new Date(h.date).getDay() === targetDay).pop();
    return sameDayLastWeek ? sameDayLastWeek.value : history[history.length - 1].value;
  }

  static movingAverage(history: HistoricalData[], n: number): number {
    if (history.length === 0) return 0;
    const window = history.slice(-Math.min(n, history.length));
    return window.reduce((a, b) => a + b.value, 0) / window.length;
  }

  static weightedMovingAverage(history: HistoricalData[], n: number): number {
    if (history.length === 0) return 0;
    const window = history.slice(-Math.min(n, history.length));
    let tS = 0, tW = 0;
    window.forEach((h, i) => { const w = i + 1; tS += h.value * w; tW += w; });
    return tS / tW;
  }

  static linearRegression(history: HistoricalData[], targetIndex: number): number {
    if (history.length < 2) return history[0]?.value || 0;
    const n = history.length;
    let sX = 0, sY = 0, sXY = 0, sXX = 0;
    history.forEach((h, i) => { sX += i; sY += h.value; sXY += i * h.value; sXX += i * i; });
    const slope = (n * sXY - sX * sY) / (n * sXX - sX * sX);
    const intercept = (sY - slope * sX) / n;
    return Math.max(0, slope * targetIndex + intercept);
  }

  static exponentialSmoothing(history: HistoricalData[], alpha: number): number {
    if (history.length === 0) return 0;
    let f = history[0].value;
    for (let i = 1; i < history.length; i++) f = alpha * history[i].value + (1 - alpha) * f;
    return f;
  }

  static holtLinear(history: HistoricalData[], alpha: number, beta: number, k: number): number {
    if (history.length < 2) return history[0]?.value || 0;
    let l = history[0].value, t = history[1].value - history[0].value;
    for (let i = 1; i < history.length; i++) {
        const ll = l;
        l = alpha * history[i].value + (1 - alpha) * (l + t);
        t = beta * (l - ll) + (1 - beta) * t;
    }
    return Math.max(0, l + k * t);
  }

  static seasonalIndex(history: HistoricalData[], targetDate: Date): number {
    const index = this.getSeasonalIndexOnly(history, targetDate);
    return this.movingAverage(history, 14) * index;
  }

  static decompositionForecast(history: HistoricalData[], targetDate: Date): number {
    const decomp = this.decompose(history, 7);
    if (!decomp) return this.holtWinters(history, 0.3, 0.1, 0.2, 1);
    
    // Project Trend using linear regression on last 14 days of trend
    const trendValues = decomp.trend.filter(t => t !== null) as number[];
    if (trendValues.length < 2) return history[history.length - 1].value;
    
    const n = trendValues.length;
    let sX = 0, sY = 0, sXY = 0, sXX = 0;
    trendValues.forEach((v, i) => { sX += i; sY += v; sXY += i * v; sXX += i * i; });
    const slope = (n * sXY - sX * sY) / (n * sXX - sX * sX);
    const intercept = (sY - slope * sX) / n;
    
    const lastHistDate = new Date(history[history.length - 1].date);
    const k = Math.max(1, Math.round((targetDate.getTime() - lastHistDate.getTime()) / (1000 * 3600 * 24)));
    
    const projectedTrend = slope * (n + k) + intercept;
    const seasonality = decomp.seasonality[targetDate.getDay()];
    
    return Math.max(0, projectedTrend + seasonality);
  }
}
