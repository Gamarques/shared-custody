-- T-14: receipt photos (RF-08) in a private bucket (RNF-08), small files only (RNF-06).
--
-- Object path convention: '<family_id>/<file>.jpg'. The first folder is the family, so one
-- policy isolates families: only members of that family read, upload, replace or remove.
-- Nobody reads by public URL: the bucket is private and the app uses short-lived signed URLs,
-- which Storage only issues to a caller that passes the select policy below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 512000, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Family id from the first folder of an object path, or null when it is not a uuid.
create function public.receipt_family_id(object_name text) returns uuid
language sql immutable as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(object_name))[1])::uuid
  end
$$;

create policy "receipts: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_family_member(public.receipt_family_id(name)));

create policy "receipts: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and public.is_family_member(public.receipt_family_id(name)));

create policy "receipts: members replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts' and public.is_family_member(public.receipt_family_id(name)))
  with check (bucket_id = 'receipts' and public.is_family_member(public.receipt_family_id(name)));

create policy "receipts: members remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and public.is_family_member(public.receipt_family_id(name)));

-- An expense can only point to a file in its own family folder, so a forged receipt_path
-- cannot make another family's photo show up (the signed URL would be refused anyway).
alter table public.expenses
  add constraint expenses_receipt_path_in_family
  check (receipt_path is null or receipt_path like family_id::text || '/%');
