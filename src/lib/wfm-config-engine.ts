export type TrendPattern = 'stable' | 'increasing' | 'decreasing' | 'volatile';
export type SeasonalityLevel = 'low' | 'medium' | 'high';
export type ForecastMode = 'single' | 'hybrid' | 'auto';
export type WfmPreset = 'Stable' | 'Balanced' | 'Responsive' | 'Aggressive';
export type ServiceType = 'marketplace' | 'banking' | 'public_service' | 'telco' | 'logistics' | 'fintech' | 'generic';

export interface WfmConfigOutput {
  final_parameters: {
    alpha: number;
    beta: number;
    gamma: number;
    window_size: number;
  };
  recommended_mode: ForecastMode;
  recommended_preset: WfmPreset;
  warnings: string[];
  suggestions: string[];
  industry_note?: string;
  event_config: {
    enabled: boolean;
    types: string[];
    pattern: 'spike' | 'gradual' | 'lagged' | 'none';
  };
}

export class WfmConfigEngine {
  static PRESETS: Record<WfmPreset, { alpha: number; beta: number; gamma: number; window_size: number }> = {
    'Stable': { alpha: 0.2, beta: 0.05, gamma: 0.1, window_size: 14 },
    'Balanced': { alpha: 0.3, beta: 0.1, gamma: 0.2, window_size: 14 },
    'Responsive': { alpha: 0.5, beta: 0.15, gamma: 0.3, window_size: 7 },
    'Aggressive': { alpha: 0.7, beta: 0.25, gamma: 0.4, window_size: 7 }
  };

  static INDUSTRY_RULES: Record<ServiceType, { 
    mode: ForecastMode, 
    preset: WfmPreset, 
    event_types: string[], 
    pattern: 'spike' | 'gradual' | 'lagged' | 'none',
    note: string 
  }> = {
    'marketplace': { 
      mode: 'hybrid', 
      preset: 'Responsive', 
      event_types: ['campaign', 'payday'], 
      pattern: 'spike',
      note: 'Marketplace sangat dipengaruhi oleh kampanye flash sale dan pola gajian.'
    },
    'banking': { 
      mode: 'hybrid', 
      preset: 'Balanced', 
      event_types: ['payday'], 
      pattern: 'gradual',
      note: 'Perbankan memiliki tren stabil dengan lonjakan terencana pada periode gajian.'
    },
    'public_service': { 
      mode: 'single', 
      preset: 'Stable', 
      event_types: [], 
      pattern: 'none',
      note: 'Layanan publik cenderung memiliki pola volume yang stabil dan prediktif.'
    },
    'telco': { 
      mode: 'hybrid', 
      preset: 'Responsive', 
      event_types: ['other'], 
      pattern: 'spike',
      note: 'Telekomunikasi rentan terhadap lonjakan tiba-tiba akibat insiden jaringan atau event.'
    },
    'logistics': { 
      mode: 'hybrid', 
      preset: 'Balanced', 
      event_types: ['campaign'], 
      pattern: 'lagged',
      note: 'Logistik memiliki efek "lag" (tertunda) setelah kampanye marketplace besar.'
    },
    'fintech': { 
      mode: 'hybrid', 
      preset: 'Responsive', 
      event_types: ['payday', 'campaign'], 
      pattern: 'spike',
      note: 'Fintech memiliki volatilitas tinggi selama periode promo atau pencairan dana.'
    },
    'generic': { 
      mode: 'auto', 
      preset: 'Balanced', 
      event_types: [], 
      pattern: 'none',
      note: 'Konfigurasi umum berdasarkan karakteristik data historis.'
    }
  };

  static optimize(
    historyLength: number,
    trend: TrendPattern,
    seasonality: SeasonalityLevel,
    mode: ForecastMode,
    industry: ServiceType = 'generic',
    hasEvents: boolean = false
  ): WfmConfigOutput {
    const warnings: string[] = [];
    const suggestions: string[] = [];
    
    const industryRule = this.INDUSTRY_RULES[industry];

    // 1. Determine Recommended Preset & Mode
    let recommendedPreset: WfmPreset = industry !== 'generic' ? industryRule.preset : 'Balanced';
    let recommendedMode: ForecastMode = industry !== 'generic' ? industryRule.mode : (seasonality !== 'low' || hasEvents ? 'hybrid' : 'single');

    if (industry === 'generic') {
      if (trend === 'stable' && seasonality === 'low' && !hasEvents) {
        recommendedPreset = 'Stable';
      } else if (trend === 'volatile' || seasonality === 'high') {
        recommendedPreset = 'Responsive';
      } else if (hasEvents) {
        recommendedPreset = 'Responsive';
      }
    }

    // 2. Final Parameters Selection
    let finalParams = { ...this.PRESETS[recommendedPreset] };

    // Additional suggestions
    if (seasonality === 'medium' || seasonality === 'high') {
      suggestions.push("Data Anda memiliki pola musiman yang kuat. Mode Hybrid sangat direkomendasikan.");
    }
    if (hasEvents) {
      suggestions.push("Terdapat event yang terdaftar. Gunakan mode Hybrid untuk mengaktifkan Event Intelligence.");
    }

    return {
      final_parameters: finalParams,
      recommended_mode: recommendedMode,
      recommended_preset: recommendedPreset,
      warnings,
      suggestions,
      industry_note: industryRule.note,
      event_config: {
        enabled: industryRule.event_types.length > 0,
        types: industryRule.event_types,
        pattern: industryRule.pattern
      }
    };
  }

  static getPresetParameters(preset: WfmPreset) {
    return this.PRESETS[preset];
  }

  static getTooltip(preset: WfmPreset): string {
    switch(preset) {
      case 'Stable': return "Sensitivitas rendah. Cocok untuk data yang stabil tanpa fluktuasi besar. Mengurangi respons terhadap noise.";
      case 'Balanced': return "Keseimbangan antara stabilitas dan responsivitas. Cocok untuk sebagian besar kondisi data operasional.";
      case 'Responsive': return "Sensitivitas tinggi. Cepat menyesuaikan dengan perubahan tren atau volatilitas volume terbaru.";
      case 'Aggressive': return "Sensitivitas sangat tinggi. Sangat reaktif terhadap perubahan data terkecil, cocok untuk periode sangat dinamis.";
      default: return "";
    }
  }
}
