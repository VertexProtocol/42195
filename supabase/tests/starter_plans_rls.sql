-- Integration test: all synthetic records are rolled back, including auth/profile triggers.
begin;
select set_config('test.owner', gen_random_uuid()::text, true);
select set_config('test.other', gen_random_uuid()::text, true);
insert into auth.users(id,aud,role,email) values
(current_setting('test.owner')::uuid,'authenticated','authenticated',current_setting('test.owner') || '@example.invalid'),
(current_setting('test.other')::uuid,'authenticated','authenticated',current_setting('test.other') || '@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
insert into public.starter_plans(user_id,state) values(auth.uid(),'{"source":"self_reported"}'::jsonb);
do $$ begin
 if (select count(*) from public.starter_plans) <> 1 then raise exception 'Owner cannot read own plan'; end if;
 begin
  insert into public.starter_plans(user_id,state) values(current_setting('test.other')::uuid,'{"source":"self_reported"}'::jsonb);
  raise exception 'Cross-user insert unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.starter_plans set user_id=current_setting('test.other')::uuid where user_id=auth.uid();
  raise exception 'Ownership transfer unexpectedly allowed';
 exception when insufficient_privilege then null;
 end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.other'),true);
do $$ declare changed integer; begin
 if (select count(*) from public.starter_plans) <> 0 then raise exception 'Cross-user read unexpectedly allowed'; end if;
 update public.starter_plans set version=2 where user_id=current_setting('test.owner')::uuid;
 get diagnostics changed = row_count;
 if changed <> 0 then raise exception 'Cross-user update unexpectedly allowed'; end if;
 if has_table_privilege('anon','public.starter_plans','select') then raise exception 'Anonymous read unexpectedly granted'; end if;
end $$;
reset role;
rollback;
select 'starter plan ownership checks passed; fixtures rolled back' as result;
