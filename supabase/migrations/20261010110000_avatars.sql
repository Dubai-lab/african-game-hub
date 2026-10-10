-- Profile photos.
--
-- A player may put a photo on their profile. The app shrinks it to a small square on the
-- phone before sending it (a few tens of kilobytes, and nothing of the original file's hidden
-- details such as where it was taken), stores it in a storage bucket, and writes its address
-- on the player's profile.
--
-- What is enforced here, whatever the app does:
--   * The bucket takes small pictures only (256 KB at most; WebP, JPEG or PNG).
--   * A player can add, replace and remove files in their own folder (named after their account
--     id) and nobody else's. Anyone can look at a photo: profiles are public to players.
--   * A profile's photo address can only point at a file in that player's own folder in this
--     bucket. It cannot be set to an address elsewhere on the internet, which would let one
--     player make every other player's phone fetch a picture from a server of their choosing.

create function private.check_avatar_url() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.avatar_url is not null
     and new.avatar_url !~ ('^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/avatars/' || new.id::text || '/[A-Za-z0-9_-]+\.(webp|jpg|png)$') then
    raise exception 'AVATAR_URL_NOT_ALLOWED' using errcode = 'AG002';
  end if;
  return new;
end;
$$;
revoke all on function private.check_avatar_url() from public, anon, authenticated, service_role;

create trigger profiles_check_avatar_url
  before insert or update of avatar_url on public.profiles
  for each row execute function private.check_avatar_url();

-- The bucket and who may write to it. (Storage is part of Supabase; the offline test database
-- has none, and there this part is skipped.)
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    return;
  end if;

  execute $sql$
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 262144, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update
      set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types
  $sql$;

  execute $sql$
    create policy avatars_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $sql$;
  execute $sql$
    create policy avatars_update_own on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $sql$;
  execute $sql$
    create policy avatars_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $sql$;
  -- Needed to list one's own folder (to clear out an old photo). Looking at a photo by its
  -- address needs no rule: the bucket is public.
  execute $sql$
    create policy avatars_select_own on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  $sql$;
end;
$$;
