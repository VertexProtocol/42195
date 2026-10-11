// @vitest-environment jsdom
/** Characterization of real hook behavior with synthetic initial data. */
import { renderHook } from '@testing-library/react'
import { it, expect, vi } from 'vitest'
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({})}))
vi.mock('@/lib/actions/auth',()=>({signOut:vi.fn()}))
import { useAppData, type InitialData } from '@/hooks/use-app-data'
import type { Activity } from '@/lib/types'
it('excludes a ride from the running weekly summary',()=>{
 const date=new Date().toISOString()
 const activities=[{id:'r',type:'Run',date,distance_km:5,duration_seconds:1800},{id:'b',type:'Ride',date,distance_km:60,duration_seconds:7200}] as Activity[]
 const initial={activities,goals:[],weeklyGoals:[],user:{id:'synthetic'},testRunActivityIds:[],warnings:[],planBadges:{},planDigests:[],goalPrefs:{},currentPlanWeeks:{},planSessionStatuses:{},dismissals:[],stravaConnected:false,syncStatus:{state:'never',last_sync_at:null,error_message:null}} as unknown as InitialData
 const {result}=renderHook(()=>useAppData(initial))
 expect(result.current.weeklySummary.run_count).toBe(1)
 expect(result.current.weeklySummary.total_distance_km).toBe(5)
})
