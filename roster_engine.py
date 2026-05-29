import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta

class WFMRosterEngine:
    def __init__(self, agents, shift_requirements, max_consecutive_work=6, target_off_days=8):
        """
        Initialize the WFM Rostering Engine.
        
        :param agents: List of agent names
        :param shift_requirements: Dict mapping date_str -> {shift_code: count}
        :param max_consecutive_work: Hard constraint for sequential days
        :param target_off_days: Soft target for monthly planning
        """
        self.agents = agents
        self.shift_requirements = shift_requirements
        self.max_consecutive_work = max_consecutive_work
        self.target_off_days = target_off_days
        
        # Internal state tracking
        self.roster = {agent: {} for agent in agents}
        self.agent_stats = {
            agent: {
                'total_work_days': 0,
                'total_off_days': 0,
                'current_streak': 0,
                'shift_counts': {}
            } for agent in agents
        }
        
    def get_agent_score(self, agent, day_idx):
        """
        Scoring system to select the best agent for a shift.
        Lower score is better (higher priority).
        """
        stats = self.agent_stats[agent]
        
        # Factor 1: Hard Constraint check for consecutive working days
        if stats['current_streak'] >= self.max_consecutive_work:
            return 999999  # Absolute disqualification
            
        # Factor 2: Workload Balancing (Prioritize those with fewer work days)
        score = stats['total_work_days'] * 100
        
        # Factor 3: Streak Penalty (Slight preference for shorter streaks)
        score += stats['current_streak'] * 10
        
        # Factor 4: Randomization (To avoid same-order assignment)
        score += random.uniform(0, 5)
        
        return score

    def generate_roster(self):
        dates = sorted(self.shift_requirements.keys())
        
        for idx, date in enumerate(dates):
            # 1. Expand shift pool for this day
            daily_req = self.shift_requirements[date]
            shift_pool = []
            for shift, count in daily_req.items():
                shift_pool.extend([shift] * count)
            
            # 2. Shuffle shifts to prevent agent-shift bias over time
            random.shuffle(shift_pool)
            
            assigned_today = set()
            
            # 3. Handle Mandatory OFFs (due to streak limits)
            for agent in self.agents:
                if self.agent_stats[agent]['current_streak'] >= self.max_consecutive_work:
                    self._assign(agent, date, 'OFF')
                    assigned_today.add(agent)
            
            # 4. Fill Shift Pool
            for shift in shift_pool:
                # Find best available agent
                available_agents = [a for a in self.agents if a not in assigned_today]
                if not available_agents:
                    # Logic failure or understaffing
                    break
                    
                best_agent = min(available_agents, key=lambda a: self.get_agent_score(a, idx))
                
                # Check if even the best agent is at max streak
                if self.agent_stats[best_agent]['current_streak'] >= self.max_consecutive_work:
                    # This happens if requirement > available agents who can work
                    self._assign(best_agent, date, 'OFF')
                else:
                    self._assign(best_agent, date, shift)
                
                assigned_today.add(best_agent)
            
            # 5. Remaining agents get OFF
            for agent in self.agents:
                if agent not in assigned_today:
                    self._assign(agent, date, 'OFF')

        return self._prepare_output(dates)

    def _assign(self, agent, date, shift):
        self.roster[agent][date] = shift
        stats = self.agent_stats[agent]
        
        if shift == 'OFF':
            stats['total_off_days'] += 1
            stats['current_streak'] = 0
        else:
            stats['total_work_days'] += 1
            stats['current_streak'] += 1
            stats['shift_counts'][shift] = stats['shift_counts'].get(shift, 0) + 1

    def _prepare_output(self, dates):
        # Create Roster Table
        df_roster = pd.DataFrame.from_dict(self.roster, orient='index')
        df_roster.index.name = 'Agent'
        
        # Create Summary Metrics
        summary = []
        for agent, stats in self.agent_stats.items():
            summary.append({
                'Agent': agent,
                'Work Days': stats['total_work_days'],
                'OFF Days': stats['total_off_days'],
                'Shift Dist': str(stats['shift_counts'])
            })
        df_summary = pd.DataFrame(summary)
        
        return df_roster, df_summary

# --- Example Usage ---
if __name__ == "__main__":
    # 1. Setup Sample Data
    agents = [f"Agent_{i+1}" for i in range(20)]
    
    # 30 Days of Requirements
    dates = [(datetime(2025, 4, 1) + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(30)]
    
    # Simple Requirement: 14 agents needed per day across various shifts
    # Shifts: P1(3), P2(2), P3(2), P4(1), S1(2), S2(2), S3(1), S4(1) = 14 Total
    base_req = {
        'P1': 3, 'P2': 2, 'P3': 2, 'P4': 1, 
        'S1': 2, 'S2': 2, 'S3': 1, 'S4': 1
    }
    
    shift_requirements = {date: base_req.copy() for date in dates}
    
    # 2. Run Engine
    engine = WFMRosterEngine(agents, shift_requirements)
    df_roster, df_summary = engine.generate_roster()
    
    # 3. Export to Excel
    with pd.ExcelWriter('WFM_Monthly_Roster.xlsx') as writer:
        df_roster.to_excel(writer, sheet_name='Roster')
        df_summary.to_excel(writer, sheet_name='Summary')
    
    print("Roster generation complete. File saved as 'WFM_Monthly_Roster.xlsx'")
    print(df_summary.head())
