-- One Africa Life: the internal helpers of the documents and the boxed phone, out of every API
-- role's reach (only the game's own functions call them).
revoke all on function private.oal_office_text(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.oal_office_notices() from public, anon, authenticated, service_role;
revoke all on function private.oal_phone_ready(uuid) from public, anon, authenticated, service_role;
revoke all on function private.oal_at_home(uuid) from public, anon, authenticated, service_role;
