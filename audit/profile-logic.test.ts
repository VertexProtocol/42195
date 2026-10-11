/** Regression tests for the profile logic audit. */
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { assessComeback } from '@/lib/training-comeback'
import { classifyAthleteLevel } from '@/lib/training-safety-client'
import { evaluateAcwrSafety, checkFrequencyProgression, computeRecentWeeklyVolumes } from '@/lib/training-safety'
import { computeVolumeBaseline, computeWeeklyTargets } from '@/lib/training-volume'
import { allocateSessionDistances, supportedSessionCount } from '@/lib/training-sessions'
import { computeBlockStartDate, holdRaceWeeks } from '@/lib/training-block'
import { buildPaceGuide } from '@/lib/pace-guide'
import { detectPersonalRecords, predictRaceTimes } from '@/lib/training-utils'
import { matchSessionsToActivities } from '@/lib/plan-session-match'
import type { Activity } from '@/lib/types'
const now = new Date('2026-10-11T12:00:00Z')
const day = 86400000
function run(age: number, km = 5, pace = 6, elevation = 0): Activity {
 return { id: `${age}-${km}-${pace}`, user_id:'synthetic', strava_id:null, type:'Run', name:'Audit run', date:new Date(+now-age*day).toISOString(), distance_km:km, duration_seconds:km*pace*60, pace_min_per_km:pace, elevation_gain_m:elevation, avg_heart_rate:null, avg_cadence:null, calories:null, created_at:now.toISOString() } as Activity
}
function history(sessions: number, km: number, weeks=12, gap=0, pace=6) {
 return Array.from({length:weeks*sessions},(_,i)=>run(gap+0.5+i*7/sessions,km,pace))
}
const definitions = [
 ['No history',[],3,false], ['One first run',[run(1,2)],3,false],
 ['Novice 4km/week',history(2,2,8),3,false], ['Recreational 21km/week',history(3,7),3,false],
 ['Advanced 60km/week',history(5,12,12,0,4.7),5,false], ['Pro 120km/week',history(10,12,12,0,3.8),10,false],
 ['Experienced but one week imported',history(5,12,1),5,false],
 ['14-day break',history(4,10,8,14),4,false], ['50-day break',history(4,10,4,50),4,false],
 ['100-day break outside query',[],4,false], ['Recent active injury',history(4,10),4,true],
 ['Novice requesting 5 sessions',history(2,2,8),5,false],
 ['Pro using UI limit of 5 sessions',history(10,12,12,0,3.8),5,false],
 ['Novice requesting 7 sessions',history(2,2,8),7,false],
] as const
const evidence: Record<string,unknown> = {}
describe('Synthetic profile audit',()=>{
 it.each(definitions)('%s: execute profile → safety → volume → session allocation',(name,acts,requested,injury)=>{
  const activities=[...acts]
  const baseline=computeVolumeBaseline(activities,now)
  const comeback=assessComeback(activities,injury,now)
  const acwr=evaluateAcwrSafety(activities,now)
  const athleteLevel=classifyAthleteLevel(activities,now)
  const targets=computeWeeklyTargets({...baseline,blockWeeks:4,sessionsPerWeek:requested,increasePct:10,athleteLevel,acwr,comeback,priorWeeklyVolumes:computeRecentWeeklyVolumes(activities,3,now),prolongedFatigue:{detected:false,consecutiveNegativeTsbWeeks:0,deloadMultiplier:1,message:null}})
  const count=supportedSessionCount(targets.targets[0],Math.min(requested,checkFrequencyProgression(activities,requested,+now)?.maxSafeSessions ?? requested),'balanced')
  const allocation=allocateSessionDistances(targets.targets[0],['Long run',...Array(Math.max(0,count-1)).fill('Base run')],baseline.longestRecentRun > 0 ? baseline.longestRecentRun * 1.1 : 2)
  evidence[name]={athleteLevel,baseline,comeback,acwr,frequency:checkFrequencyProgression(activities,requested,+now),targets,sessionCount:count,allocation}
  expect(targets.targets).toHaveLength(4)
  expect(targets.targets.every(Number.isFinite)).toBe(true)
 })
 it('missing history remains explicitly unknown',()=>{expect(assessComeback([],false,now).category).toBe('unknown')})
 it('first run cannot establish a load baseline',()=>{expect(evaluateAcwrSafety([run(1,2)],now).risk).toBe('no_baseline')})
 it('session count is reduced for all focus modes and impossible allocation is rejected',()=>{
  for(const focus of ['balanced','workouts','volume'] as const){const n=supportedSessionCount(3,7,focus);expect(n).toBeLessThanOrEqual(3);expect(allocateSessionDistances(3,Array(n).fill('Base run')).distances.every(km=>km>0)).toBe(true)}
  expect(()=>allocateSessionDistances(3,Array(7).fill('Base run'))).toThrow()
 })
 it('active injury limits volume even without a pause',()=>{const injured=assessComeback(history(4,10),true,now);expect(injured.needsRamp).toBe(true);expect(injured.weekOneKm).toBeLessThan(assessComeback(history(4,10),false,now).weekOneKm)})
 it('shared 84-day history produces the same comeback recommendation',()=>{const acts=history(4,10,4,50);expect(assessComeback(acts,false,now).pauseDays).toBe(50);expect(assessComeback([],false,now).category).toBe('unknown')})
 it('adjustment keeps the active block while next-block generation advances',()=>{
  const input={prevBlockStartDate:'2026-10-05',prevWeekCount:4,today:now};expect(computeBlockStartDate({...input,adjustCurrent:true})).toBe('2026-10-05');expect(computeBlockStartDate(input)).toBe('2026-11-02')
 })
 it('secondary marathon reports a conflict without raising the budget',()=>{const result=holdRaceWeeks([3,3,3,2],[{goalId:'other',name:'Marathon',distanceKm:42.195,date:'2026-10-11',weekIndex:0}]);expect(result.targets[0]).toBe(3);expect(result.notes.some(n=>n.startsWith('Race conflict:'))).toBe(true)})
 it('easy run cannot complete threshold work',()=>{expect(matchSessionsToActivities([{type:'Threshold',distance:'10 km',suggestedPace:'4:00–4:10 /km'}],[{distance_km:10,pace_min_per_km:7}])).toEqual([false])})
 it('actual fastest time wins the personal record',()=>{expect(detectPersonalRecords([run(2,5,5),run(1,5,5.4,100)]).find(r=>r.distance_km===5)?.time_seconds).toBe(1500)})
 it('expired threshold test does not set current quality pace',()=>{const guide=buildPaceGuide([],[{created_at:'2019-01-01T00:00:00Z',derived_metrics:{threshold_pace:4}}],42.195,7,+now);expect(guide.source).toBe('historical');expect(guide.tempoPace).toBeNull()})
 it('single short run cannot yield a marathon forecast',()=>{expect(predictRaceTimes([run(1,3)],undefined,+now).predictions.some(p=>p.distance_km===42.195)).toBe(false)})
 it('prediction bounds are ordered and contain the point estimate',()=>{for(const adjustment of [-0.05,0,0.05]){const p=predictRaceTimes([run(1,10)],adjustment,+now).predictions.find(p=>p.distance_km===5)!;expect(p.low_seconds).toBeLessThanOrEqual(p.predicted_seconds);expect(p.high_seconds).toBeGreaterThanOrEqual(p.predicted_seconds)}})
 it('novice first week cannot be inflated by requested session count',()=>{expect((evidence['Novice 4km/week'] as any).targets.targets[0]).toBeLessThanOrEqual(4);expect((evidence['Novice requesting 5 sessions'] as any).sessionCount).toBeLessThanOrEqual(3)})
 it('pro sessions respect previous longest run',()=>{expect(Math.max(...(evidence['Pro using UI limit of 5 sessions'] as any).allocation.distances)).toBeLessThanOrEqual(13.2)})
 it('persists synthetic evidence for review',()=>{writeFileSync('/tmp/42195-profile-results.json',JSON.stringify(evidence,null,2));expect(Object.keys(evidence).length).toBeGreaterThan(10)})
})
