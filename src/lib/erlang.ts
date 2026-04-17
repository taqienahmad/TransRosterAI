/**
 * Erlang C calculations for contact center staffing
 */

export interface ErlangResult {
  agents: number;
  serviceLevel: number;
  occupancy: number;
  waitingProbability: number;
  averageSpeedOfAnswer: number;
}

/**
 * Calculates Erlang C probability
 * @param intensity Traffic intensity (A = calls_per_hour * AHT / 3600)
 * @param agents Number of agents (m)
 */
/**
 * Calculates Erlang C probability using a more stable approach
 * @param intensity Traffic intensity (A)
 * @param agents Number of agents (m)
 */
function calculateErlangC(intensity: number, agents: number): number {
  if (agents <= intensity) return 1;

  const rho = intensity / agents;
  let sum = 1.0;
  let term = 1.0;

  for (let i = 1; i < agents; i++) {
    term = term * (intensity / i);
    sum += term;
  }

  const lastTerm = (term * (intensity / agents)) / (1 - rho);
  return lastTerm / (sum + lastTerm);
}

/**
 * Helper to determine interval duration in hours from interval string (e.g. "08:00 - 09:00" or "08:00")
 */
export function getIntervalDuration(interval: string, allIntervals: string[]): number {
  // Try to parse range like "08:00 - 09:00"
  const rangeMatch = interval.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (rangeMatch) {
    const startH = parseInt(rangeMatch[1]);
    const startM = parseInt(rangeMatch[2]);
    const endH = parseInt(rangeMatch[3]);
    const endM = parseInt(rangeMatch[4]);
    
    let diff = (endH * 60 + endM) - (startH * 60 + startM);
    if (diff < 0) diff += 1440; // Overnight
    return diff / 60;
  }

  // Fallback: use difference between consecutive intervals
  if (allIntervals.length > 1) {
    const idx = allIntervals.indexOf(interval);
    const nextIdx = (idx + 1) % allIntervals.length;
    const curr = allIntervals[idx].match(/(\d{1,2}):(\d{2})/);
    const next = allIntervals[nextIdx].match(/(\d{1,2}):(\d{2})/);
    
    if (curr && next) {
      const currM = parseInt(curr[1]) * 60 + parseInt(curr[2]);
      const nextM = parseInt(next[1]) * 60 + parseInt(next[2]);
      let diff = nextM - currM;
      if (diff <= 0) diff += 1440;
      return diff / 60;
    }
  }

  return 1; // Default to 1 hour
}

/**
 * Finds the minimum number of agents to meet a service level target
 * @param volume Volume in the interval
 * @param aht Average Handling Time in seconds
 * @param targetSL Service Level target (e.g., 0.8 for 80%)
 * @param targetTime Target time in seconds (e.g., 20)
 * @param intervalDuration Duration of the interval in hours (default 1)
 */
export function calculateRequiredAgents(
  volume: number,
  aht: number,
  targetSL: number,
  targetTime: number,
  intervalDuration: number = 1
): ErlangResult {
  if (volume <= 0) {
    return { agents: 0, serviceLevel: 1, occupancy: 0, waitingProbability: 0, averageSpeedOfAnswer: 0 };
  }

  // Normalize volume to hourly rate for Erlang C
  const callsPerHour = volume / intervalDuration;
  const intensity = (callsPerHour * aht) / 3600;
  let agents = Math.ceil(intensity) + 1;

  while (true) {
    const pw = calculateErlangC(intensity, agents);
    const sl = 1 - pw * Math.exp(-(agents - intensity) * (targetTime / aht));
    const occupancy = intensity / agents;

    if (sl >= targetSL || agents > 1000) {
      return {
        agents,
        serviceLevel: sl,
        occupancy,
        waitingProbability: pw,
        averageSpeedOfAnswer: (pw * aht) / (agents - intensity)
      };
    }
    agents++;
  }
}

/**
 * Staffing for Chat considering concurrency
 */
export function calculateRequiredAgentsChat(
  volume: number,
  aht: number,
  targetSL: number,
  targetTime: number,
  concurrency: number,
  intervalDuration: number = 1
): ErlangResult {
  // 1. Calculate required concurrent sessions using standard Erlang C
  const sessionResult = calculateRequiredAgents(volume, aht, targetSL, targetTime, intervalDuration);
  
  // 2. Divide sessions by concurrency to get agents
  const agents = Math.ceil(sessionResult.agents / concurrency);
  
  return {
    ...sessionResult,
    agents: Math.max(1, agents),
    occupancy: ((volume / intervalDuration) * aht / 3600) / (agents * concurrency)
  };
}

/**
 * Staffing for Email based on Turnaround Time (TAT)
 */
export function calculateRequiredAgentsEmail(
  volume: number,
  aht: number,
  targetSL: number,
  tat: number,
  intervalDuration: number = 1
): ErlangResult {
  return calculateRequiredAgents(volume, aht, targetSL, tat, intervalDuration);
}

/**
 * Parses the CSV data provided by the user
 * Format: Time Interval;Day1;Day2...
 */
export function parseVolumeCSV(csv: string): { [day: string]: { [interval: string]: number } } {
  const lines = csv.trim().split('\n');
  if (lines.length < 4) return {};

  // Find the header with day numbers (usually line 2 or 3)
  // Based on user input:
  // Line 0: Total Volume...
  // Line 1: ;01;02;03...
  const dayHeaders = lines[1].split(';').filter(s => s.trim() !== '');
  const result: { [day: string]: { [interval: string]: number } } = {};

  dayHeaders.forEach(day => {
    result[day] = {};
  });

  // Data starts from line 4 (0:00 - 1:00...)
  for (let i = 4; i < lines.length; i++) {
    const parts = lines[i].split(';');
    const interval = parts[0].trim();
    if (!interval) continue;

    for (let j = 1; j < parts.length; j++) {
      const dayIndex = j - 1;
      if (dayIndex < dayHeaders.length) {
        const day = dayHeaders[dayIndex];
        const volume = parseInt(parts[j]) || 0;
        result[day][interval] = volume;
      }
    }
  }

  return result;
}

/**
 * Checks if a specific interval is within an operational window
 */
export function isIntervalInWindow(interval: string, windowStart: string, windowEnd: string): boolean {
  const [intStartStr] = interval.split(' - ');
  const [intH, intM] = intStartStr.split(':').map(Number);
  const [winStartH, winStartM] = windowStart.split(':').map(Number);
  const [winEndH, winEndM] = windowEnd.split(':').map(Number);
  
  const intTotalMinutes = intH * 60 + intM;
  const winStartTotalMinutes = winStartH * 60 + winStartM;
  const winEndTotalMinutes = winEndH * 60 + winEndM;
  
  // If start and end are same, treat as 24h (since isOpen was already checked by caller)
  if (winStartTotalMinutes === winEndTotalMinutes) {
    return true;
  }
  
  if (winStartTotalMinutes <= winEndTotalMinutes) {
    return intTotalMinutes >= winStartTotalMinutes && intTotalMinutes < winEndTotalMinutes;
  } else {
    // Overnight window (e.g., 22:00 to 06:00)
    return intTotalMinutes >= winStartTotalMinutes || intTotalMinutes < winEndTotalMinutes;
  }
}

/**
 * Matches a day name (full or abbreviation) against the operational windows config keys.
 * Can optionally take a dateStr to reliably derive the day name.
 */
export function matchDayName(dayName: string, operationalWindows: Record<string, any>, dateStr?: string): any | null {
  if (!operationalWindows) return null;
  
  let nameToMatch = dayName ? dayName.toLowerCase().trim() : '';

  // If we have a date string, use it to get the DEFINITIVE day name as standard key
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        nameToMatch = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      }
    } catch (e) {
      // Fallback to provided dayName
    }
  }

  if (!nameToMatch) return null;

  const dayMap: Record<string, string> = {
    'mon': 'monday', 'tue': 'tuesday', 'wed': 'wednesday', 'thu': 'thursday', 'fri': 'friday', 'sat': 'saturday', 'sun': 'sunday'
  };

  // Convert abbreviations to full names if possible
  const fullDayName = dayMap[nameToMatch] || nameToMatch;
  
  const entries = Object.entries(operationalWindows);
  
  // Try exact match first (case-insensitive)
  const exactMatchKey = Object.keys(operationalWindows).find(k => k.toLowerCase().trim() === fullDayName);
  if (exactMatchKey) return operationalWindows[exactMatchKey];
  
  // Try finding a matching key using fuzzy logic
  const found = entries.find(([k]) => {
    const keyLower = k.toLowerCase().trim();
    return keyLower === fullDayName || 
           keyLower === nameToMatch ||
           keyLower.startsWith(nameToMatch) ||
           nameToMatch.startsWith(keyLower);
  });
  
  return found ? found[1] : null;
}

/**
 * Applies operational windows to volume data, accumulating non-operational volume 
 * and carrying it over to the next available operational interval.
 */
export function applyOperationalWindowsToVolume(
  volumeData: any[], 
  operationalWindows: Record<string, any>
): any[] {
  if (!operationalWindows || !volumeData || volumeData.length === 0) return volumeData;
  
  let carryOver = 0;
  return volumeData.map(day => {
    const window = matchDayName(day.day, operationalWindows, day.date);
    
    // Sort intervals by time to ensure correct carry-over
    const sortedIntervalEntries = Object.entries(day.intervals).sort(([a], [b]) => a.localeCompare(b));
    const newIntervals: Record<string, number> = {};
    
    sortedIntervalEntries.forEach(([interval, volume]) => {
      const rawVolume = Number(volume) || 0;
      let isInWindow = true;
      if (window) {
        if (!window.isOpen) {
          isInWindow = false;
        } else {
          isInWindow = isIntervalInWindow(interval, window.start, window.end);
        }
      }
      
      if (!isInWindow) {
        carryOver += rawVolume;
        newIntervals[interval] = 0;
      } else {
        newIntervals[interval] = rawVolume + carryOver;
        carryOver = 0;
      }
    });
    
    return {
      ...day,
      intervals: newIntervals
    };
  });
}
