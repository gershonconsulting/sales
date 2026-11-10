-- Apply on Supabase project "radar" (pkzeeqehwmtnqxdpdesl).
-- Read-only: creates one function + one private token table. Touches no existing table or row.
-- The token is generated in the database; copy it into the Worker secret RADAR_FUNNEL_TOKEN:
--   select token from private.app_tokens where app = 'sales';

create schema if not exists private;
create table if not exists private.app_tokens (app text primary key, token text not null, created_at timestamptz default now());
insert into private.app_tokens(app, token) values ('sales', encode(gen_random_bytes(24),'hex')) on conflict (app) do nothing;

-- company-name normaliser used to match Streak box names to Radar companies
create or replace function public.co_norm(x text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(lower(coalesce(x,'')), '\m(gmbh|inc|ltd|limited|llc|sas|sa|sarl|ag|oy|ab|bv|nv|srl|spa|corp|corporation|group|intl|international|private|pvt|co)\M', '', 'g'), '[^a-z0-9]', '', 'g')
$$;

create or replace function public.sales_funnel(p_token text, p_companies text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  ok boolean; res jsonb; owner text := 'xTVW0K1qKi'; -- Olivier's Radar owner key
begin
  select exists(select 1 from private.app_tokens where app = 'sales' and token = p_token) into ok;
  if not ok then raise exception 'forbidden'; end if;

  with t as (
    select *, lower(regexp_replace(regexp_replace(linkedin_url,'^https?://(www\.)?',''),'/+$','')) k, co_norm(company) cn
    from targets where owner_key = owner),
  b as (
    select *, lower(regexp_replace(regexp_replace(linkedin,'^https?://(www\.)?',''),'/+$','')) k from audit_botdog_leads),
  tb as (select t.*, b.invited_at, b.connected_at, (b.k is not null) in_botdog from t left join b using (k)),
  q as (select distinct c, co_norm(c) cn from unnest(p_companies) c where length(co_norm(c)) >= 3)
  select jsonb_build_object(
    'collected', (select count(*) from t),
    'graded_ab', (select count(*) from t where grade in ('A','B')),
    'grades', (select jsonb_object_agg(g, n) from (select coalesce(grade,'?') g, count(*) n from t group by 1) x),
    'salesnav', (select count(*) from t where salesnav_listed_at is not null),
    'pushed', (select count(*) from t where botdog_pushed is not null),
    'in_botdog', (select count(*) from tb where in_botdog),
    'invited', (select count(*) from tb where invited_at is not null),
    'connected', (select count(*) from tb where connected_at is not null),
    'botdog_synced_at', (select max(created_at) from audit_botdog_leads),
    'radar_last_collected', (select max(collected_date) from t),
    'connected_list', (select coalesce(jsonb_agg(jsonb_build_object('name', trim(coalesce(first_name,'')||' '||coalesce(last_name,'')), 'company', company, 'grade', grade, 'linkedin', linkedin_url, 'connected_at', connected_at) order by connected_at desc), '[]') from tb where connected_at is not null),
    'matches', (select coalesce(jsonb_object_agg(q.c, z.m), '{}') from q cross join lateral (
        select jsonb_build_object('people', count(*), 'pushed', bool_or(botdog_pushed is not null), 'invited', bool_or(invited_at is not null),
                                  'connected', bool_or(connected_at is not null), 'first_pushed', min(botdog_pushed)) m
        from tb where tb.cn = q.cn having count(*) > 0) z)
  ) into res;
  return res;
end $$;

revoke all on function public.sales_funnel(text, text[]) from public;
grant execute on function public.sales_funnel(text, text[]) to anon, authenticated;
