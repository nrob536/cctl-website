-- Online booking is switched off: toy issuing and returns are managed in person.
-- Members can no longer call the booking functions from the website (or the browser console).
-- lookup_member in particular returned member name/email/phone for any guessed user ID.

revoke execute on function public.lookup_member(text) from public, anon, authenticated;
revoke execute on function public.create_booking(text, uuid, date) from public, anon, authenticated;
revoke execute on function public.list_active_bookings(text) from public, anon, authenticated;
revoke execute on function public.renew_booking(text, uuid) from public, anon, authenticated;
revoke execute on function public.return_booking(text, uuid) from public, anon, authenticated;

-- create_booking_v2 may also exist depending on migration 002; revoke it too if present.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'create_booking_v2') then
    execute 'revoke execute on function public.create_booking_v2(text, uuid, date) from public, anon, authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
