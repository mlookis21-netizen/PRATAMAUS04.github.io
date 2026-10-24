alter table public.messages
  add column if not exists reply_to_id bigint null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_reply_to_id_fkey'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_reply_to_id_fkey
      foreign key (reply_to_id) references public.messages(id) on delete set null;
  end if;
end $$;

create index if not exists messages_reply_to_id_idx
  on public.messages(reply_to_id);

create table if not exists public.chat_pins (
  user_id uuid not null references auth.users(id) on delete cascade,
  peer_id uuid not null references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, peer_id),
  constraint chat_pins_not_self check (user_id <> peer_id)
);

alter table public.chat_pins enable row level security;

drop policy if exists "Users can view their own chat pins" on public.chat_pins;
create policy "Users can view their own chat pins"
  on public.chat_pins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can pin their own chats" on public.chat_pins;
create policy "Users can pin their own chats"
  on public.chat_pins for insert to authenticated
  with check (user_id = (select auth.uid()) and user_id <> peer_id);

drop policy if exists "Users can unpin their own chats" on public.chat_pins;
create policy "Users can unpin their own chats"
  on public.chat_pins for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.chat_pins to authenticated;
