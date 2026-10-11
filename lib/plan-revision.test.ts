import { describe, it, expect } from 'vitest'
import { preservePlanProgress } from './plan-revision'
import type { TrainingPlan } from './types'
const session = (distance: string, type='Base run') => ({type,distance,effort:'Easy',purpose:'Training'})
const old: TrainingPlan = {summary:'Old',keyPrinciples:[],watchOut:null,weeks:[
 {weekNumber:1,theme:'Past',targetKm:12,coachNote:null,sessions:[session('12 km')]},
 {weekNumber:2,theme:'Current',targetKm:15,coachNote:null,sessions:[session('5 km'),session('5 km','Tempo'),session('5 km')]},
 {weekNumber:3,theme:'Future',targetKm:20,coachNote:null,sessions:[session('10 km'),session('10 km')]},
]}
const revised: TrainingPlan = {...old,summary:'Adjusted',weeks:old.weeks.map(w=>({...w,theme:'New',targetKm:8,sessions:[session('4 km'),session('4 km')]}))}
describe('preservePlanProgress',()=>{
 it('keeps prior weeks and completed current sessions unchanged while revising future training',()=>{
  const result=preservePlanProgress(old,revised,{'W2-1':'completed'},'2026-10-05',new Date('2026-10-14T12:00Z'))
  expect(result.weeks[0]).toEqual(old.weeks[0])
  expect(result.weeks[1].sessions[0]).toEqual(old.weeks[1].sessions[1])
  expect(result.weeks[1].targetKm).toBe(8)
  expect(result.weeks[2]).toEqual(revised.weeks[2])
  expect(old.weeks[1].sessions).toHaveLength(3)
 })
 it('does not prescribe extra distance when settled work already exceeds the new budget',()=>{
  const result=preservePlanProgress(old,revised,{'W2-0':'completed','W2-1':'skipped'},'2026-10-05',new Date('2026-10-14T12:00Z'))
  expect(result.weeks[1].sessions).toEqual(old.weeks[1].sessions.slice(0,2))
 })
})
