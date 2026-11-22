-- =====================================================================
--  Juguetes y Deporte Cart · tablas propias en el mismo proyecto de Supabase que Super Cart
--  Comparte los usuarios, el ingreso y la lista de permitidos (permitidos, es_permitido, es_admin).
--  Correr una sola vez en Supabase > SQL Editor > Run.
-- =====================================================================

-- Preferencias del mail de Juguetes y Deporte Cart (una fila por usuario; la crea la app al entrar)
create table if not exists public.jyd_perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  avisos boolean not null default true,
  modo text not null default 'resumen' check (modo in ('resumen', 'ofertas')),
  supers text[] not null default array['cebra', 'kinderland', 'fravega', 'dexter', 'moov', 'stockcenter', 'sporting', 'grid'],
  baja_token uuid not null default gen_random_uuid(),
  creado timestamptz not null default now(),
  ultimo_aviso timestamptz,
  avisos_enviados integer not null default 0,
  constraint jyd_supers_validos check (cardinality(supers) > 0 and supers <@ array['cebra', 'kinderland', 'fravega', 'dexter', 'moov', 'stockcenter', 'sporting', 'grid'])
);

create table if not exists public.jyd_listas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nombre text not null default 'Mi lista' check (char_length(nombre) between 1 and 80),
  creada timestamptz not null default now(),
  actualizada timestamptz not null default now(),
  datos jsonb not null default '{}'::jsonb
);
create index if not exists jyd_listas_user_idx on public.jyd_listas (user_id);

create table if not exists public.jyd_items (
  lista_id uuid not null references public.jyd_listas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ean text not null,
  nombre text not null default '',
  marca text not null default '',
  imagen text not null default '',
  link text not null default '',
  cantidad integer not null default 1 check (cantidad between 1 and 999),
  rubro text not null default '',
  datos jsonb not null default '{}'::jsonb,
  agregado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  primary key (lista_id, ean)
);
create index if not exists jyd_items_user_idx on public.jyd_items (user_id);

-- Estado de oferta de cada producto, para el aviso "solo cuando entra en oferta" (lo escribe la planilla)
create table if not exists public.jyd_seguimiento (
  user_id uuid not null references auth.users (id) on delete cascade,
  ean text not null,
  en_oferta boolean not null default false,
  mejor_precio numeric,
  mejor_tienda text not null default '',
  en_oferta_desde date,
  precio_avisado numeric,
  primary key (user_id, ean)
);

-- Reglas: un producto solo en listas propias; hasta 30 listas y 500 productos
create or replace function public.jyd_item_lista_propia() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.jyd_listas where id = new.lista_id and user_id = new.user_id) then
    raise exception 'La lista no es tuya';
  end if;
  return new;
end $$;
drop trigger if exists jyd_item_lista_propia on public.jyd_items;
create trigger jyd_item_lista_propia before insert or update on public.jyd_items for each row execute function public.jyd_item_lista_propia();

create or replace function public.jyd_limite_items() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.jyd_items where user_id = new.user_id) >= 500 then
    raise exception 'Llegaste al máximo de 500 productos';
  end if;
  return new;
end $$;
drop trigger if exists jyd_limite_items on public.jyd_items;
create trigger jyd_limite_items before insert on public.jyd_items for each row execute function public.jyd_limite_items();

create or replace function public.jyd_limite_listas() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.jyd_listas where user_id = new.user_id) >= 30 then
    raise exception 'Llegaste al máximo de 30 listas';
  end if;
  return new;
end $$;
drop trigger if exists jyd_limite_listas on public.jyd_listas;
create trigger jyd_limite_listas before insert on public.jyd_listas for each row execute function public.jyd_limite_listas();

-- Seguridad: cada usuario solo lo suyo, y solo si está en permitidos
alter table public.jyd_perfiles enable row level security;
alter table public.jyd_listas enable row level security;
alter table public.jyd_items enable row level security;
alter table public.jyd_seguimiento enable row level security;

drop policy if exists "jyd perfil propio" on public.jyd_perfiles;
create policy "jyd perfil propio" on public.jyd_perfiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "jyd listas propias" on public.jyd_listas;
create policy "jyd listas propias" on public.jyd_listas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "jyd items propios" on public.jyd_items;
create policy "jyd items propios" on public.jyd_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "jyd seguimiento propio" on public.jyd_seguimiento;
create policy "jyd seguimiento propio" on public.jyd_seguimiento for select using (auth.uid() = user_id);
revoke insert, update, delete on public.jyd_seguimiento from anon, authenticated;
-- El usuario no puede cambiar su código de baja ni los contadores de envío
revoke update on public.jyd_perfiles from anon, authenticated;
grant update (avisos, modo, supers) on public.jyd_perfiles to authenticated;

drop policy if exists "solo permitidos" on public.jyd_perfiles;
create policy "solo permitidos" on public.jyd_perfiles as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());
drop policy if exists "solo permitidos" on public.jyd_listas;
create policy "solo permitidos" on public.jyd_listas as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());
drop policy if exists "solo permitidos" on public.jyd_items;
create policy "solo permitidos" on public.jyd_items as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());
drop policy if exists "solo permitidos" on public.jyd_seguimiento;
create policy "solo permitidos" on public.jyd_seguimiento as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());

-- Link "Darte de baja" del mail de Juguetes y Deporte Cart
create or replace function public.jyd_baja_avisos(token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.jyd_perfiles set avisos = false where baja_token = token;
  return found;
end $$;
revoke all on function public.jyd_baja_avisos(uuid) from public;
grant execute on function public.jyd_baja_avisos(uuid) to anon, authenticated;

-- Juguetes y Deporte Cart · mail diario
-- La planilla necesita el mail de cada usuario de Juguetes y Deporte que tiene el mail activado.
-- jyd_perfiles no guarda el mail: esta función lo toma de la cuenta (auth.users).
-- Solo la puede usar la planilla (clave secreta); los usuarios de la app no.
-- Correr una sola vez en Supabase > SQL Editor > Run.

create or replace function public.jyd_destinatarios()
returns table (id uuid, email text, modo text, supers text[], baja_token uuid, avisos_enviados integer)
language sql security definer set search_path = public as $$
  select p.id, lower(u.email)::text, p.modo, p.supers, p.baja_token, p.avisos_enviados
  from public.jyd_perfiles p join auth.users u on u.id = p.id
  where p.avisos and u.email is not null
  order by p.creado
$$;

revoke all on function public.jyd_destinatarios() from public, anon, authenticated;
grant execute on function public.jyd_destinatarios() to service_role;

-- Listas compartidas: aceptar también las de Juguetes y Deporte Cart
alter table public.listas_compartidas drop constraint if exists listas_compartidas_app_check;
alter table public.listas_compartidas add constraint listas_compartidas_app_check check (app in ('super', 'perfu', 'tecno', 'jyd'));

-- Tecno Cart: se suma Frávega a las tiendas que se pueden elegir para el mail
alter table public.tecno_perfiles drop constraint if exists tecno_supers_validos;
alter table public.tecno_perfiles add constraint tecno_supers_validos check (cardinality(supers) > 0 and supers <@ array['naldo', 'cetrogar', 'oncity', 'fravega', 'samsung', 'motorola', 'rodo', 'ipoint', 'macstation']);
alter table public.tecno_perfiles alter column supers set default array['naldo', 'cetrogar', 'oncity', 'fravega', 'samsung', 'motorola', 'rodo', 'ipoint', 'macstation'];
update public.tecno_perfiles set supers = supers || array['fravega'] where not (supers @> array['fravega']);
